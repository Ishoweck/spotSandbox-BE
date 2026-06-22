import { Worker, Job } from 'bullmq';
import Handlebars from 'handlebars';
import { bullmqClient } from '../config/redis';
import { claimIdempotencyKey, buildNotifKey } from '../utils/idempotency';
import { sendPushNotification } from '../config/firebase';
import { NotificationTemplate } from '../models/NotificationTemplate';
import { Notification } from '../models/Additional';
import User from '../models/User';
import { logger } from '../utils/logger';
import type { PushJobData, BroadcastChunkData } from '../queues/notification.queue';

// ─── Push Notification Worker ─────────────────────────────────────────────────

async function processPushJob(job: Job<PushJobData>): Promise<void> {
  const { notificationId, userId, type, title, message, data, referenceId } = job.data;

  // 1. Idempotency check — skip if already processed
  const key = buildNotifKey(userId, type, referenceId);
  const isNew = await claimIdempotencyKey(key);
  if (!isNew) {
    logger.info(`[PushWorker] Duplicate job skipped: ${key}`);
    return;
  }

  // 2. Preference check — respect user's push opt-out
  const user = await User.findById(userId).select('fcmTokens notificationPreferences').lean();
  if (!user) return;

  const prefs = (user as any).notificationPreferences;
  if (prefs?.pushEnabled === false) {
    logger.info(`[PushWorker] Push disabled for user ${userId}, skipping`);
    return;
  }

  const tokens: string[] = (user as any).fcmTokens ?? [];
  if (tokens.length === 0) return;

  // 3. Template render — fall back to job data strings if no template found
  let finalTitle = title;
  let finalBody = message;

  try {
    const template = await NotificationTemplate.findOne({
      notificationType: type,
      channel: 'push',
      locale: 'en',
    }).lean();

    if (template) {
      const ctx = { ...data };
      finalTitle = Handlebars.compile(template.titleTemplate)(ctx);
      finalBody = Handlebars.compile(template.bodyTemplate)(ctx);
    }
  } catch (err: any) {
    logger.warn(`[PushWorker] Template render failed, using fallback: ${err.message}`);
  }

  // 4. Send to FCM
  const pushData: Record<string, string> = {
    type,
    ...(job.data.link ? { link: job.data.link } : {}),
    ...(data ? { payload: JSON.stringify(data) } : {}),
  };

  try {
    await sendPushNotification(tokens, finalTitle, finalBody, pushData);

    // 5. Mark as sent in DB
    if (notificationId) {
      await Notification.findByIdAndUpdate(notificationId, { pushStatus: 'sent' });
    }

    logger.info(`[PushWorker] Push sent to user ${userId}: [${type}]`);
  } catch (err: any) {
    if (notificationId) {
      await Notification.findByIdAndUpdate(notificationId, { pushStatus: 'failed' });
    }
    throw err; // Re-throw so BullMQ retries
  }
}

// ─── Broadcast Chunk Worker ───────────────────────────────────────────────────

async function processBroadcastChunk(job: Job<BroadcastChunkData>): Promise<void> {
  const { userIds, type, title, message, data, link } = job.data;

  const users = await User.find({
    _id: { $in: userIds },
    fcmTokens: { $exists: true, $not: { $size: 0 } },
  }).select('_id fcmTokens notificationPreferences').lean();

  // Filter out users who explicitly disabled push
  const eligible = (users as any[]).filter((u) => {
    const prefs = u.notificationPreferences;
    return !prefs || prefs.pushEnabled !== false;
  });

  if (eligible.length === 0) return;

  const allTokens: string[] = eligible.flatMap((u: any) => u.fcmTokens as string[]);
  if (allTokens.length === 0) return;

  const pushData: Record<string, string> = {
    type,
    ...(link ? { link } : {}),
    ...(data ? { payload: JSON.stringify(data) } : {}),
  };

  await sendPushNotification(allTokens, title, message, pushData);
  logger.info(`[BroadcastWorker] Chunk pushed to ${eligible.length} users [${type}]`);
}

// ─── Worker Registration ──────────────────────────────────────────────────────

export function startNotificationWorkers(): void {
  const pushWorker = new Worker<PushJobData, any, string>(
    'push-notifications',
    processPushJob,
    {
      connection: bullmqClient as any,
      concurrency: 20,
      limiter: { max: 500, duration: 1_000 }, // 500 FCM sends/sec
    },
  );

  const broadcastWorker = new Worker<BroadcastChunkData, any, string>(
    'broadcast-notifications',
    processBroadcastChunk,
    {
      connection: bullmqClient as any,
      concurrency: 5,
    },
  );

  pushWorker.on('failed', (job, err) => {
    logger.error(`[PushWorker] Job ${job?.id} failed after all retries:`, err.message);
  });

  broadcastWorker.on('failed', (job, err) => {
    logger.error(`[BroadcastWorker] Job ${job?.id} failed after all retries:`, err.message);
  });

  logger.info('[Workers] Notification workers started (push + broadcast)');
}
