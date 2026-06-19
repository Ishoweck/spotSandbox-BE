"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastQueue = exports.pushQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const conn = (0, redis_1.getBullMQConnectionOptions)();
// ─── Queue Definitions ────────────────────────────────────────────────────────
// Push notification queue — max 500 FCM sends/sec (Firebase batch limit)
exports.pushQueue = new bullmq_1.Queue('push-notifications', {
    connection: conn,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }, // 1min → 2min → 4min
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
    },
});
// Broadcast fan-out queue — processes user chunks in parallel
exports.broadcastQueue = new bullmq_1.Queue('broadcast-notifications', {
    connection: conn,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
    },
});
//# sourceMappingURL=notification.queue.js.map