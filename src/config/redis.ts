import Redis from 'ioredis';
import { logger } from '../utils/logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// General-purpose Redis client used for idempotency keys and misc caching.
// This is NOT passed to BullMQ — BullMQ manages its own internal Redis connection
// using the connection options returned by getBullMQConnectionOptions().
export const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

redisClient.on('connect', () => logger.info('[Redis] Client connected'));
redisClient.on('error', (err) => logger.error('[Redis] Client error:', err.message));

/**
 * Returns plain connection options for BullMQ Queues and Workers.
 * BullMQ bundles its own ioredis, so passing an external Redis instance causes
 * a type conflict. Passing options lets BullMQ create its own connection.
 */
export function getBullMQConnectionOptions() {
  try {
    const url = new URL(REDIS_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  } catch {
    // Fallback for non-URL formats like "localhost:6379"
    return { host: 'localhost', port: 6379 };
  }
}

export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
    logger.info('[Redis] Client ready');
  } catch (err: any) {
    logger.error('[Redis] Failed to connect:', err.message);
    // Non-fatal — notifications fall back to direct sending
  }
}
