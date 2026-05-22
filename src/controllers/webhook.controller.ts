// controllers/webhook.controller.ts
import { Request, Response } from 'express';
import { AuthRequest, ApiResponse, OrderStatus } from '../types';
import Order from '../models/Order';
import { notificationService, emitOrderStatusUpdate } from '../services/notification.service';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error';

export class WebhookController {
  /**
   * Handle ShipBubble webhook for order status updates
   */
  async handleShipBubbleWebhook(req: Request, res: Response<ApiResponse>): Promise<void> {
    logger.info('📨 ============================================');
    logger.info('📨 SHIPBUBBLE WEBHOOK RECEIVED');
    logger.info('📨 ============================================');
    
    const webhookData = req.body;
    
    logger.info('📦 Webhook payload:', {
      order_id: webhookData.order_id,
      status: webhookData.status,
      courier: webhookData.courier?.name,
      tracking_code: webhookData.courier?.tracking_code,
    });

    try {
      const { order_id, status, courier, package_status, events, tracking_url } = webhookData;

      if (!order_id) {
        logger.error('❌ Missing order_id in webhook');
        res.status(400).json({
          success: false,
          message: 'Missing order_id',
        });
        return;
      }

      // Find order by tracking number or shipment ID
      const order = await Order.findOne({
        $or: [
          { 'vendorShipments.trackingNumber': order_id },
          { 'vendorShipments.shipmentId': order_id },
          { trackingNumber: order_id },
        ],
      }).populate('user', 'firstName lastName email');

      if (!order) {
        logger.warn(`⚠️ Order not found for tracking number: ${order_id}`);
        // Still return 200 to acknowledge receipt
        res.json({
          success: true,
          message: 'Webhook received but order not found',
        });
        return;
      }

      logger.info('✅ Order found:', {
        orderNumber: order.orderNumber,
        currentStatus: order.status,
      });

      // Map ShipBubble status to our order status
      const newStatus = this.mapShipBubbleStatus(status);
      
      logger.info('🔄 Status mapping:', {
        shipBubbleStatus: status,
        mappedStatus: newStatus,
      });

      // Map ShipBubble → vendor shipment status
      const shipmentStatusMap: Record<string, string> = {
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
      const vendorShipments: any[] | undefined = (order as any).vendorShipments;
      const shipment = vendorShipments?.find(
        (s: any) => s.trackingNumber === order_id || s.shipmentId === order_id
      );

      if (shipment) {
        shipment.status = mappedShipmentStatus;
        if (courier?.tracking_code) shipment.trackingCode = courier.tracking_code;
        if (tracking_url) shipment.trackingUrl = tracking_url;
        if (package_status?.length > 0) shipment.packageStatus = package_status;
        if (events?.length > 0) shipment.events = events;
        logger.info('✅ Updated vendor shipment:', { status: shipment.status });
      }

      // Derive overall order status:
      // Multi-vendor → aggregate from ALL shipments; single-vendor → use mapped status directly
      const derivedStatus = (vendorShipments && vendorShipments.length > 1)
        ? this.deriveMultiVendorOrderStatus(vendorShipments)
        : newStatus;

      const oldStatus = order.status;
      const orderStatusChanged = derivedStatus != null && order.status !== derivedStatus;

      if (orderStatusChanged) {
        order.status = derivedStatus!;
        if (derivedStatus === 'delivered' && !(order as any).deliveredAt) {
          (order as any).deliveredAt = new Date();
        }
      }

      // Always save — vendor shipment fields may have changed even if overall status didn't
      await order.save();

      logger.info('✅ Webhook processed:', {
        orderNumber: order.orderNumber,
        shipmentStatus: mappedShipmentStatus,
        orderStatusFrom: oldStatus,
        orderStatusTo: order.status,
        statusChanged: orderStatusChanged,
      });

      if (orderStatusChanged) {
        // Send notification + real-time socket event
        try {
          const customerId = (order.user as any)._id
            ? (order.user as any)._id.toString()
            : order.user.toString();

          await notificationService.deliveryStatusUpdate(
            order._id.toString(),
            order.orderNumber,
            status.toLowerCase(),
            customerId
          );
          await notificationService.orderStatusUpdated(
            order._id.toString(),
            order.orderNumber,
            derivedStatus!,
            customerId
          );

          const vendorIds = vendorShipments
            ?.map((s: any) => (typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString()))
            .filter(Boolean) ?? [];

          emitOrderStatusUpdate({
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            status: derivedStatus!,
            customerId,
            vendorIds,
          });
        } catch (error) {
          logger.error('Error sending webhook notification:', error);
        }
      }

      logger.info('📨 ============================================');
      logger.info('📨 WEBHOOK PROCESSED SUCCESSFULLY');
      logger.info('📨 ============================================\n');

      // Always return 200 to acknowledge receipt
      res.json({
        success: true,
        message: 'Webhook processed successfully',
        data: {
          orderNumber: order.orderNumber,
          status: order.status,
        },
      });

    } catch (error: any) {
      logger.error('❌ Error processing webhook:', error);
      
      // Still return 200 to prevent retries
      res.json({
        success: true,
        message: 'Webhook received but processing failed',
      });
    }
  }

  /**
   * Map ShipBubble status to our OrderStatus
   */
  private mapShipBubbleStatus(shipBubbleStatus: string): OrderStatus | null {
    const statusMap: { [key: string]: OrderStatus } = {
      'pending': OrderStatus.CONFIRMED,
      'confirmed': OrderStatus.PROCESSING,
      'picked_up': OrderStatus.SHIPPED,
      'in_transit': OrderStatus.IN_TRANSIT,
      'completed': OrderStatus.DELIVERED,
      'cancelled': OrderStatus.CANCELLED,
    };

    return statusMap[shipBubbleStatus.toLowerCase()] || null;
  }

  private deriveMultiVendorOrderStatus(shipments: any[]): OrderStatus {
    const allStatuses = shipments.map((s: any) => s.status as string);
    const active = allStatuses.filter(s => s !== 'cancelled');

    if (allStatuses.every(s => s === 'cancelled')) return OrderStatus.CANCELLED;
    if (active.every(s => s === 'delivered')) return OrderStatus.DELIVERED;
    if (active.every(s => ['in_transit', 'delivered'].includes(s))) return OrderStatus.IN_TRANSIT;
    if (active.every(s => ['shipped', 'in_transit', 'delivered'].includes(s))) return OrderStatus.SHIPPED;
    if (active.every(s => ['processing', 'created', 'shipped', 'in_transit', 'delivered'].includes(s))) return OrderStatus.PROCESSING;
    if (active.every(s => ['confirmed', 'processing', 'created', 'shipped', 'in_transit', 'delivered'].includes(s))) return OrderStatus.CONFIRMED;
    return OrderStatus.PENDING;
  }

  /**
   * Refresh order status (for customers/vendors in sandbox testing)
   * This manually triggers a webhook simulation for the user's own order
   */
  async refreshOrderStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { orderId } = req.params;
    const { statusCode } = req.body;

    logger.info('🔄 ============================================');
    logger.info('🔄 REFRESH ORDER STATUS REQUEST');
    logger.info('🔄 ============================================');
    logger.info('👤 User:', req.user?.email);
    logger.info('📦 Order ID:', orderId);
    logger.info('📊 Status Code:', statusCode);

    try {
      // Find order and verify ownership
      const order = await Order.findById(orderId)
        .populate('user', 'email')
        .populate('items.vendor', '_id');

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      // Check if user owns the order or is a vendor in the order
      const isCustomer = order.user.toString() === req.user?.id;
      const isVendor = order.items.some(
        item => item.vendor && item.vendor.toString() === req.user?.id
      );

      if (!isCustomer && !isVendor) {
        throw new AppError('Not authorized to refresh this order', 403);
      }

      logger.info('✅ User authorized:', isCustomer ? 'Customer' : 'Vendor');

      // Get tracking number
      let trackingNumber: string | null = null;

      if (isVendor && (order as any).vendorShipments) {
        // Find vendor's shipment
        const vendorShipment = (order as any).vendorShipments.find(
          (s: any) => s.vendor.toString() === req.user?.id
        );
        trackingNumber = vendorShipment?.trackingNumber || null;
        logger.info('📦 Vendor shipment tracking:', trackingNumber);
      } else {
        // Customer sees first shipment or main tracking
        if ((order as any).vendorShipments && (order as any).vendorShipments.length > 0) {
          trackingNumber = (order as any).vendorShipments[0].trackingNumber;
        } else {
          trackingNumber = order.trackingNumber;
        }
        logger.info('📦 Order tracking:', trackingNumber);
      }

      if (!trackingNumber) {
        throw new AppError('No tracking number available for this order yet', 400);
      }

      // Simulate webhook if in sandbox mode
      if (process.env.SHIPBUBBLE_ENVIRONMENT === 'sandbox' && statusCode) {
        const validStatuses = ['pending', 'confirmed', 'picked_up', 'in_transit', 'completed', 'cancelled'];
        if (!validStatuses.includes(statusCode)) {
          throw new AppError(`Invalid status code. Must be one of: ${validStatuses.join(', ')}`, 400);
        }

        logger.info('🧪 Simulating webhook in sandbox mode...');
        
        const { shipBubbleWebhookService } = await import('../services/shipbubble-webhook.service');
        await shipBubbleWebhookService.simulateWebhook({
          orderId: trackingNumber,
          statusCode,
        });

        logger.info('✅ Webhook simulated successfully');
      }

      // Fetch fresh order data
      const updatedOrder = await Order.findById(orderId)
        .populate('items.product', 'name images')
        .populate('items.vendor', 'firstName lastName');

      logger.info('🔄 ============================================\n');

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

    } catch (error: any) {
      logger.error('❌ Refresh status error:', error);
      throw error;
    }
  }

  /**
   * Get webhook history for an order
   */
  async getWebhookHistory(req: Request, res: Response<ApiResponse>): Promise<void> {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .select('orderNumber vendorShipments.packageStatus vendorShipments.events');

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    const webhookHistory = (order as any).vendorShipments?.map((shipment: any) => ({
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
}

export const webhookController = new WebhookController();