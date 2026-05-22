"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitOrderStatusUpdate = exports.emitNewOrder = exports.notificationService = exports.setSocketInstance = void 0;
const types_1 = require("../types");
const Additional_1 = require("../models/Additional");
const User_1 = __importDefault(require("../models/User"));
const firebase_1 = require("../config/firebase");
const logger_1 = require("../utils/logger");
// Socket.io instance - set from server.ts after initialization
let ioInstance = null;
const setSocketInstance = (io) => {
    ioInstance = io;
};
exports.setSocketInstance = setSocketInstance;
class NotificationService {
    /**
     * Send notification to a single user (in-app + push)
     */
    async send(options) {
        const { userId, type, title, message, data, link } = options;
        try {
            // 1. Create in-app notification
            const notification = await Additional_1.Notification.create({
                user: userId,
                type,
                title,
                message,
                data,
                link,
            });
            // 2. Emit real-time socket event so frontend updates instantly
            if (ioInstance) {
                const unreadCount = await Additional_1.Notification.countDocuments({ user: userId, read: false });
                ioInstance.to(`user_${userId}`).emit('new_notification', {
                    notification: {
                        _id: notification._id,
                        type,
                        title,
                        message,
                        data,
                        link,
                        read: false,
                        createdAt: notification.createdAt,
                    },
                    unreadCount,
                });
            }
            // 3. Send push notification
            const user = await User_1.default.findById(userId).select('fcmTokens');
            if (user?.fcmTokens && user.fcmTokens.length > 0) {
                const pushData = {
                    type,
                    ...(link ? { link } : {}),
                    ...(data ? { payload: JSON.stringify(data) } : {}),
                };
                await (0, firebase_1.sendPushNotification)(user.fcmTokens, title, message, pushData);
            }
            logger_1.logger.info(`Notification sent to ${userId}: [${type}] ${title}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to send notification to ${userId}:`, error.message);
        }
    }
    /**
     * Send notification to multiple users
     */
    async sendToMany(options) {
        const { userIds, type, title, message, data, link } = options;
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
            await Additional_1.Notification.insertMany(docs);
        }
        catch (error) {
            logger_1.logger.error('Bulk notification insert error:', error.message);
        }
        // Emit real-time socket events to each user
        if (ioInstance) {
            for (const userId of uniqueIds) {
                try {
                    const unreadCount = await Additional_1.Notification.countDocuments({ user: userId, read: false });
                    ioInstance.to(`user_${userId}`).emit('new_notification', {
                        notification: { type, title, message, data, link, read: false, createdAt: new Date() },
                        unreadCount,
                    });
                }
                catch (err) {
                    // Don't block on socket errors
                }
            }
        }
        // Send push notifications
        try {
            const users = await User_1.default.find({
                _id: { $in: uniqueIds },
                fcmTokens: { $exists: true, $not: { $size: 0 } },
            }).select('fcmTokens');
            const allTokens = users.flatMap((u) => u.fcmTokens);
            if (allTokens.length > 0) {
                const pushData = {
                    type,
                    ...(link ? { link } : {}),
                    ...(data ? { payload: JSON.stringify(data) } : {}),
                };
                await (0, firebase_1.sendPushNotification)(allTokens, title, message, pushData);
            }
        }
        catch (error) {
            logger_1.logger.error('Bulk push notification error:', error.message);
        }
        logger_1.logger.info(`Notification sent to ${uniqueIds.length} users: [${type}] ${title}`);
    }
    // ================================================================
    // ORDER NOTIFICATIONS
    // ================================================================
    async orderPlaced(orderId, orderNumber, total, customerId, vendorIds) {
        // Notify customer
        await this.send({
            userId: customerId,
            type: types_1.NotificationType.ORDER,
            title: 'Order Placed! 🎉',
            message: `Order #${orderNumber} is in! We've notified your vendor and you'll get updates as it moves.`,
            data: { orderId, orderNumber },
            link: `/orders/${orderId}`,
        });
        // Notify each vendor
        await this.sendToMany({
            userIds: vendorIds,
            type: types_1.NotificationType.ORDER,
            title: '🛍️ New Order Received',
            message: `New order #${orderNumber} just came in! Tap to review and confirm.`,
            data: { orderId, orderNumber },
            link: `/vendor/orders/${orderId}`,
        });
    }
    async orderStatusUpdated(orderId, orderNumber, status, customerId) {
        const statusConfig = {
            confirmed: { title: 'Order Confirmed ✅', message: `Your vendor confirmed order #${orderNumber} and is getting it ready for you.` },
            processing: { title: 'Order Being Packed 📦', message: `Order #${orderNumber} is being packed and prepped for dispatch.` },
            shipped: { title: 'Order Shipped 🚚', message: `Order #${orderNumber} is on its way! Your courier has it — tap to track.` },
            in_transit: { title: 'Out for Delivery 🚚', message: `Your order #${orderNumber} is moving — expected delivery coming soon.` },
            delivered: { title: 'Order Delivered! 🎉', message: `Order #${orderNumber} delivered! Hope you love it. Tap to confirm receipt.` },
            cancelled: { title: 'Order Cancelled', message: `Order #${orderNumber} was cancelled. If you paid, a refund is on its way to your wallet.` },
            refunded: { title: 'Refund Processed 💸', message: `Your refund for order #${orderNumber} has been processed and added to your wallet.` },
        };
        const { title, message } = statusConfig[status] ?? {
            title: `Order Update`,
            message: `Your order #${orderNumber} status has been updated to ${status}.`,
        };
        await this.send({
            userId: customerId,
            type: types_1.NotificationType.ORDER,
            title,
            message,
            data: { orderId, orderNumber, status },
            link: `/orders/${orderId}`,
        });
    }
    async orderCancelled(orderId, orderNumber, customerId, vendorIds, cancelledBy) {
        if (cancelledBy === 'customer') {
            // Notify vendors
            await this.sendToMany({
                userIds: vendorIds,
                type: types_1.NotificationType.ORDER,
                title: 'Order Cancelled',
                message: `Order #${orderNumber} was cancelled by the customer. Stock has been restored.`,
                data: { orderId, orderNumber },
                link: `/vendor/orders/${orderId}`,
            });
        }
        else {
            // Notify customer
            await this.send({
                userId: customerId,
                type: types_1.NotificationType.ORDER,
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
    async paymentCompleted(orderId, orderNumber, amount, userId) {
        await this.send({
            userId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Payment Successful 💳',
            message: `₦${amount.toLocaleString()} received — your order #${orderNumber} is now being processed.`,
            data: { orderId, orderNumber, amount },
            link: `/orders/${orderId}`,
        });
    }
    async walletTopUp(userId, amount, newBalance) {
        await this.send({
            userId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Wallet Top-Up Successful',
            message: `₦${amount.toLocaleString()} has been added to your wallet. New balance: ₦${newBalance.toLocaleString()}.`,
            data: { amount, newBalance },
            link: '/wallet',
        });
    }
    async walletWithdrawalRequested(userId, amount) {
        await this.send({
            userId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Withdrawal Requested',
            message: `Your withdrawal of ₦${amount.toLocaleString()} is being processed. It will be completed within 1-3 business days.`,
            data: { amount },
            link: '/wallet',
        });
    }
    async walletWithdrawalProcessed(userId, amount, status) {
        const title = status === 'completed' ? 'Withdrawal Completed' : 'Withdrawal Failed';
        const message = status === 'completed'
            ? `Your withdrawal of ₦${amount.toLocaleString()} has been completed.`
            : `Your withdrawal of ₦${amount.toLocaleString()} failed. The amount has been returned to your wallet.`;
        await this.send({
            userId,
            type: types_1.NotificationType.PAYMENT,
            title,
            message,
            data: { amount, status },
            link: '/wallet',
        });
    }
    async walletTransfer(senderId, recipientId, amount, senderName, recipientName) {
        // Notify sender
        await this.send({
            userId: senderId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Transfer Sent',
            message: `You sent ₦${amount.toLocaleString()} to ${recipientName}.`,
            data: { amount, recipientName },
            link: '/wallet',
        });
        // Notify recipient
        await this.send({
            userId: recipientId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Transfer Received',
            message: `You received ₦${amount.toLocaleString()} from ${senderName}.`,
            data: { amount, senderName },
            link: '/wallet',
        });
    }
    async refundIssued(userId, orderNumber, amount) {
        await this.send({
            userId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Refund Processed 💸',
            message: `₦${amount.toLocaleString()} refund for order #${orderNumber} has landed in your VendorSpot wallet.`,
            data: { orderNumber, amount },
            link: '/wallet',
        });
    }
    // ================================================================
    // DELIVERY NOTIFICATIONS
    // ================================================================
    async deliveryStatusUpdate(orderId, orderNumber, status, customerId) {
        const statusConfig = {
            picked_up: { title: 'Parcel Picked Up 📦', message: `Order #${orderNumber} picked up! Your courier has it and is heading out.` },
            in_transit: { title: 'On the Move 🚚', message: `Order #${orderNumber} is in transit — your courier is on the move!` },
            delivered: { title: 'Delivered! 🎉', message: `Order #${orderNumber} delivered! Tap to confirm receipt and release payment to your vendor.` },
            failed: { title: 'Delivery Attempt Failed ⚠️', message: `Delivery attempt for order #${orderNumber} failed. The courier will retry — please verify your address.` },
        };
        const { title, message } = statusConfig[status] ?? {
            title: 'Delivery Update',
            message: `Delivery status for order #${orderNumber} updated to: ${status}.`,
        };
        await this.send({
            userId: customerId,
            type: types_1.NotificationType.DELIVERY,
            title,
            message,
            data: { orderId, orderNumber, status },
            link: `/orders/${orderId}`,
        });
    }
    // ================================================================
    // REVIEW NOTIFICATIONS
    // ================================================================
    async newReviewOnProduct(vendorId, productName, rating, reviewerName) {
        await this.send({
            userId: vendorId,
            type: types_1.NotificationType.REVIEW,
            title: 'New Review',
            message: `${reviewerName} left a ${rating}-star review on "${productName}".`,
            data: { productName, rating },
            link: '/vendor/reviews',
        });
    }
    async reviewReminder(userId, orderId, orderNumber, productName) {
        await this.send({
            userId,
            type: types_1.NotificationType.REVIEW,
            title: 'Review Your Purchase',
            message: `How was "${productName}" from order #${orderNumber}? Share your experience!`,
            data: { orderId, orderNumber, productName },
            link: `/orders/${orderId}/review`,
        });
    }
    // ================================================================
    // PROMOTION NOTIFICATIONS
    // ================================================================
    async newProductFromFollowedVendor(followerIds, vendorName, productName, productId) {
        if (followerIds.length === 0)
            return;
        await this.sendToMany({
            userIds: followerIds,
            type: types_1.NotificationType.PROMOTION,
            title: 'New Arrival',
            message: `${vendorName} just listed "${productName}". Check it out!`,
            data: { productId, vendorName },
            link: `/products/${productId}`,
        });
    }
    async priceDrop(userIds, productName, oldPrice, newPrice, productId) {
        if (userIds.length === 0)
            return;
        await this.sendToMany({
            userIds,
            type: types_1.NotificationType.PROMOTION,
            title: 'Price Drop',
            message: `"${productName}" dropped from ₦${oldPrice.toLocaleString()} to ₦${newPrice.toLocaleString()}!`,
            data: { productId, oldPrice, newPrice },
            link: `/products/${productId}`,
        });
    }
    async dealOrOffer(userIds, title, message, data) {
        if (userIds.length === 0)
            return;
        await this.sendToMany({
            userIds,
            type: types_1.NotificationType.PROMOTION,
            title,
            message,
            data,
        });
    }
    // ================================================================
    // REWARD / POINTS NOTIFICATIONS
    // ================================================================
    async pointsEarned(userId, points, reason) {
        await this.send({
            userId,
            type: types_1.NotificationType.SYSTEM,
            title: 'Points Earned',
            message: `You earned ${points} points for ${reason}!`,
            data: { points, reason },
            link: '/rewards',
        });
    }
    async badgeEarned(userId, badge) {
        const badgeNames = {
            'first-purchase': 'First Purchase',
            'loyal-customer': 'Loyal Customer',
            'vip-customer': 'VIP Customer',
            'high-spender': 'High Spender',
        };
        await this.send({
            userId,
            type: types_1.NotificationType.SYSTEM,
            title: 'New Badge Unlocked',
            message: `Congratulations! You earned the "${badgeNames[badge] || badge}" badge!`,
            data: { badge },
            link: '/rewards',
        });
    }
    async pointsRedeemed(userId, points, cashValue) {
        await this.send({
            userId,
            type: types_1.NotificationType.SYSTEM,
            title: 'VCredits Earned!',
            message: `You converted ${points} points to ${cashValue.toLocaleString()} VCredits. Use them to pay for orders!`,
            data: { points, vCredits: cashValue },
            link: '/wallet',
        });
    }
    // ================================================================
    // ACCOUNT NOTIFICATIONS
    // ================================================================
    async welcomeNotification(userId, firstName) {
        await this.send({
            userId,
            type: types_1.NotificationType.ACCOUNT,
            title: 'Welcome to VendorSpot!',
            message: `Hi ${firstName}! Your account is now active. Start shopping or set up your vendor profile.`,
            data: {},
            link: '/',
        });
    }
    async vendorVerified(userId) {
        await this.send({
            userId,
            type: types_1.NotificationType.ACCOUNT,
            title: 'Vendor Account Verified',
            message: 'Your vendor account has been verified! You can now start listing products.',
            data: {},
            link: '/vendor/products',
        });
    }
    async vendorRejected(userId, reason) {
        await this.send({
            userId,
            type: types_1.NotificationType.ACCOUNT,
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
    async disputeCreated(orderId, orderNumber, vendorId, buyerId, disputeId) {
        await this.send({
            userId: vendorId,
            type: types_1.NotificationType.ORDER,
            title: '⚠️ Dispute Opened',
            message: `A dispute was opened on order #${orderNumber}. Please respond within 48 hours.`,
            data: { orderId, orderNumber, disputeId },
            link: `/vendor/disputes`,
        });
        await this.send({
            userId: buyerId,
            type: types_1.NotificationType.ORDER,
            title: 'Dispute Under Review',
            message: `Your dispute for order #${orderNumber} is under review. We'll update you shortly.`,
            data: { orderId, orderNumber, disputeId },
            link: `/disputes`,
        });
    }
    async disputeResolved(orderId, orderNumber, vendorId, buyerId, resolution, disputeId) {
        await this.send({
            userId: vendorId,
            type: types_1.NotificationType.ORDER,
            title: '✅ Dispute Resolved',
            message: `Dispute for order #${orderNumber} resolved: ${resolution}. Tap to see details.`,
            data: { orderId, orderNumber, resolution, disputeId },
            link: `/vendor/disputes`,
        });
        await this.send({
            userId: buyerId,
            type: types_1.NotificationType.ORDER,
            title: '✅ Dispute Resolved',
            message: `Dispute for order #${orderNumber} resolved: ${resolution}. Tap to see details.`,
            data: { orderId, orderNumber, resolution, disputeId },
            link: `/disputes`,
        });
    }
    // ================================================================
    // REFERRAL NOTIFICATIONS
    // ================================================================
    async referralSignup(referrerId, refereeName) {
        await this.send({
            userId: referrerId,
            type: types_1.NotificationType.SYSTEM,
            title: 'Referral Success',
            message: `${refereeName} just signed up using your referral code! You'll earn rewards when they make their first purchase.`,
            data: { refereeName },
            link: '/rewards',
        });
    }
    async referralPurchase(referrerId, commission) {
        await this.send({
            userId: referrerId,
            type: types_1.NotificationType.SYSTEM,
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
    async newChallengeCreated(challengeId, title, description, type) {
        // Map challenge type to user role / filter
        let filter = {};
        if (type === 'buyer') {
            filter.role = 'customer';
        }
        else if (type === 'seller') {
            filter.role = 'vendor';
        }
        else if (type === 'affiliate') {
            filter.isAffiliate = true;
        }
        const users = await User_1.default.find(filter).select('_id');
        const userIds = users.map((u) => u._id.toString());
        if (userIds.length === 0)
            return;
        await this.sendToMany({
            userIds,
            type: types_1.NotificationType.CHALLENGE,
            title: 'New Challenge Available!',
            message: `"${title}" - ${description}`,
            data: { challengeId },
            link: '/challenges',
        });
    }
    /**
     * Notify a user when they complete a challenge
     */
    async challengeCompleted(userId, challengeId, challengeTitle) {
        await this.send({
            userId,
            type: types_1.NotificationType.CHALLENGE,
            title: 'Challenge Completed!',
            message: `Congratulations! You completed "${challengeTitle}". Claim your reward now!`,
            data: { challengeId },
            link: '/challenges',
        });
    }
    /**
     * Notify a user when they claim a challenge reward
     */
    async challengeRewardClaimed(userId, challengeId, challengeTitle, rewardType, rewardValue) {
        const rewardText = rewardType === 'cash'
            ? `₦${rewardValue.toLocaleString()} has been added to your wallet`
            : `${rewardValue} points have been added to your account`;
        await this.send({
            userId,
            type: types_1.NotificationType.CHALLENGE,
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
    async productStockAlert(userIds, productId, productName, newQuantity) {
        if (userIds.length === 0)
            return;
        const isOutOfStock = newQuantity === 0;
        await this.sendToMany({
            userIds,
            type: types_1.NotificationType.PROMOTION,
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
                }
                catch {
                    // Non-critical
                }
            }
        }
    }
    // ================================================================
    // VENDOR SALES NOTIFICATION
    // ================================================================
    async vendorSaleCompleted(vendorId, orderNumber, amount, earnings) {
        await this.send({
            userId: vendorId,
            type: types_1.NotificationType.PAYMENT,
            title: '💰 Payment Released',
            message: `Order #${orderNumber} confirmed received! ₦${earnings.toLocaleString()} has been credited to your wallet.`,
            data: { orderNumber, amount, earnings },
            link: '/vendor/wallet',
        });
    }
}
exports.notificationService = new NotificationService();
/**
 * Emit a real-time new_order event to all vendors when an order is placed.
 * Called from order.controller after order creation.
 */
const emitNewOrder = (payload) => {
    if (!ioInstance)
        return;
    const data = { orderId: payload.orderId, orderNumber: payload.orderNumber };
    payload.vendorIds.forEach((vendorId) => {
        ioInstance.to(`user_${vendorId}`).emit('new_order', data);
    });
    logger_1.logger.info(`[Socket] new_order emitted → order ${payload.orderNumber} → ${payload.vendorIds.length} vendors`);
};
exports.emitNewOrder = emitNewOrder;
/**
 * Emit a real-time order status update to the customer and all vendors on that order.
 * Called from webhook.controller after ShipBubble updates an order.
 */
const emitOrderStatusUpdate = (payload) => {
    if (!ioInstance)
        return;
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
            ioInstance.to(`user_${vendorId}`).emit(event, data);
        });
    }
    logger_1.logger.info(`[Socket] order_status_update emitted → order ${payload.orderNumber} → ${payload.status}`);
};
exports.emitOrderStatusUpdate = emitOrderStatusUpdate;
//# sourceMappingURL=notification.service.js.map