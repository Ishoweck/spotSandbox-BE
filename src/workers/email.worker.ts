import { Worker, Job } from 'bullmq';
import { getBullMQConnectionOptions } from '../config/redis';
import {
  sendBuyerFounderWelcomeEmail,
  sendVendorWelcomeEmail,
  sendFounderWelcomeEmail,
  sendProductPostingGuideEmail,
} from '../utils/email';
import { EmailJobType, type EmailJobData } from '../queues/email.queue';
import { logger } from '../utils/logger';

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { type, to, firstName } = job.data;

  switch (type) {
    case EmailJobType.BUYER_FOUNDER_WELCOME:
      await sendBuyerFounderWelcomeEmail(to, firstName ?? '');
      break;

    case EmailJobType.VENDOR_WELCOME:
      await sendVendorWelcomeEmail(to, firstName ?? '');
      break;

    case EmailJobType.FOUNDER_WELCOME:
      await sendFounderWelcomeEmail(to, firstName ?? '');
      break;

    case EmailJobType.PRODUCT_POSTING_GUIDE:
      await sendProductPostingGuideEmail(to);
      break;

    default:
      logger.warn(`[EmailWorker] Unknown email job type: ${type}`);
  }

  logger.info(`[EmailWorker] Email sent — type: ${type}, to: ${to}`);
}

export function startEmailWorker(): void {
  const worker = new Worker<EmailJobData, any, string>(
    'transactional-emails',
    processEmailJob,
    {
      connection: getBullMQConnectionOptions(),
      concurrency: 5,
      limiter: { max: 10, duration: 1_000 }, // 10 emails/sec
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[EmailWorker] Job ${job?.id} (${job?.data?.type}) failed:`, err.message);
  });

  logger.info('[Workers] Email worker started');
}
