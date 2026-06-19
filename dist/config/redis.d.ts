import Redis from 'ioredis';
export declare const redisClient: Redis;
/**
 * Returns plain connection options for BullMQ Queues and Workers.
 * BullMQ bundles its own ioredis, so passing an external Redis instance causes
 * a type conflict. Passing options lets BullMQ create its own connection.
 */
export declare function getBullMQConnectionOptions(): {
    tls?: {};
    username?: string;
    password?: string;
    host: string;
    port: number;
};
export declare function connectRedis(): Promise<void>;
//# sourceMappingURL=redis.d.ts.map