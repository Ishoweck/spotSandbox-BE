/**
 * Attempts to claim an idempotency key.
 * Returns true  → key is new, proceed with processing.
 * Returns false → key already exists, this is a duplicate — skip.
 */
export declare function claimIdempotencyKey(key: string, ttlSeconds?: number): Promise<boolean>;
/**
 * Builds a consistent idempotency key for notification jobs.
 */
export declare function buildNotifKey(userId: string, type: string, referenceId: string): string;
//# sourceMappingURL=idempotency.d.ts.map