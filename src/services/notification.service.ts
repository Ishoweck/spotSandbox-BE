import { NotificationType } from '../types';
import { Notification } from '../models/Additional';
import User from '../models/User';
import { sendPushNotification } from '../config/firebase';
import { logger } from '../utils/logger';
import { Server as SocketServer } from 'socket.io';

// Socket.io instance - set from server.ts after initialization
let ioInstance: SocketServer | null = null;

export const setSocketInstance = (io: SocketServer) => {
  ioInstance = io;
};

interface NotifyOptions {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  link?: string;
}

interface NotifyManyOptions {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  link?: string;
  skipPush?: boolean;
}

class NotificationService {
  /**
   * Send notification to a single user (in-app + push)
   */
  async send(options: NotifyOptions): Promise<void> {
    const { userId, type, title, message, data, link } = options;

    try {
      // 1. Create in-app notification
      const notification = await Notification.create({
        user: userId,
        type,
        title,
        message,
        data,
        link,
      });

      // 2. Emit real-time socket event so frontend updates instantly
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

      // 3. Send push notification
      const user = await User.findById(userId).select('fcmTokens');
      if (user?.fcmTokens && user.fcmTokens.length > 0) {
        const pushData: Record<string, string> = {
          type,
          ...(link ? { link } : {}),
          ...(data ? { payload: JSON.stringify(data) } : {}),
        };
        await sendPushNotification(user.fcmTokens, title, message, pushData);
      }

      logger.info(`Notification sent to ${userId}: [${type}] ${title}`);
    } catch (error: any) {
      logger.error(`Failed to send notification to ${userId}:`, error.message);
    }
  }

  /**
   * Send notification to multiple users
   */
  async sendToMany(options: NotifyManyOptions): Promise<void> {
    const { userIds, type, title, message, data, link, skipPush } = options;

    const uniqueIds = [...new Set(userIds)];

    // Batch create in-app notifications
    const docs = uniqueIds.map((userId) => ({
      user: userId,
      type,
      title,
      message,
      data,
      link,
    }));

    try {
      await Notification.insertMany(docs);
    } catch (error: any) {
      logger.error('Bulk notification insert error:', error.message);
    }

    // Emit real-time socket events to each user.
    // We intentionally omit per-user unreadCount here — doing N countDocuments
    // queries sequentially would block for thousands of users. The client fetches
    // the fresh count on its own when it receives the event.
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

    // Send push notifications (skipped when caller handles push separately)
    if (!skipPush) {
      try {
        const users = await User.find({
          _id: { $in: uniqueIds },
          fcmTokens: { $exists: true, $not: { $size: 0 } },
        }).select('fcmTokens');

        const allTokens = users.flatMap((u) => u.fcmTokens);
        if (allTokens.length > 0) {
          const pushData: Record<string, string> = {
            type,
            ...(link ? { link } : {}),
            ...(data ? { payload: JSON.stringify(data) } : {}),
          };
          await sendPushNotification(allTokens, title, message, pushData);
        }
      } catch (error: any) {
        logger.error('Bulk push notification error:', error.message);
      }
    }

    logger.info(`Notification sent to ${uniqueIds.length} users: [${type}] ${title}`);
  }

  // ================================================================
  // ORDER NOTIFICATIONS
  // ================================================================

  async orderPlaced(orderId: string, orderNumber: string, total: number, customerId: string, vendorIds: string[]): Promise<void> {
    // Notify customer
    await this.send({
      userId: customerId,
      type: NotificationType.ORDER,
      title: 'Order Placed! 🎉',
      message: `Order #${orderNumber} is in! We've notified your vendor and you'll get updates as it moves.`,
      data: { orderId, orderNumber },
      link: `/orders/${orderId}`,
    });

    // Notify each vendor
    await this.sendToMany({
      userIds: vendorIds,
      type: NotificationType.ORDER,
      title: '🛍️ New Order Received',
      message: `New order #${orderNumber} just came in! Tap to review and confirm.`,
      data: { orderId, orderNumber },
      link: `/vendor/orders/${orderId}`,
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
    });
  }

  async orderCancelled(orderId: string, orderNumber: string, customerId: string, vendorIds: string[], cancelledBy: 'customer' | 'vendor'): Promise<void> {
    if (cancelledBy === 'customer') {
      // Notify vendors
      await this.sendToMany({
        userIds: vendorIds,
        type: NotificationType.ORDER,
        title: 'Order Cancelled',
        message: `Order #${orderNumber} was cancelled by the customer. Stock has been restored.`,
        data: { orderId, orderNumber },
        link: `/vendor/orders/${orderId}`,
      });
    } else {
      // Notify customer
      await this.send({
        userId: customerId,
        type: NotificationType.ORDER,
        title: 'Order Cancelled',
        message: `Order #${orderNumber} was cancelled by your vendor. Your refund is headed to your wallet.`,
        data: { orderId, orderNumber },
        link: `/orders/${orderId}`,
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
    });
  }

  async walletTransfer(senderId: string, recipientId: string, amount: number, senderName: string, recipientName: string): Promise<void> {
    // Notify sender
    await this.send({
      userId: senderId,
      type: NotificationType.PAYMENT,
      title: 'Transfer Sent',
      message: `You sent ₦${amount.toLocaleString()} to ${recipientName}.`,
      data: { amount, recipientName },
      link: '/wallet',
    });

    // Notify recipient
    await this.send({
      userId: recipientId,
      type: NotificationType.PAYMENT,
      title: 'Transfer Received',
      message: `You received ₦${amount.toLocaleString()} from ${senderName}.`,
      data: { amount, senderName },
      link: '/wallet',
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
    });
  }

  async badgeEarned(userId: string, badge: string): Promise<void> {
    const badgeNames: Record<string, string> = {
      'first-purchase': 'First Purchase',
      'loyal-customer': 'Loyal Customer',
      'vip-customer': 'VIP Customer',
      'high-spender': 'High Spender',
      'century-shopper': 'Century Shopper',
      'big-spender': 'Big Spender',
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
    };

    await this.send({
      userId,
      type: NotificationType.SYSTEM,
      title: '🏅 New Badge Unlocked!',
      message: `Congratulations! You earned the "${badgeNames[badge] || badge}" badge!`,
      data: { type: 'badge', badge },
      link: '/rewards',
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
    });

    await this.send({
      userId: buyerId,
      type: NotificationType.ORDER,
      title: 'Dispute Under Review',
      message: `Your dispute for order #${orderNumber} is under review. We'll update you shortly.`,
      data: { orderId, orderNumber, disputeId },
      link: `/disputes`,
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
    });

    await this.send({
      userId: buyerId,
      type: NotificationType.ORDER,
      title: '✅ Dispute Resolved',
      message: `Dispute for order #${orderNumber} resolved: ${resolution}. Tap to see details.`,
      data: { orderId, orderNumber, resolution, disputeId },
      link: `/disputes`,
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
    });
  }

  // ================================================================
  // VENDOR SALES NOTIFICATION
  // ================================================================

  // ================================================================
  // CHALLENGE NOTIFICATIONS
  // ================================================================

  /**
   * Notify relevant users when a new challenge is created
   */
  async newChallengeCreated(challengeId: string, title: string, description: string, type: 'buyer' | 'seller' | 'affiliate'): Promise<void> {
    // Map challenge type to user role / filter
    let filter: any = {};
    if (type === 'buyer') {
      filter.role = 'customer';
    } else if (type === 'seller') {
      filter.role = 'vendor';
    } else if (type === 'affiliate') {
      filter.isAffiliate = true;
    }

    const users = await User.find(filter).select('_id');
    const userIds = users.map((u) => u._id.toString());

    if (userIds.length === 0) return;

    await this.sendToMany({
      userIds,
      type: NotificationType.CHALLENGE,
      title: 'New Challenge Available!',
      message: `"${title}" - ${description}`,
      data: { challengeId },
      link: '/challenges',
    });
  }

  /**
   * Notify a user when they complete a challenge
   */
  async challengeCompleted(userId: string, challengeId: string, challengeTitle: string): Promise<void> {
    await this.send({
      userId,
      type: NotificationType.CHALLENGE,
      title: 'Challenge Completed!',
      message: `Congratulations! You completed "${challengeTitle}". Claim your reward now!`,
      data: { challengeId },
      link: '/challenges',
    });
  }

  /**
   * Notify a user when they claim a challenge reward
   */
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
    });
  }

  // ================================================================
  // STOCK ALERT NOTIFICATIONS
  // ================================================================

  /**
   * Notify buyers who have a product in their cart when stock hits 0 or drops to ≤5.
   * Also emits a dedicated `product_stock_update` socket event so the cart UI
   * can react in real time without waiting for a screen refresh.
   */
  async productStockAlert(
    userIds: string[],
    productId: string,
    productName: string,
    newQuantity: number
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
    });

    // Dedicated real-time event so CartScreen can update badges instantly
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
    });
  }
}

export const notificationService = new NotificationService();

/**
 * Emit a real-time new_order event to all vendors when an order is placed.
 * Called from order.controller after order creation.
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
 * Called from webhook.controller after ShipBubble updates an order.
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

  // Notify customer
  ioInstance.to(`user_${payload.customerId}`).emit(event, data);

  // Notify each vendor
  if (payload.vendorIds) {
    payload.vendorIds.forEach((vendorId) => {
      ioInstance!.to(`user_${vendorId}`).emit(event, data);
    });
  }

  logger.info(`[Socket] order_status_update emitted → order ${payload.orderNumber} → ${payload.status}`);
};
