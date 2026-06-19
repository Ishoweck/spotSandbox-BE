/**
 * Seeds all notification templates into MongoDB.
 * Run once before enabling the template-based push worker:
 *   npx ts-node scripts/seed-notification-templates.ts
 *
 * Safe to re-run — uses upsert so existing templates are updated, not duplicated.
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { NotificationTemplate } from '../src/models/NotificationTemplate';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vendorspot';

const templates = [
  // ORDER
  {
    notificationType: 'order', channel: 'push', locale: 'en',
    titleTemplate: 'Order Placed! 🎉',
    bodyTemplate: 'Order #{{orderNumber}} is in! We\'ve notified your vendor and you\'ll get updates as it moves.',
  },
  {
    notificationType: 'order_confirmed', channel: 'push', locale: 'en',
    titleTemplate: 'Order Confirmed ✅',
    bodyTemplate: 'Your vendor confirmed order #{{orderNumber}} and is getting it ready for you.',
  },
  {
    notificationType: 'order_shipped', channel: 'push', locale: 'en',
    titleTemplate: 'Order Shipped 🚚',
    bodyTemplate: 'Order #{{orderNumber}} is on its way! Your courier has it — tap to track.',
  },
  {
    notificationType: 'order_delivered', channel: 'push', locale: 'en',
    titleTemplate: 'Order Delivered! 🎉',
    bodyTemplate: 'Order #{{orderNumber}} delivered! Hope you love it. Tap to confirm receipt.',
  },
  {
    notificationType: 'order_cancelled', channel: 'push', locale: 'en',
    titleTemplate: 'Order Cancelled',
    bodyTemplate: 'Order #{{orderNumber}} was cancelled. If you paid, a refund is on its way to your wallet.',
  },
  // PAYMENT
  {
    notificationType: 'payment', channel: 'push', locale: 'en',
    titleTemplate: 'Payment Successful 💳',
    bodyTemplate: '₦{{amount}} received — your order #{{orderNumber}} is now being processed.',
  },
  {
    notificationType: 'refund', channel: 'push', locale: 'en',
    titleTemplate: 'Refund Processed 💸',
    bodyTemplate: '₦{{amount}} refund for order #{{orderNumber}} has landed in your VendorSpot wallet.',
  },
  {
    notificationType: 'wallet_topup', channel: 'push', locale: 'en',
    titleTemplate: 'Wallet Top-Up Successful',
    bodyTemplate: '₦{{amount}} has been added to your wallet. New balance: ₦{{newBalance}}.',
  },
  {
    notificationType: 'wallet_withdrawal_requested', channel: 'push', locale: 'en',
    titleTemplate: 'Withdrawal Requested',
    bodyTemplate: 'Your withdrawal of ₦{{amount}} is being processed. It will be completed within 1-3 business days.',
  },
  {
    notificationType: 'wallet_transfer_sent', channel: 'push', locale: 'en',
    titleTemplate: 'Transfer Sent',
    bodyTemplate: 'You sent ₦{{amount}} to {{recipientName}}.',
  },
  {
    notificationType: 'wallet_transfer_received', channel: 'push', locale: 'en',
    titleTemplate: 'Transfer Received',
    bodyTemplate: 'You received ₦{{amount}} from {{senderName}}.',
  },
  // DELIVERY
  {
    notificationType: 'delivery_picked_up', channel: 'push', locale: 'en',
    titleTemplate: 'Parcel Picked Up 📦',
    bodyTemplate: 'Order #{{orderNumber}} picked up! Your courier has it and is heading out.',
  },
  {
    notificationType: 'delivery_in_transit', channel: 'push', locale: 'en',
    titleTemplate: 'On the Move 🚚',
    bodyTemplate: 'Order #{{orderNumber}} is in transit — your courier is on the move!',
  },
  {
    notificationType: 'delivery_delivered', channel: 'push', locale: 'en',
    titleTemplate: 'Delivered! 🎉',
    bodyTemplate: 'Order #{{orderNumber}} delivered! Tap to confirm receipt and release payment to your vendor.',
  },
  {
    notificationType: 'delivery_failed', channel: 'push', locale: 'en',
    titleTemplate: 'Delivery Attempt Failed ⚠️',
    bodyTemplate: 'Delivery attempt for order #{{orderNumber}} failed. The courier will retry — please verify your address.',
  },
  // ACCOUNT
  {
    notificationType: 'account', channel: 'push', locale: 'en',
    titleTemplate: 'Welcome to VendorSpot!',
    bodyTemplate: 'Hi {{firstName}}! Your account is now active. Start shopping or set up your vendor profile.',
  },
  {
    notificationType: 'vendor_verified', channel: 'push', locale: 'en',
    titleTemplate: 'Vendor Account Verified ✅',
    bodyTemplate: 'Your vendor account has been verified! You can now start listing products.',
  },
  // PROMOTION
  {
    notificationType: 'new_product', channel: 'push', locale: 'en',
    titleTemplate: 'New Arrival from {{vendorName}}',
    bodyTemplate: '{{vendorName}} just listed "{{productName}}". Check it out!',
  },
  {
    notificationType: 'price_drop', channel: 'push', locale: 'en',
    titleTemplate: 'Price Drop 🎉',
    bodyTemplate: '"{{productName}}" dropped from ₦{{oldPrice}} to ₦{{newPrice}}!',
  },
  // CHALLENGE
  {
    notificationType: 'challenge', channel: 'push', locale: 'en',
    titleTemplate: 'New Challenge Available!',
    bodyTemplate: '"{{title}}" — {{description}}',
  },
  {
    notificationType: 'challenge_completed', channel: 'push', locale: 'en',
    titleTemplate: 'Challenge Completed! 🏆',
    bodyTemplate: 'Congratulations! You completed "{{challengeTitle}}". Claim your reward now!',
  },
  // SYSTEM
  {
    notificationType: 'badge', channel: 'push', locale: 'en',
    titleTemplate: '🏅 New Badge Unlocked!',
    bodyTemplate: 'Congratulations! You earned the "{{badgeName}}" badge!',
  },
  {
    notificationType: 'points_earned', channel: 'push', locale: 'en',
    titleTemplate: 'Points Earned ⭐',
    bodyTemplate: 'You earned {{points}} points for {{reason}}!',
  },
  {
    notificationType: 'points_expiry', channel: 'push', locale: 'en',
    titleTemplate: '⏳ Points Expiring Soon',
    bodyTemplate: 'You have {{totalPoints}} points expiring {{dayLabel}}. Redeem them for VCredits before they\'re gone!',
  },
  // DISPUTE
  {
    notificationType: 'dispute_opened', channel: 'push', locale: 'en',
    titleTemplate: '⚠️ Dispute Opened',
    bodyTemplate: 'A dispute was opened on order #{{orderNumber}}. Please respond within 48 hours.',
  },
  {
    notificationType: 'dispute_resolved', channel: 'push', locale: 'en',
    titleTemplate: '✅ Dispute Resolved',
    bodyTemplate: 'Dispute for order #{{orderNumber}} resolved: {{resolution}}. Tap to see details.',
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  let upserted = 0;
  for (const t of templates) {
    await NotificationTemplate.updateOne(
      { notificationType: t.notificationType, channel: t.channel, locale: t.locale },
      { $set: t },
      { upsert: true },
    );
    upserted++;
  }

  console.log(`✅ Seeded ${upserted} notification templates`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
