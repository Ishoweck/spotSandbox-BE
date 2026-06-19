import { NotificationType } from '../types';
import { Server as SocketServer } from 'socket.io';
export declare const setSocketInstance: (io: SocketServer) => void;
export declare const setQueueReady: (ready: boolean) => void;
interface NotifyOptions {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, any>;
    link?: string;
    referenceId?: string;
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
declare class NotificationService {
    /**
     * Send notification to a single user.
     * In-app record + socket emit are synchronous (instant UX).
     * FCM push is queued via BullMQ (reliable, with retries).
     */
    send(options: NotifyOptions): Promise<void>;
    /**
     * Send notification to multiple users.
     * In-app records inserted in bulk (synchronous).
     * Push is queued per user (async).
     */
    sendToMany(options: NotifyManyOptions): Promise<void>;
    /**
     * Fan-out broadcast to a large filtered user set.
     * Paginates users in 10k chunks and queues each chunk separately.
     * Prevents loading millions of IDs into memory at once.
     */
    private _broadcastToFilter;
    /** Direct FCM push — used only as a fallback when BullMQ is unavailable */
    private _directPush;
    orderPlaced(orderId: string, orderNumber: string, total: number, customerId: string, vendorIds: string[]): Promise<void>;
    orderStatusUpdated(orderId: string, orderNumber: string, status: string, customerId: string): Promise<void>;
    orderCancelled(orderId: string, orderNumber: string, customerId: string, vendorIds: string[], cancelledBy: 'customer' | 'vendor'): Promise<void>;
    paymentCompleted(orderId: string, orderNumber: string, amount: number, userId: string): Promise<void>;
    insufficientWalletBalance(userId: string, required: number, current: number): Promise<void>;
    walletTopUp(userId: string, amount: number, newBalance: number): Promise<void>;
    walletWithdrawalRequested(userId: string, amount: number): Promise<void>;
    walletWithdrawalProcessed(userId: string, amount: number, status: 'completed' | 'failed'): Promise<void>;
    walletTransfer(senderId: string, recipientId: string, amount: number, senderName: string, recipientName: string): Promise<void>;
    refundIssued(userId: string, orderNumber: string, amount: number): Promise<void>;
    deliveryStatusUpdate(orderId: string, orderNumber: string, status: string, customerId: string): Promise<void>;
    newReviewOnProduct(vendorId: string, productName: string, rating: number, reviewerName: string): Promise<void>;
    reviewReminder(userId: string, orderId: string, orderNumber: string, productName: string): Promise<void>;
    newProductFromFollowedVendor(followerIds: string[], vendorName: string, productName: string, productId: string): Promise<void>;
    priceDrop(userIds: string[], productName: string, oldPrice: number, newPrice: number, productId: string): Promise<void>;
    dealOrOffer(userIds: string[], title: string, message: string, data?: Record<string, any>): Promise<void>;
    pointsEarned(userId: string, points: number, reason: string): Promise<void>;
    vCreditsExpiringSoon(userId: string, amount: number, daysLeft: number): Promise<void>;
    pointsExpiringSoon(userId: string, totalPoints: number, daysLeft: number): Promise<void>;
    badgeEarned(userId: string, badge: string): Promise<void>;
    pointsRedeemed(userId: string, points: number, cashValue: number): Promise<void>;
    welcomeNotification(userId: string, firstName: string): Promise<void>;
    vendorVerified(userId: string): Promise<void>;
    vendorRejected(userId: string, reason?: string): Promise<void>;
    disputeCreated(orderId: string, orderNumber: string, vendorId: string, buyerId: string, disputeId?: string): Promise<void>;
    disputeResolved(orderId: string, orderNumber: string, vendorId: string, buyerId: string, resolution: string, disputeId?: string): Promise<void>;
    referralSignup(referrerId: string, refereeName: string): Promise<void>;
    referralPurchase(referrerId: string, commission: number): Promise<void>;
    newChallengeCreated(challengeId: string, title: string, description: string, type: 'buyer' | 'seller' | 'affiliate'): Promise<void>;
    challengeCompleted(userId: string, challengeId: string, challengeTitle: string): Promise<void>;
    challengeRewardClaimed(userId: string, challengeId: string, challengeTitle: string, rewardType: string, rewardValue: number): Promise<void>;
    productStockAlert(userIds: string[], productId: string, productName: string, newQuantity: number): Promise<void>;
    vendorSaleCompleted(vendorId: string, orderNumber: string, amount: number, earnings: number): Promise<void>;
}
export declare const notificationService: NotificationService;
/**
 * Emit a real-time new_order event to all vendors when an order is placed.
 */
export declare const emitNewOrder: (payload: {
    orderId: string;
    orderNumber: string;
    vendorIds: string[];
}) => void;
/**
 * Emit a real-time order status update to the customer and all vendors on that order.
 */
export declare const emitOrderStatusUpdate: (payload: {
    orderId: string;
    orderNumber: string;
    status: string;
    customerId: string;
    vendorIds?: string[];
}) => void;
export {};
//# sourceMappingURL=notification.service.d.ts.map