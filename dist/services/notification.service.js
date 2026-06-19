"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitOrderStatusUpdate = exports.emitNewOrder = exports.notificationService = exports.setQueueReady = exports.setSocketInstance = void 0;
const types_1 = require("../types");
const Additional_1 = require("../models/Additional");
const User_1 = __importDefault(require("../models/User"));
const firebase_1 = require("../config/firebase");
const logger_1 = require("../utils/logger");
const notification_queue_1 = require("../queues/notification.queue");
const crypto_1 = __importDefault(require("crypto"));
// Socket.io instance — set from server.ts after initialization
let ioInstance = null;
const setSocketInstance = (io) => {
    ioInstance = io;
};
exports.setSocketInstance = setSocketInstance;
// Whether BullMQ queues are available (set after Redis connects)
let queueReady = false;
const setQueueReady = (ready) => { queueReady = ready; };
exports.setQueueReady = setQueueReady;
function makeReferenceId(userId, type, extra) {
    const raw = `${userId}:${type}:${extra ?? Date.now()}`;
    return crypto_1.default.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
class NotificationService {
    /**
     * Send notification to a single user.
     * In-app record + socket emit are synchronous (instant UX).
     * FCM push is queued via BullMQ (reliable, with retries).
     */
    async send(options) {
        const { userId, type, title, message, data, link, referenceId } = options;
        try {
            // 1. Create in-app notification (synchronous — instant)
            const notification = await Additional_1.Notification.create({
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
            // 3. Queue push notification (async — reliable delivery with retries)
            const refId = referenceId ?? makeReferenceId(userId, type, data?.orderId ?? data?.eventId);
            if (queueReady) {
                await notification_queue_1.pushQueue.add(`push:${type}`, {
                    notificationId: notification._id.toString(),
                    userId,
                    type,
                    title,
                    message,
                    data,
                    link,
                    referenceId: refId,
                });
            }
            else {
                // Fallback: direct FCM send if Redis/BullMQ is unavailable
                await this._directPush(userId, type, title, message, data, link);
                await Additional_1.Notification.findByIdAndUpdate(notification._id, { pushStatus: 'sent' });
            }
            logger_1.logger.info(`Notification queued for ${userId}: [${type}] ${title}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to send notification to ${userId}:`, error.message);
        }
    }
    /**
     * Send notification to multiple users.
     * In-app records inserted in bulk (synchronous).
     * Push is queued per user (async).
     */
    async sendToMany(options) {
        const { userIds, type, title, message, data, link, skipPush, referenceId } = options;
        const uniqueIds = [...new Set(userIds)];
        if (uniqueIds.length === 0)
            return;
        // Batch create in-app notifications
        const docs = uniqueIds.map((userId) => ({
            user: userId,
            type,
            title,
            message,
            data,
            link,
            pushStatus: 'pending',
        }));
        try {
            await Additional_1.Notification.insertMany(docs);
        }
        catch (error) {
            logger_1.logger.error('Bulk notification insert error:', error.message);
        }
        // Emit socket events — omit per-user unreadCount to avoid N queries
        if (ioInstance) {
            for (const userId of uniqueIds) {
                try {
                    ioInstance.to(`user_${userId}`).emit('new_notification', {
                        notification: { type, title, message, data, link, read: false, createdAt: new Date() },
                    });
                }
                catch {
                    // Non-critical
                }
            }
        }
        if (skipPush)
            return;
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
            await notification_queue_1.pushQueue.addBulk(jobs);
        }
        else {
            // Fallback: direct FCM batch
            try {
                const users = await User_1.default.find({
                    _id: { $in: uniqueIds },
                    fcmTokens: { $exists: true, $not: { $size: 0 } },
                }).select('fcmTokens').lean();
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
                logger_1.logger.error('Bulk push fallback error:', error.message);
            }
        }
        logger_1.logger.info(`Notification sent to ${uniqueIds.length} users: [${type}] ${title}`);
    }
    /**
     * Fan-out broadcast to a large filtered user set.
     * Paginates users in 10k chunks and queues each chunk separately.
     * Prevents loading millions of IDs into memory at once.
     */
    async _broadcastToFilter(filter, type, title, message, data, link) {
        const CHUNK_SIZE = 10000;
        let skip = 0;
        let totalQueued = 0;
        const referenceId = makeReferenceId('broadcast', type, JSON.stringify(filter));
        while (true) {
            const users = await User_1.default.find(filter)
                .select('_id')
                .skip(skip)
                .limit(CHUNK_SIZE)
                .lean();
            if (users.length === 0)
                break;
            const userIds = users.map((u) => u._id.toString());
            // Queue each chunk as an independent broadcast job
            if (queueReady) {
                await notification_queue_1.broadcastQueue.add(`broadcast:${type}:chunk:${skip}`, {
                    userIds,
                    type,
                    title,
                    message,
                    data,
                    link,
                    referenceId: `${referenceId}:${skip}`,
                });
            }
            else {
                // Fallback: send directly for this chunk
                await this.sendToMany({ userIds, type, title, message, data, link });
            }
            totalQueued += users.length;
            skip += CHUNK_SIZE;
            if (users.length < CHUNK_SIZE)
                break;
        }
        logger_1.logger.info(`[Broadcast] Queued ${totalQueued} users for [${type}] in chunks of ${CHUNK_SIZE}`);
    }
    /** Direct FCM push — used only as a fallback when BullMQ is unavailable */
    async _directPush(userId, type, title, message, data, link) {
        try {
            const user = await User_1.default.findById(userId).select('fcmTokens').lean();
            const tokens = user?.fcmTokens ?? [];
            if (tokens.length === 0)
                return;
            const pushData = {
                type,
                ...(link ? { link } : {}),
                ...(data ? { payload: JSON.stringify(data) } : {}),
            };
            await (0, firebase_1.sendPushNotification)(tokens, title, message, pushData);
        }
        catch (err) {
            logger_1.logger.error(`[DirectPush] Failed for ${userId}:`, err.message);
        }
    }
    // ================================================================
    // ORDER NOTIFICATIONS
    // ================================================================
    async orderPlaced(orderId, orderNumber, total, customerId, vendorIds) {
        await this.send({
            userId: customerId,
            type: types_1.NotificationType.ORDER,
            title: 'Order Placed! 🎉',
            message: `Order #${orderNumber} is in! We've notified your vendor and you'll get updates as it moves.`,
            data: { orderId, orderNumber },
            link: `/orders/${orderId}`,
            referenceId: `order_placed:${orderId}`,
        });
        await this.sendToMany({
            userIds: vendorIds,
            type: types_1.NotificationType.ORDER,
            title: '🛍️ New Order Received',
            message: `New order #${orderNumber} just came in! Tap to review and confirm.`,
            data: { orderId, orderNumber },
            link: `/vendor/orders/${orderId}`,
            referenceId: `order_placed_vendor:${orderId}`,
        });
    }
    async orderStatusUpdated(orderId, orderNumber, status, customerId) {
        const statusConfig = {
            pending: { title: 'Order Received 🛍️', message: `Order #${orderNumber} has been placed and is waiting for vendor confirmation.` },
            confirmed: { title: 'Order Confirmed ✅', message: `Your vendor confirmed order #${orderNumber} and is getting it ready for you.` },
            processing: { title: 'Order Being Packed 📦', message: `Order #${orderNumber} is being packed and prepped for dispatch.` },
            shipped: { title: 'Order Shipped 🚚', message: `Order #${orderNumber} is on its way! Your courier has it — tap to track.` },
            in_transit: { title: 'Out for Delivery 🚚', message: `Your order #${orderNumber} is moving — expected delivery coming soon.` },
            delivered: { title: 'Order Delivered! 🎉', message: `Order #${orderNumber} delivered! Hope you love it. Tap to confirm receipt.` },
            cancelled: { title: 'Order Cancelled', message: `Order #${orderNumber} was cancelled. If you paid, a refund is on its way to your wallet.` },
            refunded: { title: 'Refund Processed 💸', message: `Your refund for order #${orderNumber} has been processed and added to your wallet.` },
            shipment_received: { title: 'Delivery Confirmed 📬', message: `Your customer confirmed delivery of order #${orderNumber}. Payment will be released to your wallet.` },
            failed: { title: 'Order Failed', message: `Something went wrong with order #${orderNumber}. Please contact support if you need help.` },
            disputed: { title: 'Order Disputed ⚠️', message: `A dispute has been opened on order #${orderNumber}. Our team will review and reach out.` },
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
            referenceId: `order_status:${orderId}:${status}`,
        });
    }
    async orderCancelled(orderId, orderNumber, customerId, vendorIds, cancelledBy) {
        if (cancelledBy === 'customer') {
            await this.sendToMany({
                userIds: vendorIds,
                type: types_1.NotificationType.ORDER,
                title: 'Order Cancelled',
                message: `Order #${orderNumber} was cancelled by the customer. Stock has been restored.`,
                data: { orderId, orderNumber },
                link: `/vendor/orders/${orderId}`,
                referenceId: `order_cancelled:${orderId}`,
            });
        }
        else {
            await this.send({
                userId: customerId,
                type: types_1.NotificationType.ORDER,
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
    async paymentCompleted(orderId, orderNumber, amount, userId) {
        await this.send({
            userId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Payment Successful 💳',
            message: `₦${amount.toLocaleString()} received — your order #${orderNumber} is now being processed.`,
            data: { orderId, orderNumber, amount },
            link: `/orders/${orderId}`,
            referenceId: `payment_completed:${orderId}`,
        });
    }
    async insufficientWalletBalance(userId, required, current) {
        await this.send({
            userId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Insufficient Wallet Balance',
            message: `You need ₦${required.toLocaleString()} to complete this order, but your wallet only has ₦${current.toLocaleString()}. Please top up and try again.`,
            data: { required, current },
            link: '/wallet',
            referenceId: makeReferenceId(userId, 'insufficient_balance', `${required}`),
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
            referenceId: makeReferenceId(userId, 'wallet_topup', `${amount}:${Date.now()}`),
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
            referenceId: makeReferenceId(userId, 'withdrawal_requested', `${amount}:${Date.now()}`),
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
            referenceId: makeReferenceId(userId, `withdrawal_${status}`, `${amount}:${Date.now()}`),
        });
    }
    async walletTransfer(senderId, recipientId, amount, senderName, recipientName) {
        const refBase = makeReferenceId(senderId, 'transfer', `${recipientId}:${amount}:${Date.now()}`);
        await this.send({
            userId: senderId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Transfer Sent',
            message: `You sent ₦${amount.toLocaleString()} to ${recipientName}.`,
            data: { amount, recipientName },
            link: '/wallet',
            referenceId: `transfer_sent:${refBase}`,
        });
        await this.send({
            userId: recipientId,
            type: types_1.NotificationType.PAYMENT,
            title: 'Transfer Received',
            message: `You received ₦${amount.toLocaleString()} from ${senderName}.`,
            data: { amount, senderName },
            link: '/wallet',
            referenceId: `transfer_recv:${refBase}`,
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
            referenceId: `refund:${orderNumber}:${userId}`,
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
            referenceId: `delivery:${orderId}:${status}`,
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
            referenceId: makeReferenceId(vendorId, 'review', `${productName}:${Date.now()}`),
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
            referenceId: `review_reminder:${orderId}`,
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
            referenceId: `new_product:${productId}`,
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
            referenceId: `price_drop:${productId}`,
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
            referenceId: makeReferenceId('deal', title, `${Date.now()}`),
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
            referenceId: makeReferenceId(userId, 'points_earned', `${points}:${Date.now()}`),
        });
    }
    async vCreditsExpiringSoon(userId, amount, daysLeft) {
        const dayLabel = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
        await this.send({
            userId,
            type: types_1.NotificationType.SYSTEM,
            title: '⏳ VCredits Expiring Soon',
            message: `₦${amount.toLocaleString()} VCredits expire ${dayLabel}. Use them at checkout or earn more to reset the timer!`,
            data: { type: 'points', amount, daysLeft },
            link: '/rewards',
            referenceId: `vcredits_expiry:${userId}:${daysLeft}`,
        });
    }
    async pointsExpiringSoon(userId, totalPoints, daysLeft) {
        const dayLabel = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
        await this.send({
            userId,
            type: types_1.NotificationType.SYSTEM,
            title: '⏳ Points Expiring Soon',
            message: `You have ${totalPoints.toLocaleString()} points expiring ${dayLabel}. Redeem them for VCredits before they're gone!`,
            data: { type: 'points', totalPoints, daysLeft },
            link: '/rewards',
            referenceId: `points_expiry:${userId}:${daysLeft}`,
        });
    }
    async badgeEarned(userId, badge) {
        const badgeNames = {
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
            type: types_1.NotificationType.SYSTEM,
            title: '🏅 New Badge Unlocked!',
            message: `Congratulations! You earned the "${badgeNames[badge] || badge}" badge!`,
            data: { type: 'badge', badge },
            link: '/rewards',
            referenceId: `badge:${userId}:${badge}`,
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
            referenceId: makeReferenceId(userId, 'points_redeemed', `${points}:${Date.now()}`),
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
            referenceId: `welcome:${userId}`,
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
            referenceId: `vendor_verified:${userId}`,
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
            referenceId: `vendor_rejected:${userId}`,
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
            referenceId: `dispute_created_vendor:${disputeId ?? orderId}`,
        });
        await this.send({
            userId: buyerId,
            type: types_1.NotificationType.ORDER,
            title: 'Dispute Under Review',
            message: `Your dispute for order #${orderNumber} is under review. We'll update you shortly.`,
            data: { orderId, orderNumber, disputeId },
            link: `/disputes`,
            referenceId: `dispute_created_buyer:${disputeId ?? orderId}`,
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
            referenceId: `dispute_resolved_vendor:${disputeId ?? orderId}`,
        });
        await this.send({
            userId: buyerId,
            type: types_1.NotificationType.ORDER,
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
    async referralSignup(referrerId, refereeName) {
        await this.send({
            userId: referrerId,
            type: types_1.NotificationType.SYSTEM,
            title: 'Referral Success',
            message: `${refereeName} just signed up using your referral code! You'll earn rewards when they make their first purchase.`,
            data: { refereeName },
            link: '/rewards',
            referenceId: makeReferenceId(referrerId, 'referral_signup', `${refereeName}:${Date.now()}`),
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
            referenceId: makeReferenceId(referrerId, 'referral_commission', `${commission}:${Date.now()}`),
        });
    }
    // ================================================================
    // CHALLENGE NOTIFICATIONS
    // ================================================================
    async newChallengeCreated(challengeId, title, description, type) {
        let filter = {};
        if (type === 'buyer')
            filter.role = 'customer';
        else if (type === 'seller')
            filter.role = 'vendor';
        else if (type === 'affiliate')
            filter.isAffiliate = true;
        await this._broadcastToFilter(filter, types_1.NotificationType.CHALLENGE, 'New Challenge Available!', `"${title}" - ${description}`, { challengeId }, '/challenges');
    }
    async challengeCompleted(userId, challengeId, challengeTitle) {
        await this.send({
            userId,
            type: types_1.NotificationType.CHALLENGE,
            title: 'Challenge Completed!',
            message: `Congratulations! You completed "${challengeTitle}". Claim your reward now!`,
            data: { challengeId },
            link: '/challenges',
            referenceId: `challenge_completed:${userId}:${challengeId}`,
        });
    }
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
            referenceId: `challenge_reward:${userId}:${challengeId}`,
        });
    }
    // ================================================================
    // STOCK ALERT NOTIFICATIONS
    // ================================================================
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
            referenceId: `stock_alert:${productId}:${newQuantity}`,
        });
        // Real-time stock event for CartScreen UI update
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
            referenceId: `vendor_sale:${orderNumber}:${vendorId}`,
        });
    }
}
exports.notificationService = new NotificationService();
/**
 * Emit a real-time new_order event to all vendors when an order is placed.
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
    ioInstance.to(`user_${payload.customerId}`).emit(event, data);
    if (payload.vendorIds) {
        payload.vendorIds.forEach((vendorId) => {
            ioInstance.to(`user_${vendorId}`).emit(event, data);
        });
    }
    logger_1.logger.info(`[Socket] order_status_update emitted → order ${payload.orderNumber} → ${payload.status}`);
};
exports.emitOrderStatusUpdate = emitOrderStatusUpdate;
//# sourceMappingURL=notification.service.js.map