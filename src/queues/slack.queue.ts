import { Queue } from 'bullmq';
import { bullmqClient } from '../config/redis';

export type SlackChannel = 'vendor' | 'customer' | 'ambassador';

export interface SlackJobData {
  channel: SlackChannel;
  event: string;
  actor?: {
    id?: string;
    name?: string;
    email?: string;
  };
  message: string;
  meta?: Record<string, any>;
  emoji?: string; // optional leading emoji for the message
  /** Next-step guidance ("Next: verify email OTP within 10 mins") shown as a callout in the message. */
  nextStep?: string;
  /** When true, prepend @-mentions of the admins configured for this channel (see slack.service.ts). */
  mention?: boolean;
}

// Slack notifications queue — separate from email queue so a Slack outage
// can't back up email delivery, and vice versa. Rate limited to 5/sec
// (Slack incoming webhooks allow ~1/sec per channel; buffer with retries).
export const slackQueue = new Queue<SlackJobData, any, string>('slack-notifications', {
  connection: bullmqClient as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 }, // 5s → 10s → 20s
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export async function enqueueSlack(data: SlackJobData): Promise<void> {
  await slackQueue.add(data.event, data, { removeOnComplete: true });
}
