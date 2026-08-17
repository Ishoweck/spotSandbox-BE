import { Worker, Job } from 'bullmq';
import { bullmqClient } from '../config/redis';
import { SlackJobData } from '../queues/slack.queue';
import { postToSlack } from '../services/slack.service';
import { logger } from '../utils/logger';

async function processSlackJob(job: Job<SlackJobData>): Promise<void> {
  const result = await postToSlack(job.data);
  if (!result.delivered) {
    // postToSlack already logged the reason; throwing here triggers BullMQ retry
    // BUT only if it was a genuine transient error (5xx / network). For config
    // errors (no webhook URL, kill switch), we don't want to retry — swallow silently.
    if (result.reason?.startsWith('HTTP 5') || result.reason?.startsWith('HTTP network')) {
      throw new Error(result.reason);
    }
  }
}

export function startSlackWorker(): void {
  const worker = new Worker<SlackJobData, any, string>(
    'slack-notifications',
    processSlackJob,
    {
      connection: bullmqClient as any,
      concurrency: 3,
      limiter: { max: 5, duration: 1_000 }, // 5/sec across all channels
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[SlackWorker] Job ${job?.id} (${job?.data?.event}) failed:`, err.message);
  });

  logger.info('[Workers] Slack worker started');
}
