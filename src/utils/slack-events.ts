// ══════════════════════════════════════════════════════════════════════════════
// Single API for firing Slack user-journey events across the codebase.
//
// Usage:
//   import { trackEvent, SlackEvent } from '@/utils/slack-events';
//   trackEvent(SlackEvent.VENDOR_KYC_VERIFIED, { actor, meta });
//
// - trackEvent() NEVER throws. Safe to call from any controller.
// - Routes to the correct Slack channel (vendor / customer / ambassador)
//   based on the event prefix.
// - Uses the Slack queue so a Slack outage does not delay the caller.
// ══════════════════════════════════════════════════════════════════════════════

import { enqueueSlack, SlackChannel } from '../queues/slack.queue';
import { logger } from './logger';

export enum SlackEvent {
  // ── Vendor ──
  VENDOR_REGISTERED              = 'vendor_registered',
  VENDOR_EMAIL_VERIFIED          = 'vendor_email_verified',
  VENDOR_PROFILE_CREATED         = 'vendor_profile_created',
  VENDOR_PROFILE_UPDATED         = 'vendor_profile_updated',
  VENDOR_BUSINESS_SURVEY         = 'vendor_business_survey_submitted',
  VENDOR_KYC_DOC_UPLOADED        = 'vendor_kyc_doc_uploaded',
  VENDOR_KYC_AUTO_VERIFIED       = 'vendor_kyc_auto_verified_dojah',
  VENDOR_KYC_VERIFIED            = 'vendor_kyc_verified_admin',
  VENDOR_KYC_REJECTED            = 'vendor_kyc_rejected',
  VENDOR_NIN_SUBMITTED           = 'vendor_nin_submitted',
  VENDOR_PAYOUT_DETAILS_SET      = 'vendor_payout_details_set',
  VENDOR_PRODUCT_ADDED           = 'vendor_product_added',
  VENDOR_PRODUCT_UPDATED         = 'vendor_product_updated',
  VENDOR_PRODUCT_DELETED         = 'vendor_product_deleted',
  VENDOR_FIRST_SALE              = 'vendor_first_sale',
  VENDOR_ORDER_RECEIVED          = 'vendor_order_received',
  VENDOR_ORDER_SHIPPED           = 'vendor_order_shipped',
  VENDOR_SUBSCRIPTION_UPGRADED   = 'vendor_subscription_upgraded',
  VENDOR_SUBSCRIPTION_EXPIRED    = 'vendor_subscription_expired',
  VENDOR_STORE_ACTIVATED         = 'vendor_store_activated',
  VENDOR_STORE_DEACTIVATED       = 'vendor_store_deactivated',
  VENDOR_DISPUTE_RECEIVED        = 'vendor_dispute_received',
  VENDOR_REVIEW_RECEIVED         = 'vendor_review_received',
  VENDOR_COUPON_CREATED          = 'vendor_coupon_created',

  // ── Customer ──
  CUSTOMER_REGISTERED            = 'customer_registered',
  CUSTOMER_EMAIL_VERIFIED        = 'customer_email_verified',
  CUSTOMER_PROFILE_UPDATED       = 'customer_profile_updated',
  CUSTOMER_FIRST_ORDER           = 'customer_first_order',
  CUSTOMER_ORDER_PLACED          = 'customer_order_placed',
  CUSTOMER_ORDER_CANCELLED       = 'customer_order_cancelled',
  CUSTOMER_ORDER_DELIVERED       = 'customer_order_delivered',
  CUSTOMER_HIGH_VALUE_ORDER      = 'customer_high_value_order',
  CUSTOMER_DISPUTE_OPENED        = 'customer_dispute_opened',
  CUSTOMER_REVIEW_SUBMITTED      = 'customer_review_submitted',
  CUSTOMER_COUPON_REDEEMED       = 'customer_coupon_redeemed',
  CUSTOMER_VCREDITS_EARNED       = 'customer_vcredits_earned',
  CUSTOMER_CART_ABANDONED        = 'customer_cart_abandoned',
  CUSTOMER_COMEBACK_TRIGGERED    = 'customer_comeback_triggered',
  CUSTOMER_ACCOUNT_DELETED       = 'customer_account_deleted',

  // ── Ambassador ──
  AMBASSADOR_APPLIED             = 'ambassador_applied',
  AMBASSADOR_APPROVED            = 'ambassador_approved',
  AMBASSADOR_REJECTED            = 'ambassador_rejected',
  AMBASSADOR_FIRST_REFERRAL      = 'ambassador_first_referral',
  AMBASSADOR_REFERRAL_SIGNED_UP  = 'ambassador_referral_signed_up',
  AMBASSADOR_MILESTONE_REACHED   = 'ambassador_milestone_reached',
  AMBASSADOR_COMMISSION_EARNED   = 'ambassador_commission_earned',
  AMBASSADOR_COMMISSION_PAID     = 'ambassador_commission_paid',
  AMBASSADOR_INVITE_SENT         = 'ambassador_invite_sent',
}

// Emoji per event — makes Slack scannable at a glance
const EVENT_EMOJI: Partial<Record<SlackEvent, string>> = {
  [SlackEvent.VENDOR_REGISTERED]:            '🎉',
  [SlackEvent.VENDOR_EMAIL_VERIFIED]:        '📧',
  [SlackEvent.VENDOR_PROFILE_CREATED]:       '🏪',
  [SlackEvent.VENDOR_PROFILE_UPDATED]:       '✏️',
  [SlackEvent.VENDOR_BUSINESS_SURVEY]:       '📋',
  [SlackEvent.VENDOR_KYC_DOC_UPLOADED]:      '📄',
  [SlackEvent.VENDOR_KYC_AUTO_VERIFIED]:     '⚡',
  [SlackEvent.VENDOR_KYC_VERIFIED]:          '✅',
  [SlackEvent.VENDOR_KYC_REJECTED]:          '❌',
  [SlackEvent.VENDOR_NIN_SUBMITTED]:         '🆔',
  [SlackEvent.VENDOR_PAYOUT_DETAILS_SET]:    '💳',
  [SlackEvent.VENDOR_PRODUCT_ADDED]:         '📦',
  [SlackEvent.VENDOR_PRODUCT_UPDATED]:       '🔧',
  [SlackEvent.VENDOR_PRODUCT_DELETED]:       '🗑️',
  [SlackEvent.VENDOR_FIRST_SALE]:            '🎊',
  [SlackEvent.VENDOR_ORDER_RECEIVED]:        '🛒',
  [SlackEvent.VENDOR_ORDER_SHIPPED]:         '🚚',
  [SlackEvent.VENDOR_SUBSCRIPTION_UPGRADED]: '⭐',
  [SlackEvent.VENDOR_SUBSCRIPTION_EXPIRED]:  '⏰',
  [SlackEvent.VENDOR_STORE_ACTIVATED]:       '🟢',
  [SlackEvent.VENDOR_STORE_DEACTIVATED]:     '🔴',
  [SlackEvent.VENDOR_DISPUTE_RECEIVED]:      '⚠️',
  [SlackEvent.VENDOR_REVIEW_RECEIVED]:       '⭐',
  [SlackEvent.VENDOR_COUPON_CREATED]:        '🎟️',

  [SlackEvent.CUSTOMER_REGISTERED]:          '👋',
  [SlackEvent.CUSTOMER_EMAIL_VERIFIED]:      '📧',
  [SlackEvent.CUSTOMER_PROFILE_UPDATED]:     '✏️',
  [SlackEvent.CUSTOMER_FIRST_ORDER]:         '🎊',
  [SlackEvent.CUSTOMER_ORDER_PLACED]:        '🛒',
  [SlackEvent.CUSTOMER_ORDER_CANCELLED]:     '🚫',
  [SlackEvent.CUSTOMER_ORDER_DELIVERED]:     '📬',
  [SlackEvent.CUSTOMER_HIGH_VALUE_ORDER]:    '💰',
  [SlackEvent.CUSTOMER_DISPUTE_OPENED]:      '⚠️',
  [SlackEvent.CUSTOMER_REVIEW_SUBMITTED]:    '⭐',
  [SlackEvent.CUSTOMER_COUPON_REDEEMED]:     '🎟️',
  [SlackEvent.CUSTOMER_VCREDITS_EARNED]:     '💎',
  [SlackEvent.CUSTOMER_CART_ABANDONED]:      '🛒',
  [SlackEvent.CUSTOMER_COMEBACK_TRIGGERED]:  '👀',
  [SlackEvent.CUSTOMER_ACCOUNT_DELETED]:     '💔',

  [SlackEvent.AMBASSADOR_APPLIED]:           '📝',
  [SlackEvent.AMBASSADOR_APPROVED]:          '✅',
  [SlackEvent.AMBASSADOR_REJECTED]:          '❌',
  [SlackEvent.AMBASSADOR_FIRST_REFERRAL]:    '🎊',
  [SlackEvent.AMBASSADOR_REFERRAL_SIGNED_UP]:'🤝',
  [SlackEvent.AMBASSADOR_MILESTONE_REACHED]: '🏆',
  [SlackEvent.AMBASSADOR_COMMISSION_EARNED]: '💰',
  [SlackEvent.AMBASSADOR_COMMISSION_PAID]:   '💸',
  [SlackEvent.AMBASSADOR_INVITE_SENT]:       '📮',
};

function channelFor(event: SlackEvent): SlackChannel {
  if (event.startsWith('vendor_'))     return 'vendor';
  if (event.startsWith('customer_'))   return 'customer';
  if (event.startsWith('ambassador_')) return 'ambassador';
  return 'vendor'; // safe default
}

// Default "next step" guidance per event — so anyone reading the Slack channel
// immediately knows what should happen next in the journey.
const DEFAULT_NEXT_STEP: Partial<Record<SlackEvent, string>> = {
  // Vendor journey
  [SlackEvent.VENDOR_REGISTERED]:            'Verify email OTP (10-min window), then create business profile.',
  [SlackEvent.VENDOR_EMAIL_VERIFIED]:        'Create business profile: name, address, phone. Then submit NIN.',
  [SlackEvent.VENDOR_PROFILE_CREATED]:       'Complete NIN verification and set payout details.',
  [SlackEvent.VENDOR_BUSINESS_SURVEY]:       'Waiting on NIN + KYC upload. Nudge if idle >48h.',
  [SlackEvent.VENDOR_NIN_SUBMITTED]:         'Admin to review NIN + selfie in the admin dashboard.',
  [SlackEvent.VENDOR_KYC_DOC_UPLOADED]:      'Admin to review uploaded doc.',
  [SlackEvent.VENDOR_KYC_AUTO_VERIFIED]:     'No action needed — Dojah passed the check. Vendor can now add products.',
  [SlackEvent.VENDOR_KYC_VERIFIED]:          'Vendor should set payout details and add first product.',
  [SlackEvent.VENDOR_KYC_REJECTED]:          'Follow up with vendor on rejection reason. They must re-upload.',
  [SlackEvent.VENDOR_PAYOUT_DETAILS_SET]:    'Vendor should add first product.',
  [SlackEvent.VENDOR_PRODUCT_ADDED]:         'Vendor is ready to sell. First-sale email will fire when order placed.',
  [SlackEvent.VENDOR_FIRST_SALE]:            'Ship within 24h to keep the 5-star rating. Encourage vendor to add more products.',
  [SlackEvent.VENDOR_ORDER_RECEIVED]:        'Vendor to ship within their SLA. Auto-shipment via ShipBubble kicks in.',
  [SlackEvent.VENDOR_SUBSCRIPTION_UPGRADED]: 'Congrats message auto-sent. Consider onboarding call.',
  [SlackEvent.VENDOR_SUBSCRIPTION_EXPIRED]:  'Vendor moved to free tier — features restricted. Follow up on renewal.',
  [SlackEvent.VENDOR_DISPUTE_RECEIVED]:      'Vendor has 48h to respond. Watch dashboard for their reply.',
  [SlackEvent.VENDOR_STORE_DEACTIVATED]:     'All products hidden. Follow up to understand reason if unexpected.',

  // Customer journey
  [SlackEvent.CUSTOMER_REGISTERED]:          'Verify email OTP within 10 minutes. If not verified in 24h, follow up.',
  [SlackEvent.CUSTOMER_EMAIL_VERIFIED]:      'Welcome email sent. Ready to browse and place first order.',
  [SlackEvent.CUSTOMER_PROFILE_UPDATED]:     'No action needed.',
  [SlackEvent.CUSTOMER_FIRST_ORDER]:         '🎉 First order! Ensure smooth delivery. Consider first-time thank-you touch.',
  [SlackEvent.CUSTOMER_ORDER_PLACED]:        'Order queued for vendor fulfillment. Auto-shipment via ShipBubble.',
  [SlackEvent.CUSTOMER_ORDER_CANCELLED]:     'Check reason. Refund auto-processed if paid.',
  [SlackEvent.CUSTOMER_ORDER_DELIVERED]:     'Auto-review request goes out in 24h. Auto-complete in 7 days.',
  [SlackEvent.CUSTOMER_HIGH_VALUE_ORDER]:    '💰 VIP-tier order. Ensure fast fulfillment. Consider personal touch.',
  [SlackEvent.CUSTOMER_DISPUTE_OPENED]:      'Admin to review within 24h. Vendor has 48h to respond.',
  [SlackEvent.CUSTOMER_CART_ABANDONED]:      'Reminder email auto-sent. Consider small discount for high-value carts.',
  [SlackEvent.CUSTOMER_COMEBACK_TRIGGERED]:  '30-day silent — comeback email sent. Consider curated recommendations.',
  [SlackEvent.CUSTOMER_ACCOUNT_DELETED]:     'Data purged per privacy policy. Log preserved for audit.',

  // Ambassador journey
  [SlackEvent.AMBASSADOR_APPLIED]:           'Admin to review application in Ambassador admin panel — approve or reject.',
  [SlackEvent.AMBASSADOR_APPROVED]:          'Invite email sent. Ambassador should complete signup + share their code.',
  [SlackEvent.AMBASSADOR_REJECTED]:          'Follow-up email sent. No further action needed.',
  [SlackEvent.AMBASSADOR_FIRST_REFERRAL]:    '🎊 Ambassador just made their first referral! Encourage them to share more.',
  [SlackEvent.AMBASSADOR_MILESTONE_REACHED]: 'Payout auto-triggered. Verify in wallet transactions.',
  [SlackEvent.AMBASSADOR_COMMISSION_EARNED]: 'Commission added to wallet. Ambassador can request payout.',
};

// Events that should @-mention admins for follow-up
const MENTION_ON: Set<SlackEvent> = new Set([
  SlackEvent.VENDOR_REGISTERED,           // follow-up if OTP not verified
  SlackEvent.VENDOR_EMAIL_VERIFIED,       // nudge to complete profile if idle
  SlackEvent.VENDOR_NIN_SUBMITTED,        // admin needs to review
  SlackEvent.VENDOR_KYC_DOC_UPLOADED,     // admin needs to review
  SlackEvent.VENDOR_KYC_REJECTED,         // follow-up needed
  SlackEvent.VENDOR_DISPUTE_RECEIVED,     // needs admin eyes
  SlackEvent.VENDOR_SUBSCRIPTION_EXPIRED, // sales opportunity
  SlackEvent.CUSTOMER_REGISTERED,         // follow-up if OTP not verified
  SlackEvent.CUSTOMER_FIRST_ORDER,        // celebrate + ensure smooth delivery
  SlackEvent.CUSTOMER_HIGH_VALUE_ORDER,   // VIP handling
  SlackEvent.CUSTOMER_DISPUTE_OPENED,     // needs admin resolution
  SlackEvent.CUSTOMER_CART_ABANDONED,     // sales opportunity
  SlackEvent.CUSTOMER_COMEBACK_TRIGGERED, // retention opportunity
  SlackEvent.AMBASSADOR_APPLIED,          // admin needs to review
  SlackEvent.AMBASSADOR_FIRST_REFERRAL,   // celebrate
]);

export interface TrackEventOptions {
  actor?: {
    id?: string;
    name?: string;
    email?: string;
  };
  message?: string;
  meta?: Record<string, any>;
  /** Override default next-step guidance for this event. */
  nextStep?: string;
  /** Force mention on/off — otherwise MENTION_ON set decides. */
  mention?: boolean;
}

/**
 * Fire a user-journey event to the correct Slack channel.
 * NEVER throws. Safe to call from any controller.
 * The Slack queue handles retries; a Slack outage never blocks the caller.
 */
export function trackEvent(event: SlackEvent, opts: TrackEventOptions = {}): void {
  const channel = channelFor(event);
  const emoji = EVENT_EMOJI[event] || '•';
  const message = opts.message
    || `${opts.actor?.name || opts.actor?.email || 'A user'} triggered ${event.replace(/_/g, ' ')}`;
  const nextStep = opts.nextStep ?? DEFAULT_NEXT_STEP[event];
  const mention = opts.mention ?? MENTION_ON.has(event);

  // Fire-and-forget — never await, never block the caller
  enqueueSlack({
    channel,
    event,
    actor: opts.actor,
    message,
    meta: opts.meta,
    emoji,
    nextStep,
    mention,
  }).catch((err) => {
    logger.error(`[trackEvent] Failed to enqueue ${event}`, { error: err?.message });
  });
}
