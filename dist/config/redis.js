"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisClient = void 0;
exports.getBullMQConnectionOptions = getBullMQConnectionOptions;
exports.connectRedis = connectRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../utils/logger");
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// General-purpose Redis client used for idempotency keys and misc caching.
// This is NOT passed to BullMQ — BullMQ manages its own internal Redis connection
// using the connection options returned by getBullMQConnectionOptions().
exports.redisClient = new ioredis_1.default(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
});
exports.redisClient.on('connect', () => logger_1.logger.info('[Redis] Client connected'));
exports.redisClient.on('error', (err) => logger_1.logger.error('[Redis] Client error:', err.message));
/**
 * Returns plain connection options for BullMQ Queues and Workers.
 * BullMQ bundles its own ioredis, so passing an external Redis instance causes
 * a type conflict. Passing options lets BullMQ create its own connection.
 */
function getBullMQConnectionOptions() {
    try {
        const url = new URL(REDIS_URL);
        return {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
            ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
            ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
        };
    }
    catch {
        // Fallback for non-URL formats like "localhost:6379"
        return { host: 'localhost', port: 6379 };
    }
}
async function connectRedis() {
    try {
        await exports.redisClient.connect();
        logger_1.logger.info('[Redis] Client ready');
    }
    catch (err) {
        logger_1.logger.error('[Redis] Failed to connect:', err.message);
        // Non-fatal — notifications fall back to direct sending
    }
}
//# sourceMappingURL=redis.js.map