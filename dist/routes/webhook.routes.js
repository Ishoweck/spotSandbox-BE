"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// routes/webhook.routes.ts
const express_1 = require("express");
const webhook_controller_1 = require("../controllers/webhook.controller");
const admin_webhook_controller_1 = require("../controllers/admin-webhook.controller");
const auth_1 = require("../middleware/auth");
const ayncHandler_1 = require("../utils/ayncHandler");
const types_1 = require("../types");
const router = (0, express_1.Router)();
// ============================================
// PUBLIC WEBHOOK ENDPOINTS (No Auth Required)
// ============================================
// Paystack payment events (charge.success → create order or credit wallet)
router.post('/paystack', (0, ayncHandler_1.asyncHandler)(webhook_controller_1.handlePaystackWebhook));
// ShipBubble delivery status updates
router.post('/shipbubble', (0, ayncHandler_1.asyncHandler)(webhook_controller_1.webhookController.handleShipBubbleWebhook.bind(webhook_controller_1.webhookController)));
// Resend email delivery status updates (delivered, bounced, complained)
router.post('/resend', (0, ayncHandler_1.asyncHandler)(webhook_controller_1.handleResendWebhook));
// ============================================
// CUSTOMER & VENDOR - Check Real-Time Status
// ============================================
// Refresh order status from ShipBubble (for sandbox testing)
router.post('/refresh-status/:orderId', auth_1.authenticate, (0, ayncHandler_1.asyncHandler)(webhook_controller_1.webhookController.refreshOrderStatus.bind(webhook_controller_1.webhookController)));
// Get webhook history for an order
router.get('/history/:orderId', auth_1.authenticate, (0, ayncHandler_1.asyncHandler)(webhook_controller_1.webhookController.getWebhookHistory.bind(webhook_controller_1.webhookController)));
// ============================================
// VENDOR - Simulate status for their orders
// ============================================
router.post('/vendor/simulate', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.VENDOR), (0, ayncHandler_1.asyncHandler)(admin_webhook_controller_1.adminWebhookController.simulateVendorOwnWebhook.bind(admin_webhook_controller_1.adminWebhookController)));
// ============================================
// ADMIN WEBHOOK TESTING (Auth Required)
// ============================================
router.post('/admin/simulate', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.ADMIN), (0, ayncHandler_1.asyncHandler)(admin_webhook_controller_1.adminWebhookController.simulateWebhook.bind(admin_webhook_controller_1.adminWebhookController)));
router.post('/admin/simulate-vendor', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.ADMIN), (0, ayncHandler_1.asyncHandler)(admin_webhook_controller_1.adminWebhookController.simulateVendorWebhook.bind(admin_webhook_controller_1.adminWebhookController)));
router.get('/admin/order/:orderNumber/shipments', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.ADMIN), (0, ayncHandler_1.asyncHandler)(admin_webhook_controller_1.adminWebhookController.getOrderShipmentDetails.bind(admin_webhook_controller_1.adminWebhookController)));
router.post('/admin/test-endpoint', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.ADMIN), (0, ayncHandler_1.asyncHandler)(admin_webhook_controller_1.adminWebhookController.testWebhookEndpoint.bind(admin_webhook_controller_1.adminWebhookController)));
exports.default = router;
//# sourceMappingURL=webhook.routes.js.map