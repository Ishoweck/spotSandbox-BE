import { Request, Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class WebhookController {
    /**
     * Handle ShipBubble webhook for order status updates
     */
    handleShipBubbleWebhook(req: Request, res: Response<ApiResponse>): Promise<void>;
    /**
     * Map ShipBubble status to our OrderStatus
     */
    private mapShipBubbleStatus;
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
}
export declare const webhookController: WebhookController;
//# sourceMappingURL=webhook.controller.d.ts.map