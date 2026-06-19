import { Queue } from 'bullmq';
export declare enum EmailJobType {
    BUYER_FOUNDER_WELCOME = "buyer_founder_welcome",
    VENDOR_WELCOME = "vendor_welcome",
    FOUNDER_WELCOME = "founder_welcome",
    PRODUCT_POSTING_GUIDE = "product_posting_guide"
}
export interface EmailJobData {
    type: EmailJobType;
    to: string;
    firstName?: string;
}
export declare const emailQueue: Queue<EmailJobData, any, string, EmailJobData, any, string>;
export declare function enqueueEmail(type: EmailJobType, to: string, firstName?: string, delayMs?: number): Promise<void>;
//# sourceMappingURL=email.queue.d.ts.map