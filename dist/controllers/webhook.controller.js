"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookController = exports.WebhookController = void 0;
const types_1 = require("../types");
const Order_1 = __importDefault(require("../models/Order"));
const notification_service_1 = require("../services/notification.service");
const logger_1 = require("../utils/logger");
const error_1 = require("../middleware/error");
const shipbubble_service_1 = require("../services/shipbubble.service");
class WebhookController {
    /**
     * Handle ShipBubble webhook for order status updates
     */
    async handleShipBubbleWebhook(req, res) {
        logger_1.logger.info('📨 ============================================');
        logger_1.logger.info('📨 SHIPBUBBLE WEBHOOK RECEIVED');
        logger_1.logger.info('📨 ============================================');
        // Verify webhook authenticity using shared secret
        const webhookSecret = process.env.SHIPBUBBLE_WEBHOOK_SECRET;
        if (webhookSecret) {
            const incoming = req.headers['x-shipbubble-signature'] || req.headers['authorization'];
            const expected = `Bearer ${webhookSecret}`;
            if (!incoming || incoming !== expected) {
                logger_1.logger.warn('🚫 ShipBubble webhook rejected — invalid signature');
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }
        }
        const webhookData = req.body;
        logger_1.logger.info('📦 Webhook payload:', {
            order_id: webhookData.order_id,
            status: webhookData.status,
            courier: webhookData.courier?.name,
            tracking_code: webhookData.courier?.tracking_code,
        });
        try {
            const { order_id, status, courier, package_status, events, tracking_url } = webhookData;
            if (!order_id) {
                logger_1.logger.error('❌ Missing order_id in webhook');
                res.status(400).json({
                    success: false,
                    message: 'Missing order_id',
                });
                return;
            }
            // Find order by tracking number or shipment ID
            const order = await Order_1.default.findOne({
                $or: [
                    { 'vendorShipments.trackingNumber': order_id },
                    { 'vendorShipments.shipmentId': order_id },
                    { trackingNumber: order_id },
                ],
            }).populate('user', 'firstName lastName email');
            if (!order) {
                logger_1.logger.warn(`⚠️ Order not found for tracking number: ${order_id}`);
                // Still return 200 to acknowledge receipt
                res.json({
                    success: true,
                    message: 'Webhook received but order not found',
                });
                return;
            }
            logger_1.logger.info('✅ Order found:', {
                orderNumber: order.orderNumber,
                currentStatus: order.status,
            });
            // Map ShipBubble status to our order status
            const newStatus = this.mapShipBubbleStatus(status);
            logger_1.logger.info('🔄 Status mapping:', {
                shipBubbleStatus: status,
                mappedStatus: newStatus,
            });
            // Map ShipBubble → vendor shipment status
            const shipmentStatusMap = {
                pending: 'pending',
                confirmed: 'created',
                picked_up: 'shipped',
                in_transit: 'in_transit',
                delivered: 'delivered',
                completed: 'delivered',
                cancelled: 'cancelled',
            };
            const mappedShipmentStatus = shipmentStatusMap[status.toLowerCase()] || 'created';
            // Update the matching vendor shipment (if any)
            const vendorShipments = order.vendorShipments;
            const shipment = vendorShipments?.find((s) => s.trackingNumber === order_id || s.shipmentId === order_id);
            if (shipment) {
                if (this.canAdvanceShipment(shipment.status, mappedShipmentStatus)) {
                    shipment.status = mappedShipmentStatus;
                    logger_1.logger.info('✅ Updated vendor shipment status:', { from: shipment.status, to: mappedShipmentStatus });
                }
                else {
                    logger_1.logger.info(`⏭️  Shipment rank guard blocked: ${shipment.status} → ${mappedShipmentStatus} (no regression)`);
                }
                // Always sync courier metadata regardless of status gate
                if (courier?.tracking_code)
                    shipment.trackingCode = courier.tracking_code;
                if (tracking_url)
                    shipment.trackingUrl = tracking_url;
                if (package_status?.length > 0)
                    shipment.packageStatus = package_status;
                if (events?.length > 0)
                    shipment.events = events;
            }
            // Derive overall order status:
            // Multi-vendor → aggregate from ALL shipments; single-vendor → use mapped status directly
            const derivedStatus = (vendorShipments && vendorShipments.length > 1)
                ? this.deriveMultiVendorOrderStatus(vendorShipments)
                : newStatus;
            const oldStatus = order.status;
            let orderStatusChanged = derivedStatus != null && order.status !== derivedStatus;
            if (orderStatusChanged) {
                if (this.canAdvanceOrder(order.status, derivedStatus)) {
                    order.status = derivedStatus;
                    if (derivedStatus === 'delivered' && !order.deliveredAt) {
                        order.deliveredAt = new Date();
                    }
                }
                else {
                    logger_1.logger.info(`⏭️  Order rank guard blocked: ${order.status} → ${derivedStatus} (no regression)`);
                    orderStatusChanged = false;
                }
            }
            // Always save — vendor shipment fields may have changed even if overall status didn't
            await order.save();
            logger_1.logger.info('✅ Webhook processed:', {
                orderNumber: order.orderNumber,
                shipmentStatus: mappedShipmentStatus,
                orderStatusFrom: oldStatus,
                orderStatusTo: order.status,
                statusChanged: orderStatusChanged,
            });
            if (orderStatusChanged) {
                // Send notification + real-time socket event
                try {
                    const customerId = order.user._id
                        ? order.user._id.toString()
                        : order.user.toString();
                    await notification_service_1.notificationService.deliveryStatusUpdate(order._id.toString(), order.orderNumber, status.toLowerCase(), customerId);
                    await notification_service_1.notificationService.orderStatusUpdated(order._id.toString(), order.orderNumber, derivedStatus, customerId);
                    const vendorIds = vendorShipments
                        ?.map((s) => (typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString()))
                        .filter(Boolean) ?? [];
                    (0, notification_service_1.emitOrderStatusUpdate)({
                        orderId: order._id.toString(),
                        orderNumber: order.orderNumber,
                        status: derivedStatus,
                        customerId,
                        vendorIds,
                    });
                }
                catch (error) {
                    logger_1.logger.error('Error sending webhook notification:', error);
                }
            }
            logger_1.logger.info('📨 ============================================');
            logger_1.logger.info('📨 WEBHOOK PROCESSED SUCCESSFULLY');
            logger_1.logger.info('📨 ============================================\n');
            // Always return 200 to acknowledge receipt
            res.json({
                success: true,
                message: 'Webhook processed successfully',
                data: {
                    orderNumber: order.orderNumber,
                    status: order.status,
                },
            });
        }
        catch (error) {
            logger_1.logger.error('❌ Error processing webhook:', error);
            // Still return 200 to prevent retries
            res.json({
                success: true,
                message: 'Webhook received but processing failed',
            });
        }
    }
    /**
     * Map ShipBubble status to our OrderStatus.
     *
     * Option-C domain separation: 'pending' and 'confirmed' are vendor-owned statuses.
     * ShipBubble is never allowed to write them, so they are intentionally absent from
     * this map. ShipBubble only owns statuses from 'picked_up' / courier hand-off onwards.
     */
    mapShipBubbleStatus(shipBubbleStatus) {
        const statusMap = {
            // 'pending'   — omitted: vendor territory
            // 'confirmed' — omitted: vendor territory (ShipBubble confirmed = label created,
            //               not a vendor confirmation; handled at shipment level as 'created')
            'picked_up': types_1.OrderStatus.SHIPPED,
            'in_transit': types_1.OrderStatus.IN_TRANSIT,
            'completed': types_1.OrderStatus.DELIVERED,
            'cancelled': types_1.OrderStatus.CANCELLED,
        };
        return statusMap[shipBubbleStatus.toLowerCase()] ?? null;
    }
    /** Returns true only if `next` is strictly higher rank than `current`, or is a cancellation. */
    canAdvanceOrder(current, next) {
        if (next === 'cancelled')
            return true;
        const cur = WebhookController.ORDER_STATUS_RANK[current] ?? -1;
        const nxt = WebhookController.ORDER_STATUS_RANK[next] ?? -1;
        return nxt > cur;
    }
    canAdvanceShipment(current, next) {
        if (next === 'cancelled')
            return true;
        const cur = WebhookController.SHIPMENT_STATUS_RANK[current] ?? -1;
        const nxt = WebhookController.SHIPMENT_STATUS_RANK[next] ?? -1;
        return nxt > cur;
    }
    deriveMultiVendorOrderStatus(shipments) {
        const allStatuses = shipments.map((s) => s.status);
        const active = allStatuses.filter(s => s !== 'cancelled');
        if (allStatuses.every(s => s === 'cancelled'))
            return types_1.OrderStatus.CANCELLED;
        if (active.every(s => s === 'delivered'))
            return types_1.OrderStatus.DELIVERED;
        if (active.every(s => ['in_transit', 'delivered'].includes(s)))
            return types_1.OrderStatus.IN_TRANSIT;
        if (active.every(s => ['shipped', 'in_transit', 'delivered'].includes(s)))
            return types_1.OrderStatus.SHIPPED;
        if (active.every(s => ['processing', 'created', 'shipped', 'in_transit', 'delivered'].includes(s)))
            return types_1.OrderStatus.PROCESSING;
        if (active.every(s => ['confirmed', 'processing', 'created', 'shipped', 'in_transit', 'delivered'].includes(s)))
            return types_1.OrderStatus.CONFIRMED;
        return types_1.OrderStatus.PENDING;
    }
    /**
     * Refresh order status (for customers/vendors in sandbox testing)
     * This manually triggers a webhook simulation for the user's own order
     */
    async refreshOrderStatus(req, res) {
        const { orderId } = req.params;
        const { statusCode } = req.body;
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('🔄 REFRESH ORDER STATUS REQUEST');
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('👤 User:', req.user?.email);
        logger_1.logger.info('📦 Order ID:', orderId);
        logger_1.logger.info('📊 Status Code:', statusCode);
        try {
            // Find order and verify ownership
            const order = await Order_1.default.findById(orderId)
                .populate('user', 'email')
                .populate('items.vendor', '_id');
            if (!order) {
                throw new error_1.AppError('Order not found', 404);
            }
            // Check if user owns the order or is a vendor in the order
            const isCustomer = order.user.toString() === req.user?.id;
            const isVendor = order.items.some(item => item.vendor && item.vendor.toString() === req.user?.id);
            if (!isCustomer && !isVendor) {
                throw new error_1.AppError('Not authorized to refresh this order', 403);
            }
            logger_1.logger.info('✅ User authorized:', isCustomer ? 'Customer' : 'Vendor');
            // Get tracking number
            let trackingNumber = null;
            if (isVendor && order.vendorShipments) {
                // Find vendor's shipment
                const vendorShipment = order.vendorShipments.find((s) => s.vendor.toString() === req.user?.id);
                trackingNumber = vendorShipment?.trackingNumber || null;
                logger_1.logger.info('📦 Vendor shipment tracking:', trackingNumber);
            }
            else {
                // Customer sees first shipment or main tracking
                if (order.vendorShipments && order.vendorShipments.length > 0) {
                    trackingNumber = order.vendorShipments[0].trackingNumber;
                }
                else {
                    trackingNumber = order.trackingNumber;
                }
                logger_1.logger.info('📦 Order tracking:', trackingNumber);
            }
            if (!trackingNumber) {
                throw new error_1.AppError('No tracking number available for this order yet', 400);
            }
            // Simulate webhook if in sandbox mode
            if (process.env.SHIPBUBBLE_ENVIRONMENT === 'sandbox' && statusCode) {
                const validStatuses = ['pending', 'confirmed', 'picked_up', 'in_transit', 'completed', 'cancelled'];
                if (!validStatuses.includes(statusCode)) {
                    throw new error_1.AppError(`Invalid status code. Must be one of: ${validStatuses.join(', ')}`, 400);
                }
                logger_1.logger.info('🧪 Simulating webhook in sandbox mode...');
                const { shipBubbleWebhookService } = await Promise.resolve().then(() => __importStar(require('../services/shipbubble-webhook.service')));
                await shipBubbleWebhookService.simulateWebhook({
                    orderId: trackingNumber,
                    statusCode,
                });
                logger_1.logger.info('✅ Webhook simulated successfully');
            }
            // Fetch fresh order data
            const updatedOrder = await Order_1.default.findById(orderId)
                .populate('items.product', 'name images')
                .populate('items.vendor', 'firstName lastName');
            logger_1.logger.info('🔄 ============================================\n');
            res.json({
                success: true,
                message: statusCode
                    ? 'Order status refreshed and updated'
                    : 'Order status refreshed',
                data: {
                    order: updatedOrder,
                    trackingNumber,
                },
            });
        }
        catch (error) {
            logger_1.logger.error('❌ Refresh status error:', error);
            throw error;
        }
    }
    /**
     * Get webhook history for an order
     */
    async getWebhookHistory(req, res) {
        const { orderId } = req.params;
        const order = await Order_1.default.findById(orderId)
            .select('orderNumber vendorShipments.packageStatus vendorShipments.events');
        if (!order) {
            throw new error_1.AppError('Order not found', 404);
        }
        const webhookHistory = order.vendorShipments?.map((shipment) => ({
            vendor: shipment.vendorName,
            trackingNumber: shipment.trackingNumber,
            packageStatus: shipment.packageStatus || [],
            events: shipment.events || [],
        })) || [];
        res.json({
            success: true,
            data: {
                orderNumber: order.orderNumber,
                webhookHistory,
            },
        });
    }
    /**
     * Admin: manually sync an order's shipment status from ShipBubble.
     * Use this when a webhook was missed (e.g. DB outage, URL change).
     */
    async syncOrderShipment(req, res) {
        const { orderId } = req.params;
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('🔄 ADMIN MANUAL SHIPMENT SYNC');
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('👤 Admin:', req.user?.email);
        logger_1.logger.info('📦 Order ID:', orderId);
        const order = await Order_1.default.findById(orderId).populate('user', 'firstName lastName email');
        if (!order)
            throw new error_1.AppError('Order not found', 404);
        const vendorShipments = order.vendorShipments;
        // Collect every shipment that has a tracking number
        const shipmentTargets = (vendorShipments ?? [])
            .filter((s) => s.trackingNumber)
            .map((s) => ({ shipment: s, trackingNumber: s.trackingNumber }));
        // Fallback to order-level tracking number
        if (shipmentTargets.length === 0 && order.trackingNumber) {
            shipmentTargets.push({ shipment: null, trackingNumber: order.trackingNumber });
        }
        if (shipmentTargets.length === 0) {
            throw new error_1.AppError('No tracking number found for this order', 400);
        }
        const shipmentStatusMap = {
            pending: 'pending',
            confirmed: 'created',
            picked_up: 'shipped',
            in_transit: 'in_transit',
            delivered: 'delivered',
            completed: 'delivered',
            cancelled: 'cancelled',
        };
        const syncResults = [];
        let anyStatusChanged = false;
        const oldStatus = order.status;
        for (const { shipment, trackingNumber } of shipmentTargets) {
            logger_1.logger.info('📍 Fetching live status for tracking:', trackingNumber);
            let trackData;
            try {
                trackData = await shipbubble_service_1.shipBubbleService.trackShipment(trackingNumber);
            }
            catch (err) {
                logger_1.logger.error('❌ trackShipment failed for', trackingNumber, err.message);
                throw new error_1.AppError(`Failed to fetch status from ShipBubble for ${trackingNumber}: ${err.message}`, 502);
            }
            // ShipBubble returns { status: "success", data: { status: "completed", ... } }
            const rawStatus = (trackData?.data?.status ?? trackData?.status ?? '').toLowerCase();
            if (!rawStatus) {
                throw new error_1.AppError(`ShipBubble returned no status for tracking number ${trackingNumber}`, 502);
            }
            logger_1.logger.info('📊 Live status:', { trackingNumber, rawStatus });
            const mappedShipmentStatus = shipmentStatusMap[rawStatus] || 'created';
            if (shipment) {
                if (this.canAdvanceShipment(shipment.status, mappedShipmentStatus)) {
                    shipment.status = mappedShipmentStatus;
                }
                else {
                    logger_1.logger.info(`⏭️  Sync shipment rank guard blocked: ${shipment.status} → ${mappedShipmentStatus}`);
                }
                if (trackData?.data?.tracking_url)
                    shipment.trackingUrl = trackData.data.tracking_url;
                if (trackData?.data?.package_status?.length > 0)
                    shipment.packageStatus = trackData.data.package_status;
                if (trackData?.data?.events?.length > 0)
                    shipment.events = trackData.data.events;
            }
            syncResults.push({ trackingNumber, rawStatus, mapped: mappedShipmentStatus });
        }
        // Derive overall order status
        const updatedShipments = vendorShipments ?? [];
        const newOrderStatus = updatedShipments.length > 1
            ? this.deriveMultiVendorOrderStatus(updatedShipments)
            : this.mapShipBubbleStatus(syncResults[0].rawStatus);
        if (newOrderStatus && order.status !== newOrderStatus) {
            if (this.canAdvanceOrder(order.status, newOrderStatus)) {
                order.status = newOrderStatus;
                if (newOrderStatus === types_1.OrderStatus.DELIVERED && !order.deliveredAt) {
                    order.deliveredAt = new Date();
                }
                anyStatusChanged = true;
            }
            else {
                logger_1.logger.info(`⏭️  Sync order rank guard blocked: ${order.status} → ${newOrderStatus}`);
            }
        }
        await order.save();
        logger_1.logger.info('✅ Sync complete:', {
            orderNumber: order.orderNumber,
            from: oldStatus,
            to: order.status,
            changed: anyStatusChanged,
            shipments: syncResults,
        });
        if (anyStatusChanged) {
            try {
                const customerId = order.user._id
                    ? order.user._id.toString()
                    : order.user.toString();
                await notification_service_1.notificationService.deliveryStatusUpdate(order._id.toString(), order.orderNumber, syncResults[0].rawStatus, customerId);
                await notification_service_1.notificationService.orderStatusUpdated(order._id.toString(), order.orderNumber, order.status, customerId);
                const vendorIds = updatedShipments
                    .map((s) => (typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString()))
                    .filter(Boolean);
                (0, notification_service_1.emitOrderStatusUpdate)({
                    orderId: order._id.toString(),
                    orderNumber: order.orderNumber,
                    status: order.status,
                    customerId,
                    vendorIds,
                });
            }
            catch (err) {
                logger_1.logger.error('❌ Notification error during sync:', err);
            }
        }
        logger_1.logger.info('🔄 ============================================\n');
        res.json({
            success: true,
            message: anyStatusChanged
                ? `Order status updated from ${oldStatus} → ${order.status}`
                : 'Order already up to date — no status change needed',
            data: {
                orderNumber: order.orderNumber,
                previousStatus: oldStatus,
                currentStatus: order.status,
                changed: anyStatusChanged,
                shipments: syncResults,
            },
        });
    }
}
exports.WebhookController = WebhookController;
// ── Option-C rank guards ────────────────────────────────────────────────────
WebhookController.ORDER_STATUS_RANK = {
    pending: 0, confirmed: 1, processing: 2, shipped: 3, in_transit: 4, delivered: 5,
};
WebhookController.SHIPMENT_STATUS_RANK = {
    pending: 0, confirmed: 1, processing: 2, created: 3, shipped: 4, in_transit: 5, delivered: 6,
};
exports.webhookController = new WebhookController();
//# sourceMappingURL=webhook.controller.js.map