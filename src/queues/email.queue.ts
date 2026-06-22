import { Queue } from 'bullmq';
import { bullmqClient } from '../config/redis';

// ─── Email Job Types ──────────────────────────────────────────────────────────

export enum EmailJobType {
  BUYER_FOUNDER_WELCOME   = 'buyer_founder_welcome',
  VENDOR_WELCOME          = 'vendor_welcome',
  FOUNDER_WELCOME         = 'founder_welcome',
  PRODUCT_POSTING_GUIDE   = 'product_posting_guide',
}

export interface EmailJobData {
  type: EmailJobType;
  to: string;
  firstName?: string;
}

// ─── Queue Definition ─────────────────────────────────────────────────────────

// Email queue — rate-limited to 10/sec to respect SMTP/Resend provider limits
export const emailQueue = new Queue<EmailJobData, any, string>('transactional-emails', {
  connection: bullmqClient as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 120_000 }, // 2min → 4min → 8min
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

// ─── Enqueue Helper ───────────────────────────────────────────────────────────

export async function enqueueEmail(
  type: EmailJobType,
  to: string,
  firstName?: string,
  delayMs = 0,
): Promise<void> {
  await emailQueue.add(
    type,
    { type, to, firstName },
    {
      delay: delayMs,
      jobId: `email:${type}:${to}:${Date.now()}`,
    },
  );
}
