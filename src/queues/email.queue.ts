import { Queue } from 'bullmq';
import { bullmqClient } from '../config/redis';

// ─── Email Job Types ──────────────────────────────────────────────────────────

export enum EmailJobType {
  BUYER_FOUNDER_WELCOME   = 'buyer_founder_welcome',
  VENDOR_WELCOME          = 'vendor_welcome',
  FOUNDER_WELCOME         = 'founder_welcome',
  PRODUCT_POSTING_GUIDE   = 'product_posting_guide',

  VENDOR_KYC_REMINDER                = 'vendor_kyc_reminder',
  VENDOR_KYC_PENDING_REMINDER        = 'vendor_kyc_pending_reminder',
  VENDOR_FIRST_PRODUCT_REMINDER      = 'vendor_first_product_reminder',
  VENDOR_FIRST_PRODUCT_FOLLOWUP      = 'vendor_first_product_followup',
  VENDOR_COMPLETE_PROFILE_REMINDER   = 'vendor_complete_profile_reminder',
  VENDOR_PAYOUT_DETAILS_REMINDER     = 'vendor_payout_details_reminder',
  VENDOR_NO_SALES_REMINDER           = 'vendor_no_sales_reminder',
  VENDOR_PENDING_ORDER_REMINDER      = 'vendor_pending_order_reminder',
  VENDOR_ENABLE_AFFILIATE_REMINDER   = 'vendor_enable_affiliate_reminder',
  VENDOR_SHARE_STORE_REMINDER        = 'vendor_share_store_reminder',
  VENDOR_INACTIVE_REMINDER           = 'vendor_inactive_reminder',
  VENDOR_SUBSCRIPTION_EXPIRY_7D      = 'vendor_subscription_expiry_7d',
  VENDOR_SUBSCRIPTION_EXPIRY_3D      = 'vendor_subscription_expiry_3d',
  VENDOR_SUBSCRIPTION_EXPIRY_1D      = 'vendor_subscription_expiry_1d',
  VENDOR_LOW_STOCK_ALERT             = 'vendor_low_stock_alert',

  // ── Customer transactional ──────────────────────────────────────────────────
  ORDER_SHIPPED          = 'order_shipped',
  ORDER_DELIVERED        = 'order_delivered',
  ORDER_CANCELLED        = 'order_cancelled',
  REFUND_PROCESSED       = 'refund_processed',
  DISPUTE_OPENED         = 'dispute_opened',
  DISPUTE_RESOLVED       = 'dispute_resolved',
  REVIEW_REQUEST         = 'review_request',
}

export interface EmailJobData {
  type: EmailJobType;
  to: string;
  firstName?: string;
  meta?: Record<string, any>;
}

// ─── Queue Definition ─────────────────────────────────────────────────────────

// Email queue — rate-limited to 10/sec to respect SMTP/Resend provider limits
export const emailQueue = new Queue<EmailJobData, any, string>('transactional-emails', {
  connection: bullmqClient as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 }, // 15s → 30s → 60s (fast retry for transactional emails)
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
  meta?: Record<string, any>,
): Promise<void> {
  await emailQueue.add(
    type,
    { type, to, firstName, meta },
    {
      delay: delayMs,
      jobId: `email:${type}:${to}:${Date.now()}`,
    },
  );
}
