"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startEmailWorker = startEmailWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const email_1 = require("../utils/email");
const email_queue_1 = require("../queues/email.queue");
const logger_1 = require("../utils/logger");
async function processEmailJob(job) {
    const { type, to, firstName } = job.data;
    switch (type) {
        case email_queue_1.EmailJobType.BUYER_FOUNDER_WELCOME:
            await (0, email_1.sendBuyerFounderWelcomeEmail)(to, firstName ?? '');
            break;
        case email_queue_1.EmailJobType.VENDOR_WELCOME:
            await (0, email_1.sendVendorWelcomeEmail)(to, firstName ?? '');
            break;
        case email_queue_1.EmailJobType.FOUNDER_WELCOME:
            await (0, email_1.sendFounderWelcomeEmail)(to, firstName ?? '');
            break;
        case email_queue_1.EmailJobType.PRODUCT_POSTING_GUIDE:
            await (0, email_1.sendProductPostingGuideEmail)(to);
            break;
        default:
            logger_1.logger.warn(`[EmailWorker] Unknown email job type: ${type}`);
    }
    logger_1.logger.info(`[EmailWorker] Email sent — type: ${type}, to: ${to}`);
}
function startEmailWorker() {
    const worker = new bullmq_1.Worker('transactional-emails', processEmailJob, {
        connection: redis_1.bullmqClient,
        concurrency: 5,
        limiter: { max: 10, duration: 1000 }, // 10 emails/sec
    });
    worker.on('failed', (job, err) => {
        logger_1.logger.error(`[EmailWorker] Job ${job?.id} (${job?.data?.type}) failed:`, err.message);
    });
    logger_1.logger.info('[Workers] Email worker started');
}
//# sourceMappingURL=email.worker.js.map