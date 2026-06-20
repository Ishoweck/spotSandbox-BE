import { Request, Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class WebhookController {
    /**
     * Handle ShipBubble webhook for order status updates
     */
    handleShipBubbleWebhook(req: Request, res: Response<ApiResponse>): Promise<void>;
    /**
     * Map ShipBubble status to our OrderStatus.
     *
     * Option-C domain separation: 'pending' and 'confirmed' are vendor-owned statuses.
     * ShipBubble is never allowed to write them, so they are intentionally absent from
     * this map. ShipBubble only owns statuses from 'picked_up' / courier hand-off onwards.
     */
    private mapShipBubbleStatus;
    private static readonly ORDER_STATUS_RANK;
    private static readonly SHIPMENT_STATUS_RANK;
    /** Returns true only if `next` is strictly higher rank than `current`, or is a cancellation. */
    private canAdvanceOrder;
    private canAdvanceShipment;
    private deriveMultiVendorOrderStatus;
    /**
     * Refresh order status (for customers/vendors in sandbox testing)
     * This manually triggers a webhook simulation for the user's own order
     */
    refreshOrderStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get webhook history for an order
     */
    getWebhookHistory(req: Request, res: Response<ApiResponse>): Promise<void>;
    /**
     * Admin: manually sync an order's shipment status from ShipBubble.
     * Use this when a webhook was missed (e.g. DB outage, URL change).
     */
    syncOrderShipment(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
}
export declare const webhookController: WebhookController;
export declare function handlePaystackWebhook(req: Request, res: Response): Promise<void>;
export declare function handleFlutterwaveWebhook(req: Request, res: Response): Promise<void>;
export declare function handleResendWebhook(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=webhook.controller.d.ts.map