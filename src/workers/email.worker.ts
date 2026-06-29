import { Worker, Job } from 'bullmq';
import { bullmqClient } from '../config/redis';
import {
  sendBuyerFounderWelcomeEmail,
  sendVendorWelcomeEmail,
  sendFounderWelcomeEmail,
  sendProductPostingGuideEmail,
  sendVendorKycReminderEmail,
  sendVendorKycPendingReminderEmail,
  sendVendorFirstProductReminderEmail,
  sendVendorFirstProductFollowupEmail,
  sendVendorCompleteProfileReminderEmail,
  sendVendorPayoutDetailsReminderEmail,
  sendVendorNoSalesReminderEmail,
  sendVendorPendingOrderReminderEmail,
  sendVendorEnableAffiliateReminderEmail,
  sendVendorShareStoreReminderEmail,
  sendVendorInactiveReminderEmail,
  sendVendorSubscriptionExpiryEmail,
  sendVendorLowStockAlertEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
  sendOrderCancelledEmail,
  sendRefundProcessedEmail,
  sendDisputeOpenedEmail,
  sendDisputeResolvedEmail,
  sendReviewRequestEmail,
} from '../utils/email';
import { EmailJobType, type EmailJobData } from '../queues/email.queue';
import { logger } from '../utils/logger';

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { type, to, firstName, meta } = job.data;

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

    case EmailJobType.VENDOR_KYC_REMINDER:
      await sendVendorKycReminderEmail(to, firstName ?? '', meta?.businessName ?? '');
      break;

    case EmailJobType.VENDOR_KYC_PENDING_REMINDER:
      await sendVendorKycPendingReminderEmail(to, firstName ?? '');
      break;

    case EmailJobType.VENDOR_FIRST_PRODUCT_REMINDER:
      await sendVendorFirstProductReminderEmail(to, firstName ?? '', meta?.businessName ?? '');
      break;

    case EmailJobType.VENDOR_FIRST_PRODUCT_FOLLOWUP:
      await sendVendorFirstProductFollowupEmail(to, firstName ?? '', meta?.businessName ?? '');
      break;

    case EmailJobType.VENDOR_COMPLETE_PROFILE_REMINDER:
      await sendVendorCompleteProfileReminderEmail(to, firstName ?? '', meta?.businessName ?? '', meta?.missing ?? []);
      break;

    case EmailJobType.VENDOR_PAYOUT_DETAILS_REMINDER:
      await sendVendorPayoutDetailsReminderEmail(to, firstName ?? '', meta?.businessName ?? '');
      break;

    case EmailJobType.VENDOR_NO_SALES_REMINDER:
      await sendVendorNoSalesReminderEmail(to, firstName ?? '', meta?.businessName ?? '');
      break;

    case EmailJobType.VENDOR_PENDING_ORDER_REMINDER:
      await sendVendorPendingOrderReminderEmail(to, firstName ?? '', meta?.orderNumber ?? '', meta?.itemCount ?? 0);
      break;

    case EmailJobType.VENDOR_ENABLE_AFFILIATE_REMINDER:
      await sendVendorEnableAffiliateReminderEmail(to, firstName ?? '', meta?.businessName ?? '');
      break;

    case EmailJobType.VENDOR_SHARE_STORE_REMINDER:
      await sendVendorShareStoreReminderEmail(to, firstName ?? '', meta?.businessName ?? '', meta?.storeLink ?? '');
      break;

    case EmailJobType.VENDOR_INACTIVE_REMINDER:
      await sendVendorInactiveReminderEmail(to, firstName ?? '', meta?.businessName ?? '');
      break;

    case EmailJobType.VENDOR_SUBSCRIPTION_EXPIRY_7D:
    case EmailJobType.VENDOR_SUBSCRIPTION_EXPIRY_3D:
    case EmailJobType.VENDOR_SUBSCRIPTION_EXPIRY_1D:
      await sendVendorSubscriptionExpiryEmail(
        to,
        firstName ?? '',
        meta?.planName ?? '',
        meta?.daysLeft ?? 0,
        meta?.expiryDate ?? '',
      );
      break;

    case EmailJobType.VENDOR_LOW_STOCK_ALERT:
      await sendVendorLowStockAlertEmail(to, firstName ?? '', meta?.productName ?? '', meta?.remainingStock ?? 0);
      break;

    case EmailJobType.ORDER_SHIPPED:
      await sendOrderShippedEmail(
        to, firstName ?? '', meta?.orderNumber ?? '',
        meta?.courier, meta?.trackingNumber, meta?.estimatedDelivery, meta?.trackingUrl,
      );
      break;

    case EmailJobType.ORDER_DELIVERED:
      await sendOrderDeliveredEmail(to, firstName ?? '', meta?.orderNumber ?? '');
      break;

    case EmailJobType.ORDER_CANCELLED:
      await sendOrderCancelledEmail(to, firstName ?? '', meta?.orderNumber ?? '', meta?.cancelReason, meta?.refundAmount);
      break;

    case EmailJobType.REFUND_PROCESSED:
      await sendRefundProcessedEmail(to, firstName ?? '', meta?.orderNumber ?? '', meta?.refundAmount ?? 0);
      break;

    case EmailJobType.DISPUTE_OPENED:
      await sendDisputeOpenedEmail(to, firstName ?? '', meta?.disputeNumber ?? '', meta?.orderNumber ?? '');
      break;

    case EmailJobType.DISPUTE_RESOLVED:
      await sendDisputeResolvedEmail(
        to, firstName ?? '', meta?.disputeNumber ?? '', meta?.orderNumber ?? '',
        meta?.resolution ?? '', meta?.refundAmount,
      );
      break;

    case EmailJobType.REVIEW_REQUEST:
      await sendReviewRequestEmail(to, firstName ?? '', meta?.orderNumber ?? '', meta?.vendorName);
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
      connection: bullmqClient as any,
      concurrency: 5,
      limiter: { max: 10, duration: 1_000 }, // 10 emails/sec
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[EmailWorker] Job ${job?.id} (${job?.data?.type}) failed:`, err.message);
  });

  logger.info('[Workers] Email worker started');
}
