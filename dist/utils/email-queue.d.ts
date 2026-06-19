/**
 * Typed email queue backed by BullMQ.
 * Replaces the old setTimeout-based sleep loop.
 * Jobs persist in Redis and survive server restarts.
 */
export { enqueueEmail, EmailJobType } from '../queues/email.queue';
//# sourceMappingURL=email-queue.d.ts.map