// routes/webhook.routes.ts
import { Router } from 'express';
import { webhookController, handleResendWebhook, handlePaystackWebhook } from '../controllers/webhook.controller';
import { adminWebhookController } from '../controllers/admin-webhook.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/ayncHandler';
import { UserRole } from '../types';

const router = Router();

// ============================================
// PUBLIC WEBHOOK ENDPOINTS (No Auth Required)
// ============================================

// Paystack payment events (charge.success → create order or credit wallet)
router.post('/paystack', asyncHandler(handlePaystackWebhook));

// ShipBubble delivery status updates
router.post(
  '/shipbubble',
  asyncHandler(webhookController.handleShipBubbleWebhook.bind(webhookController))
);

// Resend email delivery status updates (delivered, bounced, complained)
router.post(
  '/resend',
  asyncHandler(handleResendWebhook)
);

// ============================================
// CUSTOMER & VENDOR - Check Real-Time Status
// ============================================
// Refresh order status from ShipBubble (for sandbox testing)
router.post(
  '/refresh-status/:orderId',
  authenticate,
  asyncHandler(webhookController.refreshOrderStatus.bind(webhookController))
);

// Get webhook history for an order
router.get(
  '/history/:orderId',
  authenticate,
  asyncHandler(webhookController.getWebhookHistory.bind(webhookController))
);

// ============================================
// VENDOR - Simulate status for their orders
// ============================================
router.post(
  '/vendor/simulate',
  authenticate,
  authorize(UserRole.VENDOR),
  asyncHandler(adminWebhookController.simulateVendorOwnWebhook.bind(adminWebhookController))
);

// ============================================
// ADMIN WEBHOOK TESTING (Auth Required)
// ============================================
router.post(
  '/admin/simulate',
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(adminWebhookController.simulateWebhook.bind(adminWebhookController))
);

router.post(
  '/admin/simulate-vendor',
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(adminWebhookController.simulateVendorWebhook.bind(adminWebhookController))
);

router.get(
  '/admin/order/:orderNumber/shipments',
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(adminWebhookController.getOrderShipmentDetails.bind(adminWebhookController))
);

router.post(
  '/admin/test-endpoint',
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(adminWebhookController.testWebhookEndpoint.bind(adminWebhookController))
);

export default router;