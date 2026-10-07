// controllers/vendorspot-logistics-webhook.controller.ts
//
// Inbound webhook from the VendorSpot Logistics aggregator (vendorspot-logistics).
// VSL is an aggregator in its own right — any adapter (Fez, Kwik, Dellyman, etc.)
// that fires a webhook into VSL ends up fanned out here as a `shipment.<status>`
// event, signed with HMAC-SHA256 over `${timestamp}.${rawBody}` using the shared
// secret `webhook_endpoints.secret` from VSL Postgres (env: LOGISTICS_WEBHOOK_SECRET).
//
// Behavior mirrors handleShipBubbleWebhook: finds the order by vslShipmentId,
// maps VSL canonical status → parent shipment status, applies rank guards (no
// regressions), recomputes multi-vendor Order.status, and fires the same
// notification + socket events ShipBubble triggers. From the customer's point
// of view the two paths are indistinguishable.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import Order from '../models/Order';
import { OrderStatus } from '../types';
import { notificationService, emitOrderStatusUpdate } from '../services/notification.service';
import { logger } from '../utils/logger';

// VSL canonical statuses (see vendorspot-logistics/packages/carrier-adapters/src/canonical-status.ts).
// Must stay in sync — any new VSL status needs mapping entries below or it falls through to a no-op.
type VslStatus =
  | 'created'
  | 'awaiting_pickup'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'delivery_failed'
  | 'cancelled'
  | 'returned';

// VSL canonical → parent vendorShipment.status enum.
// Parent's enum: 'pending' | 'confirmed' | 'processing' | 'created' | 'shipped' | 'in_transit' | 'delivered' | 'cancelled'
// Collapses VSL's finer-grained statuses (awaiting_pickup, out_for_delivery) onto parent's coarser set.
// delivery_failed + returned collapse to cancelled to signal terminal non-success.
const VSL_TO_SHIPMENT_STATUS: Record<VslStatus, string> = {
  created:          'created',
  awaiting_pickup:  'confirmed',
  picked_up:        'shipped',
  in_transit:       'in_transit',
  out_for_delivery: 'in_transit',
  delivered:        'delivered',
  delivery_failed:  'cancelled',
  cancelled:        'cancelled',
  returned:         'cancelled',
};

// VSL canonical → OrderStatus (only used for single-vendor orders; multi-vendor
// derives from aggregated shipment statuses, matching ShipBubble's approach).
const VSL_TO_ORDER_STATUS: Record<VslStatus, OrderStatus | null> = {
  created:          OrderStatus.PROCESSING,
  awaiting_pickup:  OrderStatus.PROCESSING,
  picked_up:        OrderStatus.SHIPPED,
  in_transit:       OrderStatus.IN_TRANSIT,
  out_for_delivery: OrderStatus.IN_TRANSIT,
  delivered:        OrderStatus.DELIVERED,
  delivery_failed:  null,
  cancelled:        OrderStatus.CANCELLED,
  returned:         OrderStatus.CANCELLED,
};

// Rank guards — identical to ShipBubble's. Enforces monotonic forward progress
// so an out-of-order webhook can't regress a shipment that's already further along.
// Cancellation is always allowed through (terminal reversal).
const SHIPMENT_STATUS_RANK: Record<string, number> = {
  pending: 0, confirmed: 1, processing: 2, created: 3, shipped: 4, in_transit: 5, delivered: 6,
};
const ORDER_STATUS_RANK: Record<string, number> = {
  pending: 0, confirmed: 1, processing: 2, shipped: 3, in_transit: 4, delivered: 5,
};
function canAdvanceShipment(current: string, next: string): boolean {
  if (next === 'cancelled') return true;
  return (SHIPMENT_STATUS_RANK[next] ?? -1) > (SHIPMENT_STATUS_RANK[current] ?? -1);
}
function canAdvanceOrder(current: string, next: string): boolean {
  if (next === 'cancelled') return true;
  return (ORDER_STATUS_RANK[next] ?? -1) > (ORDER_STATUS_RANK[current] ?? -1);
}

// Multi-vendor order status derivation — same logic as ShipBubble's
// deriveMultiVendorOrderStatus, kept in sync intentionally.
function deriveMultiVendorOrderStatus(shipments: any[]): OrderStatus {
  const all = shipments.map((s: any) => s.status as string);
  const active = all.filter((s) => s !== 'cancelled');
  if (all.every((s) => s === 'cancelled')) return OrderStatus.CANCELLED;
  if (active.every((s) => s === 'delivered')) return OrderStatus.DELIVERED;
  if (active.every((s) => ['in_transit', 'delivered'].includes(s))) return OrderStatus.IN_TRANSIT;
  if (active.every((s) => ['shipped', 'in_transit', 'delivered'].includes(s))) return OrderStatus.SHIPPED;
  if (active.every((s) => ['processing', 'created', 'shipped', 'in_transit', 'delivered'].includes(s))) return OrderStatus.PROCESSING;
  if (active.every((s) => ['confirmed', 'processing', 'created', 'shipped', 'in_transit', 'delivered'].includes(s))) return OrderStatus.CONFIRMED;
  return OrderStatus.PENDING;
}

// ±5min clock skew tolerance on the signature timestamp. Replays beyond this
// are rejected even with valid HMAC.
const MAX_SKEW_SECONDS = 5 * 60;

export async function handleVslWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.LOGISTICS_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[VSL webhook] LOGISTICS_WEBHOOK_SECRET not set — rejecting');
    res.status(503).json({ success: false, message: 'VSL webhook not configured' });
    return;
  }

  const sigHeader = req.headers['x-vendorspot-signature'];
  const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!sig) {
    res.status(401).json({ success: false, message: 'Missing signature' });
    return;
  }

  // `t=<ts>,v1=<hex>` — tolerate parameter order + extras but require both parts
  const parts = String(sig).split(',').map((p) => p.trim());
  const tsPart = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1Part = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!tsPart || !v1Part) {
    res.status(401).json({ success: false, message: 'Malformed signature' });
    return;
  }
  const ts = Number.parseInt(tsPart, 10);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > MAX_SKEW_SECONDS) {
    logger.warn('[VSL webhook] Timestamp outside tolerance');
    res.status(401).json({ success: false, message: 'Timestamp outside tolerance' });
    return;
  }

  // rawBody is captured by the global express.json({ verify }) hook in server.ts.
  const rawBody: Buffer | undefined = (req as any).rawBody;
  const bodyStr = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
  const expected = createHmac('sha256', secret).update(`${tsPart}.${bodyStr}`).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const incomingBuf = Buffer.from(v1Part);
  const matches =
    expectedBuf.length === incomingBuf.length && timingSafeEqual(expectedBuf, incomingBuf);
  if (!matches) {
    logger.warn('[VSL webhook] HMAC mismatch — rejecting');
    res.status(401).json({ success: false, message: 'Invalid signature' });
    return;
  }

  // ─── Signature verified. Process the event. ────────────────────────────────
  try {
    const payload = req.body ?? {};
    const eventType = String(payload?.type ?? '');
    const data = payload?.data ?? {};
    const shipmentId = String(data?.shipmentId ?? '');
    const vslStatus = String(data?.status ?? eventType.replace(/^shipment\./, '')) as VslStatus;
    const occurredAt = data?.occurredAt ? new Date(data.occurredAt) : new Date();
    const carrierShipmentId = data?.carrierShipmentId as string | undefined;
    const carrierTrackingNumber = data?.carrierTrackingNumber as string | undefined;
    const trackingUrl = data?.trackingUrl as string | undefined;

    logger.info(`[VSL webhook] ✓ ${eventType} shipmentId=${shipmentId} status=${vslStatus}`);

    if (!shipmentId) {
      res.status(200).json({ success: true, message: 'No shipmentId in payload — acknowledged' });
      return;
    }

    const mappedShipmentStatus = VSL_TO_SHIPMENT_STATUS[vslStatus];
    const mappedOrderStatus = VSL_TO_ORDER_STATUS[vslStatus];
    if (!mappedShipmentStatus) {
      logger.info(`[VSL webhook] Unknown VSL status "${vslStatus}" — acknowledging without action`);
      res.status(200).json({ success: true, message: 'Status not handled' });
      return;
    }

    // Load the full order so we can mirror ShipBubble's save-pattern (mutate +
    // save) and get access to statusHistory pre-save hooks + populated user.
    const order = await Order.findOne({ 'vendorShipments.vslShipmentId': shipmentId }).populate(
      'user',
      'firstName lastName email',
    );
    if (!order) {
      logger.warn(`[VSL webhook] No order found for vslShipmentId=${shipmentId}`);
      res.status(200).json({ success: true, message: 'Event received but no matching order' });
      return;
    }

    const vendorShipments: any[] | undefined = (order as any).vendorShipments;
    const vs = vendorShipments?.find((s: any) => s.vslShipmentId === shipmentId);
    if (!vs) {
      // Shouldn't happen — Order was found by this field. Defensive guard.
      res.status(200).json({ success: true, message: 'Shipment subdoc not found on order' });
      return;
    }

    // Always update the vsl* fields (audit trail) + carrier metadata, regardless
    // of whether the main status is allowed to advance. The rank guard only
    // gates the user-visible `status` field.
    vs.vslStatus = vslStatus;
    vs.vslStatusAt = occurredAt;
    if (carrierTrackingNumber) vs.vslTrackingNumber = carrierTrackingNumber;
    if (trackingUrl) vs.trackingUrl = trackingUrl;

    const shipmentAdvanced = canAdvanceShipment(vs.status || 'pending', mappedShipmentStatus);
    if (shipmentAdvanced) {
      vs.status = mappedShipmentStatus;
    } else {
      logger.info(
        `[VSL webhook] Shipment rank guard blocked: ${vs.status} → ${mappedShipmentStatus} (no regression)`,
      );
    }

    // Derive overall order status. Multi-vendor → aggregate; single-vendor → use direct map.
    const isMultiVendor = (vendorShipments?.length ?? 0) > 1;
    const derivedOrderStatus = isMultiVendor
      ? deriveMultiVendorOrderStatus(vendorShipments!)
      : mappedOrderStatus;

    const oldOrderStatus = order.status;
    let orderStatusChanged = false;
    if (derivedOrderStatus != null && order.status !== derivedOrderStatus) {
      if (canAdvanceOrder(order.status, derivedOrderStatus)) {
        order.status = derivedOrderStatus;
        orderStatusChanged = true;
        if (derivedOrderStatus === 'delivered' && !(order as any).deliveredAt) {
          (order as any).deliveredAt = occurredAt;
        }
      } else {
        logger.info(
          `[VSL webhook] Order rank guard blocked: ${order.status} → ${derivedOrderStatus} (no regression)`,
        );
      }
    }

    await order.save();

    logger.info('[VSL webhook] Order updated:', {
      orderNumber: order.orderNumber,
      shipmentFrom: shipmentAdvanced ? '(advanced)' : '(blocked)',
      shipmentTo: vs.status,
      vslStatus,
      orderFrom: oldOrderStatus,
      orderTo: order.status,
      orderStatusChanged,
    });

    // Fire notifications on order-level change — same calls ShipBubble uses, so
    // the customer sees identical push/socket events regardless of courier.
    if (orderStatusChanged) {
      try {
        const customerId = (order.user as any)?._id
          ? (order.user as any)._id.toString()
          : order.user.toString();

        await notificationService.deliveryStatusUpdate(
          order._id.toString(),
          order.orderNumber,
          vslStatus,
          customerId,
        );
        await notificationService.orderStatusUpdated(
          order._id.toString(),
          order.orderNumber,
          derivedOrderStatus!,
          customerId,
        );

        const vendorIds = (vendorShipments ?? [])
          .map((s: any) =>
            typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString(),
          )
          .filter(Boolean);

        emitOrderStatusUpdate({
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          status: derivedOrderStatus!,
          customerId,
          vendorIds,
        });
      } catch (err: any) {
        logger.error('[VSL webhook] Notification error (non-fatal):', err?.message ?? err);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Updated',
      data: {
        orderNumber: order.orderNumber,
        shipmentStatus: vs.status,
        orderStatus: order.status,
      },
    });
  } catch (err: any) {
    // VSL will NOT retry on non-2xx (it logs and moves on). We'd rather swallow +
    // acknowledge so we don't accumulate failed deliveries, but we log loudly.
    logger.error('[VSL webhook] Processing error (acknowledged):', err?.message ?? err, err?.stack);
    res.status(200).json({ success: true, message: 'Received but processing failed' });
  }
}
