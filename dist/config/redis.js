"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bullmqClient = exports.redisClient = void 0;
exports.connectRedis = connectRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../utils/logger");
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// General-purpose Redis client used for idempotency keys and misc caching.
exports.redisClient = new ioredis_1.default(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
});
exports.redisClient.on('connect', () => logger_1.logger.info('[Redis] Client connected'));
exports.redisClient.on('error', (err) => logger_1.logger.error('[Redis] Client error:', err.message));
// Shared connection for ALL BullMQ Queues and Workers.
// Queues use this instance directly (no extra connections).
// Workers call .duplicate() internally for their blocking pop — one extra per worker.
// Total connections: 1 (redisClient) + 1 (bullmqClient) + N workers = 1+1+3 = 5.
exports.bullmqClient = new ioredis_1.default(REDIS_URL, {
    maxRetriesPerRequest: null, // required for BullMQ blocking commands
    enableReadyCheck: false,
});
exports.bullmqClient.on('error', (err) => logger_1.logger.error('[Redis:BullMQ] Error:', err.message));
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