import { NotificationType } from '../types';
import { Notification } from '../models/Additional';
import User from '../models/User';
import { sendPushNotification } from '../config/firebase';
import { logger } from '../utils/logger';
import { Server as SocketServer } from 'socket.io';
import { pushQueue, broadcastQueue } from '../queues/notification.queue';
import crypto from 'crypto';

// Socket.io instance — set from server.ts after initialization
let ioInstance: SocketServer | null = null;

export const setSocketInstance = (io: SocketServer) => {
  ioInstance = io;
};

// Whether BullMQ queues are available (set after Redis connects)
let queueReady = false;
export const setQueueReady = (ready: boolean) => { queueReady = ready; };

interface NotifyOptions {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  link?: string;
  referenceId?: string; // for idempotency — e.g. orderId, eventId
}

interface NotifyManyOptions {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  link?: string;
  skipPush?: boolean;
  referenceId?: string;
}

function makeReferenceId(userId: string, type: string, extra?: string): string {
  const raw = `${userId}:${type}:${extra ?? Date.now()}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

class NotificationService {
  /**
   * Send notification to a single user.
   * In-app record + socket emit are synchronous (instant UX).
   * FCM push is queued via BullMQ (reliable, with retries).
   */
  async send(options: NotifyOptions): Promise<void> {
    const { userId, type, title, message, data, link, referenceId } = options;

    try {
      // 1. Create in-app notification (synchronous — instant)
      const notification = await Notification.create({
        user: userId,
        type,
        title,
        message,
        data,
        link,
        pushStatus: 'pending',
      });

      // 2. Emit real-time socket event (synchronous — instant UX)
      if (ioInstance) {
        const unreadCount = await Notification.countDocuments({ user: userId, read: false });
        ioInstance.to(`user_${userId}`).emit('new_notification', {
          notification: {
            _id: notification._id,
            type,
            title,
            message,
            data,
            link,
            read: false,
            createdAt: (notification as any).createdAt,
          },
          unreadCount,
        });
      }

      // 3. Queue push notification (async — reliable delivery with retries)
      const refId = referenceId ?? makeReferenceId(userId, type, data?.orderId ?? data?.eventId);

      if (queueReady) {
        await pushQueue.add(`push:${type}`, {
          notificationId: notification._id.toString(),
          userId,
          type,
          title,
          message,
          data,
          link,
          referenceId: refId,
        });
      } else {
        // Fallback: direct FCM send if Redis/BullMQ is unavailable
        await this._directPush(userId, type, title, message, data, link);
        await Notification.findByIdAndUpdate(notification._id, { pushStatus: 'sent' });
      }

      logger.info(`Notification queued for ${userId}: [${type}] ${title}`);
    } catch (error: any) {
      logger.error(`Failed to send notification to ${userId}:`, error.message);
    }
  }

  /**
   * Send notification to multiple users.
   * In-app records inserted in bulk (synchronous).
   * Push is queued per user (async).
   */
  async sendToMany(options: NotifyManyOptions): Promise<void> {
    const { userIds, type, title, message, data, link, skipPush, referenceId } = options;

    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return;

    // Batch create in-app notifications
    const docs = uniqueIds.map((userId) => ({
      user: userId,
      type,
      title,
      message,
      data,
      link,
      pushStatus: 'pending' as const,
    }));

    try {
      await Notification.insertMany(docs);
    } catch (error: any) {
      logger.error('Bulk notification insert error:', error.message);
    }

    // Emit socket events — omit per-user unreadCount to avoid N queries
    if (ioInstance) {
      for (const userId of uniqueIds) {
        try {
          ioInstance.to(`user_${userId}`).emit('new_notification', {
            notification: { type, title, message, data, link, read: false, createdAt: new Date() },
          });
        } catch {
          // Non-critical
        }
      }
    }

    if (skipPush) return;

    // Queue push jobs per user (each gets idempotency + preference check in worker)
    if (queueReady) {
      const jobs = uniqueIds.map((userId) => ({
        name: `push:${type}`,
        data: {
          notificationId: '',
          userId,
          type,
          title,
          message,
          data,
          link,
          referenceId: referenceId ?? makeReferenceId(userId, type, data?.eventId),
        },
      }));

      await pushQueue.addBulk(jobs);
    } else {
      // Fallback: direct FCM batch
      try {
        const users = await User.find({
          _id: { $in: uniqueIds },
          fcmTokens: { $exists: true, $not: { $size: 0 } },
        }).select('fcmTokens').lean();

        const allTokens = (users as any[]).flatMap((u) => u.fcmTokens as string[]);
        if (allTokens.length > 0) {
          const pushData: Record<string, string> = {
            type,
            ...(link ? { link } : {}),
            ...(data ? { payload: JSON.stringify(data) } : {}),
          };
          await sendPushNotification(allTokens, title, message, pushData);
        }
      } catch (error: any) {
        logger.error('Bulk push fallback error:', error.message);
      }
    }

    logger.info(`Notification sent to ${uniqueIds.length} users: [${type}] ${title}`);
  }

  /**
   * Fan-out broadcast to a large filtered user set.
   * Paginates users in 10k chunks and queues each chunk separately.
   * Prevents loading millions of IDs into memory at once.
   */
  private async _broadcastToFilter(
    filter: Record<string, any>,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
    link?: string,
  ): Promise<void> {
    const CHUNK_SIZE = 10_000;
    let skip = 0;
    let totalQueued = 0;
    const referenceId = makeReferenceId('broadcast', type, JSON.stringify(filter));

    while (true) {
      const users = await User.find(filter)
        .select('_id')
        .skip(skip)
        .limit(CHUNK_SIZE)
        .lean();

      if (users.length === 0) break;

      const userIds = (users as any[]).map((u) => u._id.toString());

      // Queue each chunk as an independent broadcast job
      if (queueReady) {
        await broadcastQueue.add(`broadcast:${type}:chunk:${skip}`, {
          userIds,
          type,
          title,
          message,
          data,
          link,
          referenceId: `${referenceId}:${skip}`,
        });
      } else {
        // Fallback: send directly for this chunk
        await this.sendToMany({ userIds, type, title, message, data, link });
      }

      totalQueued += users.length;
      skip += CHUNK_SIZE;

      if (users.length < CHUNK_SIZE) break;
    }

    logger.info(`[Broadcast] Queued ${totalQueued} users for [${type}] in chunks of ${CHUNK_SIZE}`);
  }

  /** Direct FCM push — used only as a fallback when BullMQ is unavailable */
  private async _directPush(
    userId: string,
    type: string,
    title: string,
    message: string,
    data?: Record<string, any>,
    link?: string,
  ): Promise<void> {
    try {
      const user = await User.findById(userId).select('fcmTokens').lean();
      const tokens: string[] = (user as any)?.fcmTokens ?? [];
      if (tokens.length === 0) return;

      const pushData: Record<string, string> = {
        type,
        ...(link ? { link } : {}),
        ...(data ? { payload: JSON.stringify(data) } : {}),
      };
      await sendPushNotification(tokens, title, message, pushData);
    } catch (err: any) {
      logger.error(`[DirectPush] Failed for ${userId}:`, err.message);
    }
  }

  // ================================================================
  // ORDER NOTIFICATIONS
  // ================================================================

  async orderPlaced(orderId: string, orderNumber: string, total: number, customerId: string, vendorIds: string[]): Promise<void> {
    await this.send({
      userId: customerId,
      type: NotificationType.ORDER,
      title: 'Order Placed! 🎉',
      message: `Order #${orderNumber} is in! We've notified your vendor and you'll get updates as it moves.`,
      data: { orderId, orderNumber },
      link: `/orders/${orderId}`,
      referenceId: `order_placed:${orderId}`,
    });

    await this.sendToMany({
      userIds: vendorIds,
      type: NotificationType.ORDER,
      title: '🛍️ New Order Received',
      message: `New order #${orderNumber} just came in! Tap to review and confirm.`,
      data: { orderId, orderNumber },
      link: `/vendor/orders/${orderId}`,
      referenceId: `order_placed_vendor:${orderId}`,
    });
  }

  async orderStatusUpdated(orderId: string, orderNumber: string, status: string, customerId: string): Promise<void> {
    const statusConfig: Record<string, { title: string; message: string }> = {
      pending:            { title: 'Order Received 🛍️',          message: `Order #${orderNumber} has been placed and is waiting for vendor confirmation.` },
      confirmed:          { title: 'Order Confirmed ✅',           message: `Your vendor confirmed order #${orderNumber} and is getting it ready for you.` },
      processing:         { title: 'Order Being Packed 📦',        message: `Order #${orderNumber} is being packed and prepped for dispatch.` },
      shipped:            { title: 'Order Shipped 🚚',             message: `Order #${orderNumber} is on its way! Your courier has it — tap to track.` },
      in_transit:         { title: 'Out for Delivery 🚚',          message: `Your order #${orderNumber} is moving — expected delivery coming soon.` },
      delivered:          { title: 'Order Delivered! 🎉',          message: `Order #${orderNumber} delivered! Hope you love it. Tap to confirm receipt.` },
      cancelled:          { title: 'Order Cancelled',              message: `Order #${orderNumber} was cancelled. If you paid, a refund is on its way to your wallet.` },
      refunded:           { title: 'Refund Processed 💸',          message: `Your refund for order #${orderNumber} has been processed and added to your wallet.` },
      shipment_received:  { title: 'Delivery Confirmed 📬',        message: `Your customer confirmed delivery of order #${orderNumber}. Payment will be released to your wallet.` },
      failed:             { title: 'Order Failed',                 message: `Something went wrong with order #${orderNumber}. Please contact support if you need help.` },
      disputed:           { title: 'Order Disputed ⚠️',           message: `A dispute has been opened on order #${orderNumber}. Our team will review and reach out.` },
    };

    const { title, message } = statusConfig[status] ?? {
      title: `Order Update`,
      message: `Your order #${orderNumber} status has been updated to ${status}.`,
    };

    await this.send({
      userId: customerId,
      type: NotificationType.ORDER,
      title,
      message,
      data: { orderId, orderNumber, status },
      link: `/orders/${orderId}`,
      referenceId: `order_status:${orderId}:${status}`,
    });
  }

  async orderCancelled(orderId: string, orderNumber: string, customerId: string, vendorIds: string[], cancelledBy: 'customer' | 'vendor'): Promise<void> {
    if (cancelledBy === 'customer') {
      await this.sendToMany({
        userIds: vendorIds,
        type: NotificationType.ORDER,
        title: 'Order Cancelled',
        message: `Order #${orderNumber} was cancelled by the customer. Stock has been restored.`,
        data: { orderId, orderNumber },
        link: `/vendor/orders/${orderId}`,
        referenceId: `order_cancelled:${orderId}`,
      });
    } else {
      await this.send({
        userId: customerId,
        type: NotificationType.ORDER,
        title: 'Order Cancelled',
        message: `Order #${orderNumber} was cancelled by your vendor. Your refund is headed to your wallet.`,
        data: { orderId, orderNumber },
        link: `/orders/${orderId}`,
        referenceId: `order_cancelled:${orderId}`,
      });
    }
  }

  // ================================================================
  // PAYMENT NOTIFICATIONS
  // ================================================================

  async paymentCompleted(orderId: string, orderNumber: string, amount: number, userId: string): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.PAYMENT,
      title: 'Payment Successful 💳',
      message: `₦${amount.toLocaleString()} received — your order #${orderNumber} is now being processed.`,
      data: { orderId, orderNumber, amount },
      link: `/orders/${orderId}`,
      referenceId: `payment_completed:${orderId}`,
    });
  }

  async insufficientWalletBalance(userId: string, required: number, current: number): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.PAYMENT,
      title: 'Insufficient Wallet Balance',
      message: `You need ₦${required.toLocaleString()} to complete this order, but your wallet only has ₦${current.toLocaleString()}. Please top up and try again.`,
      data: { required, current },
      link: '/wallet',
      referenceId: makeReferenceId(userId, 'insufficient_balance', `${required}`),
    });
  }

  async walletTopUp(userId: string, amount: number, newBalance: number): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.PAYMENT,
      title: 'Wallet Top-Up Successful',
      message: `₦${amount.toLocaleString()} has been added to your wallet. New balance: ₦${newBalance.toLocaleString()}.`,
      data: { amount, newBalance },
      link: '/wallet',
      referenceId: makeReferenceId(userId, 'wallet_topup', `${amount}:${Date.now()}`),
    });
  }

  async walletWithdrawalRequested(userId: string, amount: number): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.PAYMENT,
      title: 'Withdrawal Requested',
      message: `Your withdrawal of ₦${amount.toLocaleString()} is being processed. It will be completed within 1-3 business days.`,
      data: { amount },
      link: '/wallet',
      referenceId: makeReferenceId(userId, 'withdrawal_requested', `${amount}:${Date.now()}`),
    });
  }

  async walletWithdrawalProcessed(userId: string, amount: number, status: 'completed' | 'failed'): Promise<void> {
    const title = status === 'completed' ? 'Withdrawal Completed' : 'Withdrawal Failed';
    const message = status === 'completed'
      ? `Your withdrawal of ₦${amount.toLocaleString()} has been completed.`
      : `Your withdrawal of ₦${amount.toLocaleString()} failed. The amount has been returned to your wallet.`;

    await this.send({
      userId,
      type: NotificationType.PAYMENT,
      title,
      message,
      data: { amount, status },
      link: '/wallet',
      referenceId: makeReferenceId(userId, `withdrawal_${status}`, `${amount}:${Date.now()}`),
    });
  }

  async walletTransfer(senderId: string, recipientId: string, amount: number, senderName: string, recipientName: string): Promise<void> {
    const refBase = makeReferenceId(senderId, 'transfer', `${recipientId}:${amount}:${Date.now()}`);

    await this.send({
      userId: senderId,
      type: NotificationType.PAYMENT,
      title: 'Transfer Sent',
      message: `You sent ₦${amount.toLocaleString()} to ${recipientName}.`,
      data: { amount, recipientName },
      link: '/wallet',
      referenceId: `transfer_sent:${refBase}`,
    });

    await this.send({
      userId: recipientId,
      type: NotificationType.PAYMENT,
      title: 'Transfer Received',
      message: `You received ₦${amount.toLocaleString()} from ${senderName}.`,
      data: { amount, senderName },
      link: '/wallet',
      referenceId: `transfer_recv:${refBase}`,
    });
  }

  async refundIssued(userId: string, orderNumber: string, amount: number): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.PAYMENT,
      title: 'Refund Processed 💸',
      message: `₦${amount.toLocaleString()} refund for order #${orderNumber} has landed in your VendorSpot wallet.`,
      data: { orderNumber, amount },
      link: '/wallet',
      referenceId: `refund:${orderNumber}:${userId}`,
    });
  }

  // ================================================================
  // DELIVERY NOTIFICATIONS
  // ================================================================

  async deliveryStatusUpdate(orderId: string, orderNumber: string, status: string, customerId: string): Promise<void> {
    const statusConfig: Record<string, { title: string; message: string }> = {
      picked_up:  { title: 'Parcel Picked Up 📦',      message: `Order #${orderNumber} picked up! Your courier has it and is heading out.` },
      in_transit: { title: 'On the Move 🚚',            message: `Order #${orderNumber} is in transit — your courier is on the move!` },
      delivered:  { title: 'Delivered! 🎉',             message: `Order #${orderNumber} delivered! Tap to confirm receipt and release payment to your vendor.` },
      failed:     { title: 'Delivery Attempt Failed ⚠️', message: `Delivery attempt for order #${orderNumber} failed. The courier will retry — please verify your address.` },
    };

    const { title, message } = statusConfig[status] ?? {
      title: 'Delivery Update',
      message: `Delivery status for order #${orderNumber} updated to: ${status}.`,
    };

    await this.send({
      userId: customerId,
      type: NotificationType.DELIVERY,
      title,
      message,
      data: { orderId, orderNumber, status },
      link: `/orders/${orderId}`,
      referenceId: `delivery:${orderId}:${status}`,
    });
  }

  // ================================================================
  // REVIEW NOTIFICATIONS
  // ================================================================

  async newReviewOnProduct(vendorId: string, productName: string, rating: number, reviewerName: string): Promise<void> {
    await this.send({
      userId: vendorId,
      type: NotificationType.REVIEW,
      title: 'New Review',
      message: `${reviewerName} left a ${rating}-star review on "${productName}".`,
      data: { productName, rating },
      link: '/vendor/reviews',
      referenceId: makeReferenceId(vendorId, 'review', `${productName}:${Date.now()}`),
    });
  }

  async reviewReminder(userId: string, orderId: string, orderNumber: string, productName: string): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.REVIEW,
      title: 'Review Your Purchase',
      message: `How was "${productName}" from order #${orderNumber}? Share your experience!`,
      data: { orderId, orderNumber, productName },
      link: `/orders/${orderId}/review`,
      referenceId: `review_reminder:${orderId}`,
    });
  }

  // ================================================================
  // PROMOTION NOTIFICATIONS
  // ================================================================

  async newProductFromFollowedVendor(followerIds: string[], vendorName: string, productName: string, productId: string): Promise<void> {
    if (followerIds.length === 0) return;

    await this.sendToMany({
      userIds: followerIds,
      type: NotificationType.PROMOTION,
      title: 'New Arrival',
      message: `${vendorName} just listed "${productName}". Check it out!`,
      data: { productId, vendorName },
      link: `/products/${productId}`,
      referenceId: `new_product:${productId}`,
    });
  }

  async priceDrop(userIds: string[], productName: string, oldPrice: number, newPrice: number, productId: string): Promise<void> {
    if (userIds.length === 0) return;

    await this.sendToMany({
      userIds,
      type: NotificationType.PROMOTION,
      title: 'Price Drop',
      message: `"${productName}" dropped from ₦${oldPrice.toLocaleString()} to ₦${newPrice.toLocaleString()}!`,
      data: { productId, oldPrice, newPrice },
      link: `/products/${productId}`,
      referenceId: `price_drop:${productId}`,
    });
  }

  async dealOrOffer(userIds: string[], title: string, message: string, data?: Record<string, any>): Promise<void> {
    if (userIds.length === 0) return;

    await this.sendToMany({
      userIds,
      type: NotificationType.PROMOTION,
      title,
      message,
      data,
      referenceId: makeReferenceId('deal', title, `${Date.now()}`),
    });
  }

  // ================================================================
  // REWARD / POINTS NOTIFICATIONS
  // ================================================================

  async pointsEarned(userId: string, points: number, reason: string): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.SYSTEM,
      title: 'Points Earned',
      message: `You earned ${points} points for ${reason}!`,
      data: { points, reason },
      link: '/rewards',
      referenceId: makeReferenceId(userId, 'points_earned', `${points}:${Date.now()}`),
    });
  }

  async vCreditsExpiringSoon(userId: string, amount: number, daysLeft: number): Promise<void> {
    const dayLabel = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    await this.send({
      userId,
      type: NotificationType.SYSTEM,
      title: '⏳ VCredits Expiring Soon',
      message: `₦${amount.toLocaleString()} VCredits expire ${dayLabel}. Use them at checkout or earn more to reset the timer!`,
      data: { type: 'points', amount, daysLeft },
      link: '/rewards',
      referenceId: `vcredits_expiry:${userId}:${daysLeft}`,
    });
  }

  async pointsExpiringSoon(userId: string, totalPoints: number, daysLeft: number): Promise<void> {
    const dayLabel = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    await this.send({
      userId,
      type: NotificationType.SYSTEM,
      title: '⏳ Points Expiring Soon',
      message: `You have ${totalPoints.toLocaleString()} points expiring ${dayLabel}. Redeem them for VCredits before they're gone!`,
      data: { type: 'points', totalPoints, daysLeft },
      link: '/rewards',
      referenceId: `points_expiry:${userId}:${daysLeft}`,
    });
  }

  async badgeEarned(userId: string, badge: string): Promise<void> {
    const badgeNames: Record<string, string> = {
      'first-purchase': 'First Purchase',
      'loyal-customer': 'Loyal Customer',
      'vip-customer': 'VIP Customer',
      'century-shopper': 'Century Shopper',
      'big-spender': 'Big Spender',
      'high-spender': 'High Spender',
      'whale': 'Whale',
      'flash-buyer': 'Flash Buyer',
      'first-review': 'First Review',
      'top-reviewer': 'Top Reviewer',
      'five-star-fan': '5-Star Fan',
      'streak-3': '3-Day Streak',
      'streak-7': 'Week Warrior',
      'streak-30': 'On Fire!',
      'referral-rookie': 'Referral Rookie',
      'connector': 'Connector',
      'wishlist-collector': 'Wishlist Collector',
      'explorer': 'Explorer',
      'verified-identity': 'Verified Identity',
      'early-adopter': 'Early Adopter',
      'vendor-first-sale': 'First Sale',
      'vendor-ten-sales': '10 Sales',
      'vendor-fifty-sales': '50 Sales',
      'vendor-century-seller': 'Century Seller',
      'vendor-revenue-50k': '₦50k Revenue',
      'vendor-revenue-500k': '₦500k Revenue',
      'vendor-millionaire': 'Millionaire',
      'vendor-first-listing': 'First Listing',
      'vendor-ten-products': '10 Products',
      'vendor-prolific': 'Prolific Seller',
      'vendor-five-star': 'Five Star',
      'vendor-highly-rated': 'Highly Rated',
      'vendor-verified-store': 'Verified Store',
      'vendor-early': 'Early Vendor',
    };

    await this.send({
      userId,
      type: NotificationType.SYSTEM,
      title: '🏅 New Badge Unlocked!',
      message: `Congratulations! You earned the "${badgeNames[badge] || badge}" badge!`,
      data: { type: 'badge', badge },
      link: '/rewards',
      referenceId: `badge:${userId}:${badge}`,
    });
  }

  async pointsRedeemed(userId: string, points: number, cashValue: number): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.SYSTEM,
      title: 'VCredits Earned!',
      message: `You converted ${points} points to ${cashValue.toLocaleString()} VCredits. Use them to pay for orders!`,
      data: { points, vCredits: cashValue },
      link: '/wallet',
      referenceId: makeReferenceId(userId, 'points_redeemed', `${points}:${Date.now()}`),
    });
  }

  // ================================================================
  // ACCOUNT NOTIFICATIONS
  // ================================================================

  async welcomeNotification(userId: string, firstName: string): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.ACCOUNT,
      title: 'Welcome to VendorSpot!',
      message: `Hi ${firstName}! Your account is now active. Start shopping or set up your vendor profile.`,
      data: {},
      link: '/',
      referenceId: `welcome:${userId}`,
    });
  }

  async vendorVerified(userId: string): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.ACCOUNT,
      title: 'Vendor Account Verified',
      message: 'Your vendor account has been verified! You can now start listing products.',
      data: {},
      link: '/vendor/products',
      referenceId: `vendor_verified:${userId}`,
    });
  }

  async vendorRejected(userId: string, reason?: string): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.ACCOUNT,
      title: 'Vendor Verification Update',
      message: reason
        ? `Your vendor application needs attention: ${reason}`
        : 'Your vendor application was not approved. Please update your documents and try again.',
      data: { reason },
      link: '/vendor/profile',
      referenceId: `vendor_rejected:${userId}`,
    });
  }

  // ================================================================
  // DISPUTE NOTIFICATIONS
  // ================================================================

  async disputeCreated(orderId: string, orderNumber: string, vendorId: string, buyerId: string, disputeId?: string): Promise<void> {
    await this.send({
      userId: vendorId,
      type: NotificationType.ORDER,
      title: '⚠️ Dispute Opened',
      message: `A dispute was opened on order #${orderNumber}. Please respond within 48 hours.`,
      data: { orderId, orderNumber, disputeId },
      link: `/vendor/disputes`,
      referenceId: `dispute_created_vendor:${disputeId ?? orderId}`,
    });

    await this.send({
      userId: buyerId,
      type: NotificationType.ORDER,
      title: 'Dispute Under Review',
      message: `Your dispute for order #${orderNumber} is under review. We'll update you shortly.`,
      data: { orderId, orderNumber, disputeId },
      link: `/disputes`,
      referenceId: `dispute_created_buyer:${disputeId ?? orderId}`,
    });
  }

  async disputeResolved(orderId: string, orderNumber: string, vendorId: string, buyerId: string, resolution: string, disputeId?: string): Promise<void> {
    await this.send({
      userId: vendorId,
      type: NotificationType.ORDER,
      title: '✅ Dispute Resolved',
      message: `Dispute for order #${orderNumber} resolved: ${resolution}. Tap to see details.`,
      data: { orderId, orderNumber, resolution, disputeId },
      link: `/vendor/disputes`,
      referenceId: `dispute_resolved_vendor:${disputeId ?? orderId}`,
    });

    await this.send({
      userId: buyerId,
      type: NotificationType.ORDER,
      title: '✅ Dispute Resolved',
      message: `Dispute for order #${orderNumber} resolved: ${resolution}. Tap to see details.`,
      data: { orderId, orderNumber, resolution, disputeId },
      link: `/disputes`,
      referenceId: `dispute_resolved_buyer:${disputeId ?? orderId}`,
    });
  }

  // ================================================================
  // REFERRAL NOTIFICATIONS
  // ================================================================

  async referralSignup(referrerId: string, refereeName: string): Promise<void> {
    await this.send({
      userId: referrerId,
      type: NotificationType.SYSTEM,
      title: 'Referral Success',
      message: `${refereeName} just signed up using your referral code! You'll earn rewards when they make their first purchase.`,
      data: { refereeName },
      link: '/rewards',
      referenceId: makeReferenceId(referrerId, 'referral_signup', `${refereeName}:${Date.now()}`),
    });
  }

  async referralPurchase(referrerId: string, commission: number): Promise<void> {
    await this.send({
      userId: referrerId,
      type: NotificationType.SYSTEM,
      title: 'Referral Commission',
      message: `You earned ₦${commission.toLocaleString()} from a referral purchase!`,
      data: { commission },
      link: '/wallet',
      referenceId: makeReferenceId(referrerId, 'referral_commission', `${commission}:${Date.now()}`),
    });
  }

  // ================================================================
  // CHALLENGE NOTIFICATIONS
  // ================================================================

  async newChallengeCreated(challengeId: string, title: string, description: string, type: 'buyer' | 'seller' | 'affiliate'): Promise<void> {
    let filter: Record<string, any> = {};
    if (type === 'buyer') filter.role = 'customer';
    else if (type === 'seller') filter.role = 'vendor';
    else if (type === 'affiliate') filter.isAffiliate = true;

    await this._broadcastToFilter(
      filter,
      NotificationType.CHALLENGE,
      'New Challenge Available!',
      `"${title}" - ${description}`,
      { challengeId },
      '/challenges',
    );
  }

  async challengeCompleted(userId: string, challengeId: string, challengeTitle: string): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.CHALLENGE,
      title: 'Challenge Completed!',
      message: `Congratulations! You completed "${challengeTitle}". Claim your reward now!`,
      data: { challengeId },
      link: '/challenges',
      referenceId: `challenge_completed:${userId}:${challengeId}`,
    });
  }

  async challengeRewardClaimed(userId: string, challengeId: string, challengeTitle: string, rewardType: string, rewardValue: number): Promise<void> {
    const rewardText = rewardType === 'cash'
      ? `₦${rewardValue.toLocaleString()} has been added to your wallet`
      : `${rewardValue} points have been added to your account`;

    await this.send({
      userId,
      type: NotificationType.CHALLENGE,
      title: 'Reward Claimed!',
      message: `Your reward for "${challengeTitle}" has been credited. ${rewardText}.`,
      data: { challengeId, rewardType, rewardValue },
      link: '/challenges',
      referenceId: `challenge_reward:${userId}:${challengeId}`,
    });
  }

  // ================================================================
  // STOCK ALERT NOTIFICATIONS
  // ================================================================

  async productStockAlert(
    userIds: string[],
    productId: string,
    productName: string,
    newQuantity: number,
  ): Promise<void> {
    if (userIds.length === 0) return;

    const isOutOfStock = newQuantity === 0;

    await this.sendToMany({
      userIds,
      type: NotificationType.PROMOTION,
      title: isOutOfStock ? 'Item Out of Stock' : 'Almost Gone!',
      message: isOutOfStock
        ? `"${productName}" in your cart just went out of stock. Remove it or check back later.`
        : `Hurry! Only ${newQuantity} left of "${productName}" in your cart — purchase while you can!`,
      data: { productId, productName, stock: newQuantity, event: isOutOfStock ? 'out_of_stock' : 'low_stock' },
      link: `/products/${productId}`,
      referenceId: `stock_alert:${productId}:${newQuantity}`,
    });

    // Real-time stock event for CartScreen UI update
    if (ioInstance) {
      for (const userId of userIds) {
        try {
          ioInstance.to(`user_${userId}`).emit('product_stock_update', { productId, newQuantity });
        } catch {
          // Non-critical
        }
      }
    }
  }

  // ================================================================
  // QUESTION NOTIFICATIONS
  // ================================================================

  async questionAsked(
    vendorId: string,
    askerName: string,
    questionPreview: string,
    productName: string,
    productId: string,
    questionId: string,
  ): Promise<void> {
    await this.send({
      userId: vendorId,
      type: NotificationType.QUESTION,
      title: `New Question on "${productName}"`,
      message: `${askerName} asked: "${questionPreview}"`,
      data: { productId, questionId, type: 'question' },
      referenceId: `question_asked:${questionId}`,
    });
  }

  async questionAnswered(
    customerId: string,
    vendorName: string,
    answerPreview: string,
    productName: string,
    productId: string,
    questionId: string,
  ): Promise<void> {
    await this.send({
      userId: customerId,
      type: NotificationType.QUESTION,
      title: `Your question was answered`,
      message: `${vendorName} replied to your question on "${productName}": "${answerPreview}"`,
      data: { productId, questionId, type: 'question' },
      referenceId: `question_answered:${questionId}`,
    });
  }

  async questionUnansweredReminder(
    vendorId: string,
    count: number,
    productName: string,
    productId: string,
    questionId: string,
    hoursElapsed: number,
  ): Promise<void> {
    const urgency = hoursElapsed >= 168 ? '⚠️ Final Reminder: ' : hoursElapsed >= 72 ? '⏰ Reminder: ' : '';
    const title = count === 1
      ? `${urgency}Unanswered Question`
      : `${urgency}${count} Unanswered Questions`;
    const message = count === 1
      ? `A customer is still waiting for your reply on "${productName}". Tap to answer now.`
      : `${count} customers are waiting for your replies. Answer them to keep your store active.`;

    await this.send({
      userId: vendorId,
      type: NotificationType.QUESTION,
      title,
      message,
      data: { productId, questionId, type: 'question' },
      referenceId: makeReferenceId(vendorId, `q_reminder_${hoursElapsed}h`, String(Math.floor(Date.now() / (6 * 3600000)))),
    });
  }

  // ================================================================
  // VENDOR SALES NOTIFICATION
  // ================================================================

  async vendorSaleCompleted(vendorId: string, orderNumber: string, amount: number, earnings: number): Promise<void> {
    await this.send({
      userId: vendorId,
      type: NotificationType.PAYMENT,
      title: '💰 Payment Released',
      message: `Order #${orderNumber} confirmed received! ₦${earnings.toLocaleString()} has been credited to your wallet.`,
      data: { orderNumber, amount, earnings },
      link: '/vendor/wallet',
      referenceId: `vendor_sale:${orderNumber}:${vendorId}`,
    });
  }
}

export const notificationService = new NotificationService();

/**
 * Emit a real-time new_order event to all vendors when an order is placed.
 */
export const emitNewOrder = (payload: {
  orderId: string;
  orderNumber: string;
  vendorIds: string[];
}) => {
  if (!ioInstance) return;

  const data = { orderId: payload.orderId, orderNumber: payload.orderNumber };

  payload.vendorIds.forEach((vendorId) => {
    ioInstance!.to(`user_${vendorId}`).emit('new_order', data);
  });

  logger.info(`[Socket] new_order emitted → order ${payload.orderNumber} → ${payload.vendorIds.length} vendors`);
};

/**
 * Emit a real-time order status update to the customer and all vendors on that order.
 */
export const emitOrderStatusUpdate = (payload: {
  orderId: string;
  orderNumber: string;
  status: string;
  customerId: string;
  vendorIds?: string[];
}) => {
  if (!ioInstance) return;

  const event = 'order_status_update';
  const data = {
    orderId: payload.orderId,
    orderNumber: payload.orderNumber,
    status: payload.status,
  };

  ioInstance.to(`user_${payload.customerId}`).emit(event, data);

  if (payload.vendorIds) {
    payload.vendorIds.forEach((vendorId) => {
      ioInstance!.to(`user_${vendorId}`).emit(event, data);
    });
  }

  logger.info(`[Socket] order_status_update emitted → order ${payload.orderNumber} → ${payload.status}`);
};
