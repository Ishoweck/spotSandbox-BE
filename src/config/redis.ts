import Redis from 'ioredis';
import { logger } from '../utils/logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// General-purpose Redis client used for idempotency keys and misc caching.
export const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

redisClient.on('connect', () => logger.info('[Redis] Client connected'));
redisClient.on('error', (err) => logger.error('[Redis] Client error:', err.message));

// Shared connection for ALL BullMQ Queues and Workers.
// Queues use this instance directly (no extra connections).
// Workers call .duplicate() internally for their blocking pop — one extra per worker.
// Total connections: 1 (redisClient) + 1 (bullmqClient) + N workers = 1+1+3 = 5.
export const bullmqClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // required for BullMQ blocking commands
  enableReadyCheck: false,
});

bullmqClient.on('error', (err) => logger.error('[Redis:BullMQ] Error:', err.message));

export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
    logger.info('[Redis] Client ready');
  } catch (err: any) {
    logger.error('[Redis] Failed to connect:', err.message);
    // Non-fatal — notifications fall back to direct sending
  }
}
