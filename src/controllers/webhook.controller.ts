// controllers/webhook.controller.ts
import { Request, Response } from 'express';
import { AuthRequest, ApiResponse, OrderStatus } from '../types';
import Order from '../models/Order';
import { notificationService, emitOrderStatusUpdate } from '../services/notification.service';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error';
import { shipBubbleService } from '../services/shipbubble.service';

export class WebhookController {
  /**
   * Handle ShipBubble webhook for order status updates
   */
  async handleShipBubbleWebhook(req: Request, res: Response<ApiResponse>): Promise<void> {
    logger.info('📨 ============================================');
    logger.info('📨 SHIPBUBBLE WEBHOOK RECEIVED');
    logger.info('📨 ============================================');

    // HOTFIX: fail-OPEN while we wait for ShipBubble to send us the webhook secret.
    // Once SHIPBUBBLE_WEBHOOK_SECRET is set in the env, this block enforces signature
    // verification. Until then, we accept unverified callbacks so orders keep advancing
    // automatically instead of needing manual status updates. See memory:
    //   shipbubble_webhook_secret_followup.md
    const webhookSecret = process.env.SHIPBUBBLE_WEBHOOK_SECRET;
    if (webhookSecret) {
      const incoming = req.headers['x-shipbubble-signature'] || req.headers['authorization'];
      const incomingStr = incoming ? String(incoming) : '';
      const expected = `Bearer ${webhookSecret}`;
      const incomingBuf = Buffer.from(incomingStr);
      const expectedBuf = Buffer.from(expected);
      const matches =
        incomingBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(incomingBuf, expectedBuf);
      if (!matches) {
        logger.warn('🚫 ShipBubble webhook rejected — invalid signature');
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
    }

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
        if (this.canAdvanceShipment(shipment.status, mappedShipmentStatus)) {
          shipment.status = mappedShipmentStatus;
          logger.info('✅ Updated vendor shipment status:', { from: shipment.status, to: mappedShipmentStatus });
        } else {
          logger.info(`⏭️  Shipment rank guard blocked: ${shipment.status} → ${mappedShipmentStatus} (no regression)`);
        }
        // Always sync courier metadata regardless of status gate
        if (courier?.tracking_code) shipment.trackingCode = courier.tracking_code;
        if (tracking_url) shipment.trackingUrl = tracking_url;
        if (package_status?.length > 0) shipment.packageStatus = package_status;
        if (events?.length > 0) shipment.events = events;
      }

      // Derive overall order status:
      // Multi-vendor → aggregate from ALL shipments; single-vendor → use mapped status directly
      const derivedStatus = (vendorShipments && vendorShipments.length > 1)
        ? this.deriveMultiVendorOrderStatus(vendorShipments)
        : newStatus;

      const oldStatus = order.status;
      let orderStatusChanged = derivedStatus != null && order.status !== derivedStatus;

      if (orderStatusChanged) {
        if (this.canAdvanceOrder(order.status, derivedStatus!)) {
          order.status = derivedStatus!;
          if (derivedStatus === 'delivered' && !(order as any).deliveredAt) {
            (order as any).deliveredAt = new Date();
          }
        } else {
          logger.info(`⏭️  Order rank guard blocked: ${order.status} → ${derivedStatus} (no regression)`);
          orderStatusChanged = false;
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
   * Map ShipBubble status to our OrderStatus.
   *
   * Option-C domain separation: 'pending' and 'confirmed' are vendor-owned statuses.
   * ShipBubble is never allowed to write them, so they are intentionally absent from
   * this map. ShipBubble only owns statuses from 'picked_up' / courier hand-off onwards.
   */
  private mapShipBubbleStatus(shipBubbleStatus: string): OrderStatus | null {
    const statusMap: { [key: string]: OrderStatus } = {
      // 'pending'   — omitted: vendor territory
      // 'confirmed' — omitted: vendor territory (ShipBubble confirmed = label created,
      //               not a vendor confirmation; handled at shipment level as 'created')
      'picked_up': OrderStatus.SHIPPED,
      'in_transit': OrderStatus.IN_TRANSIT,
      'completed':  OrderStatus.DELIVERED,
      'cancelled':  OrderStatus.CANCELLED,
    };

    return statusMap[shipBubbleStatus.toLowerCase()] ?? null;
  }

  // ── Option-C rank guards ────────────────────────────────────────────────────

  private static readonly ORDER_STATUS_RANK: Record<string, number> = {
    pending: 0, confirmed: 1, processing: 2, shipped: 3, in_transit: 4, delivered: 5,
  };

  private static readonly SHIPMENT_STATUS_RANK: Record<string, number> = {
    pending: 0, confirmed: 1, processing: 2, created: 3, shipped: 4, in_transit: 5, delivered: 6,
  };

  /** Returns true only if `next` is strictly higher rank than `current`, or is a cancellation. */
  private canAdvanceOrder(current: string, next: string): boolean {
    if (next === 'cancelled') return true;
    const cur = WebhookController.ORDER_STATUS_RANK[current] ?? -1;
    const nxt = WebhookController.ORDER_STATUS_RANK[next] ?? -1;
    return nxt > cur;
  }

  private canAdvanceShipment(current: string, next: string): boolean {
    if (next === 'cancelled') return true;
    const cur = WebhookController.SHIPMENT_STATUS_RANK[current] ?? -1;
    const nxt = WebhookController.SHIPMENT_STATUS_RANK[next] ?? -1;
    return nxt > cur;
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
  async getWebhookHistory(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .select('orderNumber user vendorShipments.packageStatus vendorShipments.events');

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Only the order owner or an admin can view webhook history
    const callerId = req.user?.id;
    const isOwner = order.user?.toString() === callerId;
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    if (!isOwner && !isAdmin) {
      throw new AppError('Not authorized to view this order', 403);
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

  /**
   * Admin: manually sync an order's shipment status from ShipBubble.
   * Use this when a webhook was missed (e.g. DB outage, URL change).
   */
  async syncOrderShipment(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { orderId } = req.params;

    logger.info('🔄 ============================================');
    logger.info('🔄 ADMIN MANUAL SHIPMENT SYNC');
    logger.info('🔄 ============================================');
    logger.info('👤 Admin:', req.user?.email);
    logger.info('📦 Order ID:', orderId);

    const order = await Order.findById(orderId).populate('user', 'firstName lastName email');
    if (!order) throw new AppError('Order not found', 404);

    const vendorShipments: any[] | undefined = (order as any).vendorShipments;

    // Collect every shipment that has a tracking number
    const shipmentTargets: Array<{ shipment: any; trackingNumber: string }> =
      (vendorShipments ?? [])
        .filter((s: any) => s.trackingNumber)
        .map((s: any) => ({ shipment: s, trackingNumber: s.trackingNumber }));

    // Fallback to order-level tracking number
    if (shipmentTargets.length === 0 && (order as any).trackingNumber) {
      shipmentTargets.push({ shipment: null, trackingNumber: (order as any).trackingNumber });
    }

    if (shipmentTargets.length === 0) {
      throw new AppError('No tracking number found for this order', 400);
    }

    const shipmentStatusMap: Record<string, string> = {
      pending: 'pending',
      confirmed: 'created',
      picked_up: 'shipped',
      in_transit: 'in_transit',
      delivered: 'delivered',
      completed: 'delivered',
      cancelled: 'cancelled',
    };

    const syncResults: Array<{ trackingNumber: string; rawStatus: string; mapped: string }> = [];
    let anyStatusChanged = false;
    const oldStatus = order.status;

    for (const { shipment, trackingNumber } of shipmentTargets) {
      logger.info('📍 Fetching live status for tracking:', trackingNumber);

      let trackData: any;
      try {
        trackData = await shipBubbleService.trackShipment(trackingNumber);
      } catch (err: any) {
        logger.error('❌ trackShipment failed for', trackingNumber, err.message);
        throw new AppError(`Failed to fetch status from ShipBubble for ${trackingNumber}: ${err.message}`, 502);
      }

      // ShipBubble returns { status: "success", data: { status: "completed", ... } }
      const rawStatus: string =
        (trackData?.data?.status ?? trackData?.status ?? '').toLowerCase();

      if (!rawStatus) {
        throw new AppError(`ShipBubble returned no status for tracking number ${trackingNumber}`, 502);
      }

      logger.info('📊 Live status:', { trackingNumber, rawStatus });

      const mappedShipmentStatus = shipmentStatusMap[rawStatus] || 'created';

      if (shipment) {
        if (this.canAdvanceShipment(shipment.status, mappedShipmentStatus)) {
          shipment.status = mappedShipmentStatus;
        } else {
          logger.info(`⏭️  Sync shipment rank guard blocked: ${shipment.status} → ${mappedShipmentStatus}`);
        }
        if (trackData?.data?.tracking_url) shipment.trackingUrl = trackData.data.tracking_url;
        if (trackData?.data?.package_status?.length > 0) shipment.packageStatus = trackData.data.package_status;
        if (trackData?.data?.events?.length > 0) shipment.events = trackData.data.events;
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
        if (newOrderStatus === OrderStatus.DELIVERED && !(order as any).deliveredAt) {
          (order as any).deliveredAt = new Date();
        }
        anyStatusChanged = true;
      } else {
        logger.info(`⏭️  Sync order rank guard blocked: ${order.status} → ${newOrderStatus}`);
      }
    }

    await order.save();

    logger.info('✅ Sync complete:', {
      orderNumber: order.orderNumber,
      from: oldStatus,
      to: order.status,
      changed: anyStatusChanged,
      shipments: syncResults,
    });

    if (anyStatusChanged) {
      try {
        const customerId = (order.user as any)._id
          ? (order.user as any)._id.toString()
          : order.user.toString();

        await notificationService.deliveryStatusUpdate(
          order._id.toString(),
          order.orderNumber,
          syncResults[0].rawStatus,
          customerId
        );
        await notificationService.orderStatusUpdated(
          order._id.toString(),
          order.orderNumber,
          order.status,
          customerId
        );

        const vendorIds = updatedShipments
          .map((s: any) => (typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString()))
          .filter(Boolean);

        emitOrderStatusUpdate({
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          status: order.status,
          customerId,
          vendorIds,
        });
      } catch (err) {
        logger.error('❌ Notification error during sync:', err);
      }
    }

    logger.info('🔄 ============================================\n');

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

export const webhookController = new WebhookController();

// ================================================================
// PAYSTACK PAYMENT WEBHOOK
// POST /webhooks/paystack
// ================================================================

import { Notification, Wallet } from '../models/Additional';
import Cart from '../models/Cart';
import Product from '../models/Product';
import User from '../models/User';
import { PendingPayment } from '../models/PendingPayment';
import { paystackService } from '../services/paystack.service';
import { emitNewOrder } from '../services/notification.service';
import { PaymentStatus } from '../types';
import crypto from 'crypto';

export async function handlePaystackWebhook(req: Request, res: Response): Promise<void> {
  // 1. Verify HMAC-SHA512 signature — fail-closed: reject if secret not configured
  const rawBody: Buffer | undefined = (req as any).rawBody;
  const signature = req.headers['x-paystack-signature'] as string | undefined;
  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    logger.error('[Paystack Webhook] PAYSTACK_SECRET_KEY not configured — rejecting request');
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  if (!signature) {
    logger.warn('[Paystack Webhook] Missing x-paystack-signature header');
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const expected = crypto
    .createHmac('sha512', secret)
    .update(rawBody || Buffer.from(JSON.stringify(req.body)))
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    logger.warn('[Paystack Webhook] Invalid signature — request rejected');
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  // Acknowledge immediately so Paystack doesn't retry due to timeout
  res.status(200).json({ received: true });

  const event = req.body;
  logger.info(`[Paystack Webhook] Event: ${event.event}`);

  try {
    if (event.event === 'charge.success') {
      const { reference, amount, metadata = {} } = event.data as any;
      const paidAmountNaira = amount / 100;
      const purpose: string = metadata.purpose || 'order';

      if (purpose === 'wallet_topup') {
        await _fulfillWalletTopUp(reference, metadata.userId as string, paidAmountNaira);
      } else {
        await _fulfillOrder(reference, paidAmountNaira, metadata);
      }
    }
  } catch (err: any) {
    logger.error('[Paystack Webhook] Processing error:', err.message);
  }
}

async function _fulfillOrder(reference: string, paidAmountNaira: number, metadata: any): Promise<void> {
  // Guard: if order was already created (by confirmPayment), just mark PendingPayment and exit
  const existingOrder = await Order.findOne({ orderNumber: reference });
  if (existingOrder) {
    logger.info(`[Paystack Webhook] Order ${reference} already exists — marking complete`);
    await PendingPayment.findOneAndUpdate({ reference }, { status: 'completed', completedAt: new Date() });
    return;
  }

  // Parse the checkout snapshot embedded in Paystack metadata
  let snapshot: any;
  try {
    snapshot = typeof metadata.checkoutSnapshot === 'string'
      ? JSON.parse(metadata.checkoutSnapshot)
      : metadata.checkoutSnapshot;
  } catch {
    logger.error(`[Paystack Webhook] Cannot parse snapshot for ${reference}`);
    return;
  }

  if (!snapshot?.userId) {
    logger.error(`[Paystack Webhook] No snapshot/userId in metadata for ${reference}`);
    return;
  }

  // Guard: actual amount paid must match what the client said they'd pay (tolerance ₦2 for rounding)
  if (snapshot.total && Math.abs(paidAmountNaira - snapshot.total) > 2) {
    logger.error(`[Paystack Webhook] Amount mismatch for ${reference}: paid ₦${paidAmountNaira}, snapshot total ₦${snapshot.total} — rejecting`);
    return;
  }

  const userId: string = snapshot.userId;

  // Fetch cart and user in parallel
  const [cart, user] = await Promise.all([
    Cart.findById(snapshot.cartId).populate({
      path: 'items.product',
      populate: { path: 'vendor', select: 'firstName lastName email' },
    }),
    User.findById(userId),
  ]);

  if (!user) {
    logger.error(`[Paystack Webhook] User ${userId} not found for reference ${reference}`);
    return;
  }

  // Build order items from cart (cart might be cleared if confirmPayment ran partially)
  let orderItems: any[] = [];
  const isDigitalOnly: boolean = snapshot.isDigitalOnly || false;

  if (cart && cart.items.length > 0) {
    orderItems = cart.items.map((item: any) => ({
      product:      item.product._id,
      productName:  item.product.name,
      productImage: item.product.images?.[0],
      productType:  item.product.productType || 'physical',
      variant:      item.variant,
      quantity:     item.quantity,
      price:        item.price,
      vendor:       item.product.vendor._id,
    }));
  } else {
    logger.warn(`[Paystack Webhook] Cart ${snapshot.cartId} empty/missing for ${reference} — creating partial order`);
  }

  // Build vendorShipments from snapshot delivery data
  const vendorShipments: any[] = [];
  if (!isDigitalOnly && snapshot.deliveryType !== 'pickup' && orderItems.length > 0) {
    const vendorItemMap = new Map<string, any[]>();
    for (const item of orderItems) {
      const vid = item.vendor.toString();
      if (!vendorItemMap.has(vid)) vendorItemMap.set(vid, []);
      vendorItemMap.get(vid)!.push(item.product);
    }

    for (const [vendorId, productIds] of vendorItemMap.entries()) {
      const deliveries: any[] = snapshot.vendorDeliveries || [];
      const breakdown: any[] = snapshot.vendorBreakdown || [];
      const vd = deliveries.find((v: any) => v.vendorId === vendorId)
             || breakdown.find((v: any) => v.vendorId === vendorId);

      vendorShipments.push({
        vendor:           vendorId,
        vendorName:       '',
        items:            productIds,
        origin:           { street: '', city: '', state: '', country: 'Nigeria' },
        shippingCost:     vd?.price ?? snapshot.selectedDeliveryPrice ?? 0,
        courier:          vd?.courier || snapshot.selectedCourier || 'Standard',
        requestedCourier: vd?.courier || snapshot.selectedCourier || 'Standard',
        status:           'pending',
      });
    }
  }

  // Create the order with snapshot financials.
  // The unique index on orderNumber means a concurrent duplicate webhook will throw
  // error code 11000 — we catch that and treat it the same as "already exists".
  let order: any;
  try {
    order = await Order.create({
      orderNumber:      reference,
      user:             userId,
      items:            orderItems,
      subtotal:         snapshot.subtotal,
      discount:         snapshot.discount || 0,
      shippingCost:     snapshot.totalShippingCost || 0,
      tax:              snapshot.tax || 0,
      serviceCharge:    snapshot.serviceCharge || 0,
      total:            snapshot.total,
      status:           isDigitalOnly ? OrderStatus.DELIVERED : OrderStatus.PENDING,
      paymentStatus:    PaymentStatus.COMPLETED,
      paymentMethod:    snapshot.paymentMethod,
      paymentReference: reference,
      shippingAddress:  isDigitalOnly ? undefined : snapshot.shippingAddress,
      couponCode:       snapshot.couponCode,
      notes:            snapshot.notes,
      deliveryType:     isDigitalOnly ? 'digital' : snapshot.deliveryType,
      isPickup:         snapshot.deliveryType === 'pickup' || isDigitalOnly,
      vendorShipments,
      isDigital:        isDigitalOnly,
    });
  } catch (createErr: any) {
    if (createErr.code === 11000) {
      logger.info(`[Paystack Webhook] Duplicate order create blocked for ${reference} — already fulfilled by concurrent request`);
      await PendingPayment.findOneAndUpdate({ reference }, { status: 'completed', completedAt: new Date() });
      return;
    }
    throw createErr;
  }

  logger.info(`[Paystack Webhook] Order created: ${order._id} (ref: ${reference})`);

  // Mark PendingPayment as completed
  await PendingPayment.findOneAndUpdate(
    { reference },
    { status: 'completed', completedAt: new Date() }
  );

  // Deduct VCredits atomically (same guard as confirmPayment)
  const vCreditsApplied: number = snapshot.vCreditsApplied || 0;
  if (vCreditsApplied > 0) {
    await Wallet.findOneAndUpdate(
      { user: userId, vCredits: { $gte: vCreditsApplied } },
      {
        $inc: { vCredits: -vCreditsApplied },
        $push: {
          transactions: {
            type: 'debit',
            amount: vCreditsApplied,
            purpose: 'purchase',
            reference: `VCREDITS-${order._id}`,
            description: `VCredits applied to order #${order.orderNumber}`,
            status: 'completed',
            timestamp: new Date(),
          },
        },
      }
    );
  }

  // Reduce stock atomically
  for (const item of orderItems) {
    const isPhysical = item.productType?.toUpperCase() !== 'DIGITAL' && item.productType?.toUpperCase() !== 'SERVICE';
    if (isPhysical) {
      await Product.findOneAndUpdate(
        { _id: item.product, quantity: { $gte: item.quantity } },
        { $inc: { quantity: -item.quantity, totalSales: item.quantity } }
      );
    } else {
      await Product.findByIdAndUpdate(item.product, { $inc: { totalSales: item.quantity } });
    }
  }

  // Clear cart
  if (cart && cart.items.length > 0) {
    cart.items = [];
    await cart.save();
  }

  // Notifications (non-blocking)
  try {
    const vendorIds = [...new Set(orderItems.map((i: any) => i.vendor.toString()))];
    await notificationService.orderPlaced(order._id.toString(), order.orderNumber, order.total, userId, vendorIds);
    await notificationService.paymentCompleted(order._id.toString(), order.orderNumber, order.total, userId);
    emitNewOrder({ orderId: order._id.toString(), orderNumber: order.orderNumber, vendorIds });
  } catch (notifErr: any) {
    logger.error('[Paystack Webhook] Notification error:', notifErr.message);
  }
}

async function _fulfillWalletTopUp(reference: string, userId: string, amountNaira: number): Promise<void> {
  if (!userId) {
    logger.error(`[Paystack Webhook] wallet_topup missing userId for ${reference}`);
    return;
  }

  // Atomic: only credit if this reference hasn't been processed yet
  const wallet = await Wallet.findOneAndUpdate(
    {
      user: userId,
      $nor: [{ transactions: { $elemMatch: { reference, status: 'completed' } } }],
    },
    {
      $inc: { balance: amountNaira, totalEarned: amountNaira },
      $push: {
        transactions: {
          type: 'credit',
          amount: amountNaira,
          purpose: 'top_up',
          reference,
          description: 'Wallet top-up via Paystack (webhook)',
          status: 'completed',
          timestamp: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!wallet) {
    logger.info(`[Paystack Webhook] Wallet top-up ${reference} already credited — skipping`);
    return;
  }

  await PendingPayment.findOneAndUpdate(
    { reference },
    { status: 'completed', completedAt: new Date() }
  );

  try {
    await notificationService.walletTopUp(userId, amountNaira, wallet.balance);
  } catch (e: any) {
    logger.error('[Paystack Webhook] Wallet top-up notification error:', e.message);
  }

  logger.info(`[Paystack Webhook] Wallet top-up ${reference}: ₦${amountNaira} credited to ${userId}`);
}

// ================================================================
// FLUTTERWAVE PAYMENT WEBHOOK
// POST /webhooks/flutterwave
// ================================================================

import { flutterwaveService } from '../services/flutterwave.service';

export async function handleFlutterwaveWebhook(req: Request, res: Response): Promise<void> {
  // Flutterwave signs with a secret hash — fail-closed: reject if secret not configured
  const secretHash = process.env.FLW_SECRET_HASH;
  const signature = req.headers['verif-hash'] as string | undefined;

  if (!secretHash) {
    logger.error('[Flutterwave Webhook] FLW_SECRET_HASH not configured — rejecting request');
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(secretHash))) {
    logger.warn('[Flutterwave Webhook] Invalid verif-hash — request rejected');
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  // Acknowledge immediately
  res.status(200).json({ received: true });

  const event = req.body;
  logger.info(`[Flutterwave Webhook] Event: ${event.event}`);

  try {
    if (event.event === 'charge.completed') {
      const data = event.data as any;

      if (data.status !== 'successful') {
        logger.info(`[Flutterwave Webhook] Payment not successful (${data.status}) — skipping`);
        return;
      }

      const reference: string = data.tx_ref;                   // our generated reference
      const transactionId: string = String(data.id);           // Flutterwave's transaction_id
      const paidAmount: number = data.charged_amount ?? data.amount;
      const meta: any = data.meta || {};
      const purpose: string = meta.purpose || 'order';

      if (purpose === 'wallet_topup') {
        await _fulfillWalletTopUp(reference, meta.userId as string, paidAmount);
      } else {
        // Re-verify with Flutterwave to confirm the charge before acting
        try {
          const verification = await flutterwaveService.verifyPayment(transactionId);
          if (verification.data?.status !== 'successful') {
            logger.warn(`[Flutterwave Webhook] Re-verification failed for ${reference}`);
            return;
          }
        } catch (verifyErr: any) {
          logger.error(`[Flutterwave Webhook] Re-verify error for ${reference}:`, verifyErr.message);
          return;
        }

        await _fulfillOrder(reference, paidAmount, meta);
      }
    }
  } catch (err: any) {
    logger.error('[Flutterwave Webhook] Processing error:', err.message);
  }
}

// ================================================================
// RESEND DELIVERY STATUS WEBHOOK
// POST /webhooks/resend
// ================================================================

export async function handleResendWebhook(req: Request, res: Response): Promise<void> {
  // Verify Resend webhook signature
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['svix-signature'] as string | undefined;
    const msgId = req.headers['svix-id'] as string | undefined;
    const timestamp = req.headers['svix-timestamp'] as string | undefined;

    if (!signature || !msgId || !timestamp) {
      res.status(401).json({ success: false, message: 'Missing webhook headers' });
      return;
    }

    // Svix computes the signature over the raw request bytes — must NOT use re-serialized JSON
    const rawResendBody = (req as any).rawBody as Buffer | undefined;
    const bodyStr = rawResendBody ? rawResendBody.toString('utf8') : JSON.stringify(req.body);
    const toSign = `${msgId}.${timestamp}.${bodyStr}`;
    const expected = crypto.createHmac('sha256', secret).update(toSign).digest('base64');
    const signatures = signature.split(' ').map((s) => s.split(',')[1]);
    const valid = signatures.some((s) => s === expected);

    if (!valid) {
      res.status(401).json({ success: false, message: 'Invalid signature' });
      return;
    }
  }

  const { type, data } = req.body;

  const statusMap: Record<string, string> = {
    'email.delivered':   'delivered',
    'email.bounced':     'bounced',
    'email.complained':  'bounced',
    'email.delivery_delayed': 'pending',
  };

  const emailStatus = statusMap[type];
  if (!emailStatus || !data?.email_id) {
    res.status(200).json({ success: true }); // Acknowledge unknown events
    return;
  }

  try {
    await Notification.updateMany(
      { 'data.resendEmailId': data.email_id },
      { $set: { emailStatus } },
    );
    logger.info(`[ResendWebhook] ${type} → emailStatus: ${emailStatus} (emailId: ${data.email_id})`);
  } catch (err: any) {
    logger.error('[ResendWebhook] Failed to update delivery status:', err.message);
  }

  res.status(200).json({ success: true });
}