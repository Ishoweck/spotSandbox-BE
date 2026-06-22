"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startNotificationWorkers = startNotificationWorkers;
const bullmq_1 = require("bullmq");
const handlebars_1 = __importDefault(require("handlebars"));
const redis_1 = require("../config/redis");
const idempotency_1 = require("../utils/idempotency");
const firebase_1 = require("../config/firebase");
const NotificationTemplate_1 = require("../models/NotificationTemplate");
const Additional_1 = require("../models/Additional");
const User_1 = __importDefault(require("../models/User"));
const logger_1 = require("../utils/logger");
// ─── Push Notification Worker ─────────────────────────────────────────────────
async function processPushJob(job) {
    const { notificationId, userId, type, title, message, data, referenceId } = job.data;
    // 1. Idempotency check — skip if already processed
    const key = (0, idempotency_1.buildNotifKey)(userId, type, referenceId);
    const isNew = await (0, idempotency_1.claimIdempotencyKey)(key);
    if (!isNew) {
        logger_1.logger.info(`[PushWorker] Duplicate job skipped: ${key}`);
        return;
    }
    // 2. Preference check — respect user's push opt-out
    const user = await User_1.default.findById(userId).select('fcmTokens notificationPreferences').lean();
    if (!user)
        return;
    const prefs = user.notificationPreferences;
    if (prefs?.pushEnabled === false) {
        logger_1.logger.info(`[PushWorker] Push disabled for user ${userId}, skipping`);
        return;
    }
    const tokens = user.fcmTokens ?? [];
    if (tokens.length === 0)
        return;
    // 3. Template render — fall back to job data strings if no template found
    let finalTitle = title;
    let finalBody = message;
    try {
        const template = await NotificationTemplate_1.NotificationTemplate.findOne({
            notificationType: type,
            channel: 'push',
            locale: 'en',
        }).lean();
        if (template) {
            const ctx = { ...data };
            finalTitle = handlebars_1.default.compile(template.titleTemplate)(ctx);
            finalBody = handlebars_1.default.compile(template.bodyTemplate)(ctx);
        }
    }
    catch (err) {
        logger_1.logger.warn(`[PushWorker] Template render failed, using fallback: ${err.message}`);
    }
    // 4. Send to FCM
    const pushData = {
        type,
        ...(job.data.link ? { link: job.data.link } : {}),
        ...(data ? { payload: JSON.stringify(data) } : {}),
    };
    try {
        await (0, firebase_1.sendPushNotification)(tokens, finalTitle, finalBody, pushData);
        // 5. Mark as sent in DB
        if (notificationId) {
            await Additional_1.Notification.findByIdAndUpdate(notificationId, { pushStatus: 'sent' });
        }
        logger_1.logger.info(`[PushWorker] Push sent to user ${userId}: [${type}]`);
    }
    catch (err) {
        if (notificationId) {
            await Additional_1.Notification.findByIdAndUpdate(notificationId, { pushStatus: 'failed' });
        }
        throw err; // Re-throw so BullMQ retries
    }
}
// ─── Broadcast Chunk Worker ───────────────────────────────────────────────────
async function processBroadcastChunk(job) {
    const { userIds, type, title, message, data, link } = job.data;
    const users = await User_1.default.find({
        _id: { $in: userIds },
        fcmTokens: { $exists: true, $not: { $size: 0 } },
    }).select('_id fcmTokens notificationPreferences').lean();
    // Filter out users who explicitly disabled push
    const eligible = users.filter((u) => {
        const prefs = u.notificationPreferences;
        return !prefs || prefs.pushEnabled !== false;
    });
    if (eligible.length === 0)
        return;
    const allTokens = eligible.flatMap((u) => u.fcmTokens);
    if (allTokens.length === 0)
        return;
    const pushData = {
        type,
        ...(link ? { link } : {}),
        ...(data ? { payload: JSON.stringify(data) } : {}),
    };
    await (0, firebase_1.sendPushNotification)(allTokens, title, message, pushData);
    logger_1.logger.info(`[BroadcastWorker] Chunk pushed to ${eligible.length} users [${type}]`);
}
// ─── Worker Registration ──────────────────────────────────────────────────────
function startNotificationWorkers() {
    const pushWorker = new bullmq_1.Worker('push-notifications', processPushJob, {
        connection: redis_1.bullmqClient,
        concurrency: 20,
        limiter: { max: 500, duration: 1000 }, // 500 FCM sends/sec
    });
    const broadcastWorker = new bullmq_1.Worker('broadcast-notifications', processBroadcastChunk, {
        connection: redis_1.bullmqClient,
        concurrency: 5,
    });
    pushWorker.on('failed', (job, err) => {
        logger_1.logger.error(`[PushWorker] Job ${job?.id} failed after all retries:`, err.message);
    });
    broadcastWorker.on('failed', (job, err) => {
        logger_1.logger.error(`[BroadcastWorker] Job ${job?.id} failed after all retries:`, err.message);
    });
    logger_1.logger.info('[Workers] Notification workers started (push + broadcast)');
}
//# sourceMappingURL=notification.worker.js.map