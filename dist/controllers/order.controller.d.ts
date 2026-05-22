import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class OrderController {
    /**
     * Check if cart contains digital products
     */
    private hasDigitalProducts;
    /**
     * Check if cart contains ONLY digital products
     */
    private isDigitalOnly;
    /**
     * Validate payment method for cart contents
     */
    private validatePaymentMethod;
    /**
     * ✅ NEW: Determine the best ShipBubble category based on product names
     * Uses keyword matching to pick the right category so ShipBubble
     * returns the most relevant couriers for the product type.
     */
    private determineCategoryForItems;
    /**
     * Get delivery rates
     */
    getDeliveryRates(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    private getVendorDeliveryRates;
    private groupItemsByVendor;
    private checkPickupAvailability;
    private aggregateVendorRates;
    private compareEstimatedDays;
    /**
     * Create order from cart - WALLET PAYMENTS ONLY
     * For Paystack/Flutterwave, use initializePayment → confirmPayment flow instead
     */
    createOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * ✅ NEW: Initialize payment WITHOUT creating an order
     * Step 1 of the payment-first flow:
     * - Validates cart & stock
     * - Calculates totals (subtotal + shipping)
     * - Initializes Paystack/Flutterwave
     * - Returns payment URL + a checkout token (encrypted cart snapshot)
     * - NO order is created, NO cart is cleared
     */
    initializePayment(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * ✅ NEW: Confirm payment & create order ATOMICALLY
     * Step 2 of the payment-first flow:
     * - Verifies payment with Paystack/Flutterwave
     * - Re-validates cart & stock (could have changed while user was paying)
     * - Creates the order
     * - Clears the cart
     * - Awards points, updates sales, sends email
     */
    confirmPayment(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Create vendor shipments with ShipBubble
     */
    private createVendorShipments;
    /**
     * Verify payment - Supports Paystack and Flutterwave
     */
    verifyPayment(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Check if the current user has an active order involving a counterparty.
     * Customers check by vendor (items.vendor), vendors check by buyer (user).
     */
    checkActiveOrderWith(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Return all user IDs the current user has active orders with — bulk version of checkActiveOrderWith
     * GET /orders/active-partners
     */
    getActivePartners(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Return count of active orders for the current user (tab badge)
     * GET /orders/active-count
     */
    getActiveOrderCount(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get active orders with a counterparty (for chat order context card)
     * GET /orders/active-with/:counterpartyId
     */
    getActiveOrdersWith(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get user orders
     */
    getUserOrders(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get single order
     */
    getOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get single order for vendor
     */
    getVendorOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get user's digital products
     */
    getUserDigitalProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Download digital product
     */
    downloadDigitalProduct(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Track order shipment
     */
    trackOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Cancel order
     */
    cancelOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Cancel a single vendor's shipment within a multi-vendor order
     */
    cancelVendorShipment(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get vendor orders
     */
    getVendorOrders(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Update order status (vendor)
     */
    updateOrderStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Complete order (customer confirms delivery)
     * Only the order's customer can complete it, and only if status is in_transit or delivered
     */
    completeOrder(req: AuthRequest, res: Response): Promise<void>;
    /**
     * Complete a single vendor's shipment (customer confirms receipt for one vendor)
     * When all vendor shipments are received, the whole order becomes delivered.
     */
    completeVendorShipment(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Helper methods
     */
    private getDefaultRate;
    private getDefaultEstimate;
    private getDefaultDescription;
    private getVendorFallbackRates;
    private getFallbackRates;
}
export declare const orderController: OrderController;
//# sourceMappingURL=order.controller.d.ts.map