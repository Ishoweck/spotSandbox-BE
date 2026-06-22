"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailQueue = exports.EmailJobType = void 0;
exports.enqueueEmail = enqueueEmail;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
// ─── Email Job Types ──────────────────────────────────────────────────────────
var EmailJobType;
(function (EmailJobType) {
    EmailJobType["BUYER_FOUNDER_WELCOME"] = "buyer_founder_welcome";
    EmailJobType["VENDOR_WELCOME"] = "vendor_welcome";
    EmailJobType["FOUNDER_WELCOME"] = "founder_welcome";
    EmailJobType["PRODUCT_POSTING_GUIDE"] = "product_posting_guide";
})(EmailJobType || (exports.EmailJobType = EmailJobType = {}));
// ─── Queue Definition ─────────────────────────────────────────────────────────
// Email queue — rate-limited to 10/sec to respect SMTP/Resend provider limits
exports.emailQueue = new bullmq_1.Queue('transactional-emails', {
    connection: redis_1.bullmqClient,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 120000 }, // 2min → 4min → 8min
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
    },
});
// ─── Enqueue Helper ───────────────────────────────────────────────────────────
async function enqueueEmail(type, to, firstName, delayMs = 0) {
    await exports.emailQueue.add(type, { type, to, firstName }, {
        delay: delayMs,
        jobId: `email:${type}:${to}:${Date.now()}`,
    });
}
//# sourceMappingURL=email.queue.js.map