"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimIdempotencyKey = claimIdempotencyKey;
exports.buildNotifKey = buildNotifKey;
const redis_1 = require("../config/redis");
const logger_1 = require("./logger");
const DEFAULT_TTL = 86400; // 24 hours
/**
 * Attempts to claim an idempotency key.
 * Returns true  → key is new, proceed with processing.
 * Returns false → key already exists, this is a duplicate — skip.
 */
async function claimIdempotencyKey(key, ttlSeconds = DEFAULT_TTL) {
    try {
        // SET key 1 NX EX ttl — only sets if key does not exist
        const result = await redis_1.redisClient.set(key, '1', 'EX', ttlSeconds, 'NX');
        return result === 'OK';
    }
    catch (err) {
        // Redis down — allow processing to continue rather than silently dropping jobs
        logger_1.logger.warn('[Idempotency] Redis unavailable, allowing job to proceed:', err.message);
        return true;
    }
}
/**
 * Builds a consistent idempotency key for notification jobs.
 */
function buildNotifKey(userId, type, referenceId) {
    return `notif:sent:${userId}:${type}:${referenceId}`;
}
//# sourceMappingURL=idempotency.js.map