"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailJobType = exports.enqueueEmail = void 0;
/**
 * Typed email queue backed by BullMQ.
 * Replaces the old setTimeout-based sleep loop.
 * Jobs persist in Redis and survive server restarts.
 */
var email_queue_1 = require("../queues/email.queue");
Object.defineProperty(exports, "enqueueEmail", { enumerable: true, get: function () { return email_queue_1.enqueueEmail; } });
Object.defineProperty(exports, "EmailJobType", { enumerable: true, get: function () { return email_queue_1.EmailJobType; } });
//# sourceMappingURL=email-queue.js.map