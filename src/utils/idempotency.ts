import { redisClient } from '../config/redis';
import { logger } from './logger';

const DEFAULT_TTL = 86_400; // 24 hours

/**
 * Attempts to claim an idempotency key.
 * Returns true  → key is new, proceed with processing.
 * Returns false → key already exists, this is a duplicate — skip.
 */
export async function claimIdempotencyKey(key: string, ttlSeconds = DEFAULT_TTL): Promise<boolean> {
  try {
    // SET key 1 NX EX ttl — only sets if key does not exist
    const result = await redisClient.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (err: any) {
    // Redis down — allow processing to continue rather than silently dropping jobs
    logger.warn('[Idempotency] Redis unavailable, allowing job to proceed:', err.message);
    return true;
  }
}

/**
 * Builds a consistent idempotency key for notification jobs.
 */
export function buildNotifKey(userId: string, type: string, referenceId: string): string {
  return `notif:sent:${userId}:${type}:${referenceId}`;
}
