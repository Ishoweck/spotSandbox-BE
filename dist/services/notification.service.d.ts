import { NotificationType } from '../types';
import { Server as SocketServer } from 'socket.io';
export declare const setSocketInstance: (io: SocketServer) => void;
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
}
declare class NotificationService {
    /**
     * Send notification to a single user (in-app + push)
     */
    send(options: NotifyOptions): Promise<void>;
    /**
     * Send notification to multiple users
     */
    sendToMany(options: NotifyManyOptions): Promise<void>;
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
    badgeEarned(userId: string, badge: string): Promise<void>;
    pointsRedeemed(userId: string, points: number, cashValue: number): Promise<void>;
    welcomeNotification(userId: string, firstName: string): Promise<void>;
    vendorVerified(userId: string): Promise<void>;
    vendorRejected(userId: string, reason?: string): Promise<void>;
    disputeCreated(orderId: string, orderNumber: string, vendorId: string, buyerId: string, disputeId?: string): Promise<void>;
    disputeResolved(orderId: string, orderNumber: string, vendorId: string, buyerId: string, resolution: string, disputeId?: string): Promise<void>;
    referralSignup(referrerId: string, refereeName: string): Promise<void>;
    referralPurchase(referrerId: string, commission: number): Promise<void>;
    /**
     * Notify relevant users when a new challenge is created
     */
    newChallengeCreated(challengeId: string, title: string, description: string, type: 'buyer' | 'seller' | 'affiliate'): Promise<void>;
    /**
     * Notify a user when they complete a challenge
     */
    challengeCompleted(userId: string, challengeId: string, challengeTitle: string): Promise<void>;
    /**
     * Notify a user when they claim a challenge reward
     */
    challengeRewardClaimed(userId: string, challengeId: string, challengeTitle: string, rewardType: string, rewardValue: number): Promise<void>;
    /**
     * Notify buyers who have a product in their cart when stock hits 0 or drops to ≤5.
     * Also emits a dedicated `product_stock_update` socket event so the cart UI
     * can react in real time without waiting for a screen refresh.
     */
    productStockAlert(userIds: string[], productId: string, productName: string, newQuantity: number): Promise<void>;
    vendorSaleCompleted(vendorId: string, orderNumber: string, amount: number, earnings: number): Promise<void>;
}
export declare const notificationService: NotificationService;
/**
 * Emit a real-time new_order event to all vendors when an order is placed.
 * Called from order.controller after order creation.
 */
export declare const emitNewOrder: (payload: {
    orderId: string;
    orderNumber: string;
    vendorIds: string[];
}) => void;
/**
 * Emit a real-time order status update to the customer and all vendors on that order.
 * Called from webhook.controller after ShipBubble updates an order.
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