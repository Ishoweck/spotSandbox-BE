import { Queue } from 'bullmq';
import { getBullMQConnectionOptions } from '../config/redis';
import { NotificationType } from '../types';

// ─── Job Data Types ───────────────────────────────────────────────────────────

export interface PushJobData {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  link?: string;
  referenceId: string; // used for idempotency key
}

export interface BroadcastChunkData {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  link?: string;
  referenceId: string;
}

const conn = getBullMQConnectionOptions();

// ─── Queue Definitions ────────────────────────────────────────────────────────

// Push notification queue — max 500 FCM sends/sec (Firebase batch limit)
export const pushQueue = new Queue<PushJobData, any, string>('push-notifications', {
  connection: conn,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 }, // 1min → 2min → 4min
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

// Broadcast fan-out queue — processes user chunks in parallel
export const broadcastQueue = new Queue<BroadcastChunkData, any, string>('broadcast-notifications', {
  connection: conn,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 30_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  },
});
