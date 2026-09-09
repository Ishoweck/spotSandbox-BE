/**
 * Silently manage a ShipBubble shipment for a single-vendor order.
 *
 * Three modes:
 *
 *   List available couriers (calls Shipbubble rates API, no DB writes):
 *     npx ts-node scripts/rebook-order.ts --order VS220739837911 --list
 *
 *   DETACH-ONLY (stops incoming Shipbubble cancel webhook from matching this
 *   order — clears tracking + shipmentId only, does NOT book anything new):
 *     npx ts-node scripts/rebook-order.ts --order VS220739837911 --detach-only --commit
 *
 *   REBOOK (detach old + book new courier in one motion):
 *     npx ts-node scripts/rebook-order.ts --order VS220739837911 --courier "GIG Logistics" --commit
 *
 * All modes are silent — no notificationService, no socket emit, order.status
 * untouched. Old tracking values are stashed into adminNote for audit.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Order from '../src/models/Order';
import User from '../src/models/User';
import VendorProfile from '../src/models/VendorProfile';
import Product from '../src/models/Product';
import { shipBubbleService } from '../src/services/shipbubble.service';

// Reference imports so ts-node doesn't tree-shake the model registrations
// (Order.populate('items.product') requires Product to be registered).
void Product;
void User;
void VendorProfile;

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vendorspot';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const has = (name: string): boolean => args.includes(`--${name}`);
  return {
    order: get('order'),
    courier: get('courier'),
    list: has('list'),
    detachOnly: has('detach-only'),
    commit: has('commit'),
  };
}

const SHIP_SAFE_NAME = (preferred: string, fallback: string): string => {
  const clean = (s: string) => (s || '').replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const cp = clean(preferred);
  if (cp.split(' ').filter(Boolean).length >= 2) return cp;
  const cf = clean(fallback);
  if (cf.split(' ').filter(Boolean).length >= 2) return cf;
  return `${cp || cf || 'Store'} Vendor`;
};

async function main() {
  const { order: orderNumber, courier: courierName, list, detachOnly, commit } = parseArgs();

  if (!orderNumber) {
    console.error('❌ Missing --order <orderNumber>');
    process.exit(1);
  }
  if (!list && !detachOnly && !courierName) {
    console.error('❌ Provide one of: --list, --detach-only, or --courier "<name>"');
    process.exit(1);
  }
  if ((detachOnly || courierName) && !commit) {
    console.warn(`⚠️  Dry-run mode (no --commit). ${detachOnly ? 'Tracking will not be detached.' : 'Fresh rates will be fetched but no shipment will be booked.'}`);
  }

  await mongoose.connect(MONGO_URI);
  console.log(`✅ Connected to Mongo`);

  const order = await Order.findOne({ orderNumber })
    .populate('user')
    .populate('items.product');

  if (!order) {
    console.error(`❌ Order ${orderNumber} not found`);
    process.exit(1);
  }

  const shipments = (order as any).vendorShipments || [];
  const usingLegacyTopLevel = shipments.length === 0;

  if (usingLegacyTopLevel && !(order as any).trackingNumber && !(order as any).shipmentId) {
    console.error('❌ Order has no vendorShipments and no legacy top-level trackingNumber/shipmentId either.');
    console.error('   Dumping all tracking-related fields so we can see where Shipbubble tracking lives on this order:\n');
    const o: any = order.toObject ? order.toObject() : order;
    console.error('   status:            ', o.status);
    console.error('   paymentStatus:     ', o.paymentStatus);
    console.error('   deliveryType:      ', o.deliveryType);
    console.error('   isPickup:          ', o.isPickup);
    console.error('   isDigital:         ', o.isDigital);
    console.error('   top.trackingNumber:', o.trackingNumber);
    console.error('   top.shipmentId:    ', o.shipmentId);
    console.error('   top.courier:       ', o.courier);
    console.error('   vendorShipments:   ', JSON.stringify(o.vendorShipments, null, 2));
    console.error('   shippingDetails:   ', JSON.stringify(o.shippingDetails, null, 2));
    console.error('\n   ── Full order keys: ', Object.keys(o).sort().join(', '));
    console.error('\n👉 Paste this output back so we can see where the Shipbubble tracking is actually stored.');
    process.exit(1);
  }
  if (shipments.length > 1) {
    console.error(`❌ Order has ${shipments.length} vendor shipments — this script only handles single-vendor orders`);
    process.exit(1);
  }

  const shipment: any = usingLegacyTopLevel ? null : shipments[0];
  const vendorId = shipment
    ? (typeof shipment.vendor === 'object' ? shipment.vendor._id?.toString() : shipment.vendor?.toString())
    : (order.items[0] as any)?.vendor?.toString();

  console.log('\n📋 Current order state:');
  console.log(`   Order:         ${order.orderNumber}`);
  console.log(`   Status:        ${order.status}`);
  console.log(`   PaymentStatus: ${order.paymentStatus}`);
  console.log(`   Shipment shape: ${usingLegacyTopLevel ? 'legacy (top-level fields)' : 'vendorShipments[0]'}`);
  if (shipment) {
    console.log(`   Vendor:        ${shipment.vendorName} (${vendorId})`);
    console.log(`   Courier:       ${shipment.courier || '-'}`);
    console.log(`   TrackingNo:    ${shipment.trackingNumber || '-'}`);
    console.log(`   ShipmentId:    ${shipment.shipmentId || '-'}`);
    console.log(`   ShipmentStat:  ${shipment.status}`);
    console.log(`   TrackingUrl:   ${shipment.trackingUrl || '-'}\n`);
  } else {
    console.log(`   Vendor:        (from items[0].vendor: ${vendorId})`);
    console.log(`   Courier:       ${(order as any).courier || '-'}`);
    console.log(`   TrackingNo:    ${(order as any).trackingNumber || '-'}`);
    console.log(`   ShipmentId:    ${(order as any).shipmentId || '-'}\n`);
  }

  // ── DETACH-ONLY early exit ──────────────────────────────────────────────
  // Clears tracking + shipmentId so incoming Shipbubble cancel webhook hits
  // "Order not found" and returns 200 without side effects. No rate call.
  if (detachOnly) {
    if (!commit) {
      console.log('\n⚠️  Detach-only dry-run — pass --commit to actually clear tracking.');
      await mongoose.disconnect();
      process.exit(0);
    }
    const oldCourier   = shipment ? shipment.courier    : (order as any).courier;
    const oldTracking  = shipment ? shipment.trackingNumber : (order as any).trackingNumber;
    const oldShipmentId = shipment ? shipment.shipmentId  : (order as any).shipmentId;

    const audit = `[${new Date().toISOString()}] Silent detach (Shipbubble cancel prep): courier "${oldCourier || '-'}" tracking "${oldTracking || '-'}" shipmentId "${oldShipmentId || '-'}" [${usingLegacyTopLevel ? 'legacy' : 'vendorShipment[0]'}]`;
    (order as any).adminNote = ((order as any).adminNote ? (order as any).adminNote + '\n' : '') + audit;

    if (shipment) {
      shipment.trackingNumber = undefined;
      shipment.shipmentId = undefined;
      shipment.trackingUrl = undefined;
    }
    // Always clear the legacy top-level fields — the webhook lookup checks
    // `order.trackingNumber` too (webhook.controller.ts:66-68).
    (order as any).trackingNumber = undefined;
    (order as any).shipmentId = undefined;

    await order.save();
    console.log('\n✅ Tracking detached silently. Incoming Shipbubble cancel webhook will now be a no-op.');
    console.log('📨 No notification fired. Order status untouched.');
    console.log(`📝 Old values stashed in adminNote for audit.\n`);
    await mongoose.disconnect();
    process.exit(0);
  }

  const [vendor, vendorProfile] = await Promise.all([
    User.findById(vendorId),
    VendorProfile.findOne({ user: vendorId }),
  ]);
  if (!vendor) {
    console.error('❌ Vendor user not found');
    process.exit(1);
  }
  const customer: any = order.user;
  if (!customer || !order.shippingAddress) {
    console.error('❌ Order missing customer or shippingAddress');
    process.exit(1);
  }

  const usingPickup = !!shipment.origin?.street;
  const senderOrigin = usingPickup
    ? shipment.origin
    : vendorProfile?.businessAddress
    ? {
        street: vendorProfile.businessAddress.street || '',
        city: vendorProfile.businessAddress.city,
        state: vendorProfile.businessAddress.state,
        country: vendorProfile.businessAddress.country,
      }
    : null;
  if (!senderOrigin) {
    console.error('❌ No sender address available (shipment.origin empty and vendor businessAddress missing)');
    process.exit(1);
  }
  const senderFull = `${senderOrigin.street || 'Store Address'}, ${senderOrigin.city}, ${senderOrigin.state}, ${senderOrigin.country}`;
  const receiverFull = `${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.country || 'Nigeria'}`;

  const ownerFullName = vendor.firstName && vendor.lastName ? `${vendor.firstName} ${vendor.lastName}` : vendor.firstName || vendor.lastName || '';
  const senderName = SHIP_SAFE_NAME(shipment.vendorName, ownerFullName);
  const receiverFallback = order.shippingAddress.fullName || `${customer.firstName || ''} ${customer.lastName || ''}`;
  const receiverName = SHIP_SAFE_NAME(receiverFallback, `${customer.firstName || ''} ${customer.lastName || ''}`);

  const senderAddress = {
    name: senderName,
    phone: vendorProfile?.businessPhone || vendor.phone || '+2348000000000',
    email: vendorProfile?.businessEmail || vendor.email || 'sender@store.com',
    address: senderFull,
  };
  const receiverAddress = {
    name: receiverName,
    phone: order.shippingAddress.phone || customer.phone || '+2348000000000',
    email: customer.email,
    address: receiverFull,
  };

  const physicalItems = (order.items as any[]).filter((it) => {
    const p = it.product as any;
    const ptype = (p?.productType || it.productType || '').toString().toUpperCase();
    return ptype !== 'DIGITAL' && ptype !== 'SERVICE';
  });
  if (physicalItems.length === 0) {
    console.error('❌ No physical items in order');
    process.exit(1);
  }

  const packageItems = physicalItems.map((it: any) => ({
    name: it.productName,
    description: it.productName,
    unit_weight: ((it.product as any)?.weight ?? 0.5).toString(),
    unit_amount: it.price.toString(),
    quantity: it.quantity.toString(),
  }));

  const firstCategoryName = (physicalItems[0]?.product as any)?.category?.name;
  const categoryId = firstCategoryName ? shipBubbleService.getCategoryIdByName(firstCategoryName) : 77179563;

  const storedSenderCode = usingPickup
    ? (shipment.origin as any)?.shipBubble?.addressCode
    : (vendorProfile?.businessAddress as any)?.shipBubble?.addressCode;
  const storedReceiverCode = (order.shippingAddress as any)?.shipBubble?.addressCode;

  console.log('🔍 Fetching fresh rates from Shipbubble...');
  const rates = await shipBubbleService.getDeliveryRates(
    senderAddress,
    receiverAddress,
    packageItems,
    undefined,
    categoryId,
    storedSenderCode,
    storedReceiverCode
  );

  if (rates.status !== 'success' || !rates.data?.request_token) {
    console.error('❌ Failed to fetch rates:', rates.message || 'unknown');
    process.exit(1);
  }

  const couriers: any[] = rates.data.couriers || [];
  console.log(`\n📦 ${couriers.length} couriers available:`);
  couriers.forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.courier_name.padEnd(30)}  ₦${(c.total || c.rate_card_amount).toString().padStart(8)}  ETA: ${c.delivery_eta || '-'}  service: ${c.service_type || '-'}`);
  });

  if (list) {
    console.log('\n📖 List-only mode — no changes made.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const needle = courierName!.toLowerCase();
  const picked = couriers.find(
    (c) => c.courier_name.toLowerCase().includes(needle) || needle.includes(c.courier_name.toLowerCase())
  );
  if (!picked) {
    console.error(`\n❌ No courier matched "${courierName}". Pick one from the list above.`);
    process.exit(1);
  }
  console.log(`\n✅ Matched: ${picked.courier_name} (₦${picked.total || picked.rate_card_amount}, ETA ${picked.delivery_eta || '-'})`);

  if (!commit) {
    console.log('\n⚠️  Dry-run — pass --commit to actually book.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const audit = `[${new Date().toISOString()}] Silent rebook: was courier="${shipment.courier || '-'}" tracking="${shipment.trackingNumber || '-'}" shipmentId="${shipment.shipmentId || '-'}"`;
  (order as any).adminNote = ((order as any).adminNote ? (order as any).adminNote + '\n' : '') + audit;

  const oldTracking = shipment.trackingNumber;
  shipment.trackingNumber = undefined;
  shipment.shipmentId = undefined;
  shipment.trackingUrl = undefined;
  if ((order as any).trackingNumber && (order as any).trackingNumber === oldTracking) {
    (order as any).trackingNumber = undefined;
    (order as any).shipmentId = undefined;
  }
  await order.save();
  console.log('🧹 Detached old tracking on our side');

  console.log(`📝 Creating fresh Shipbubble shipment via ${picked.courier_name}...`);
  const created = await shipBubbleService.createShipment(
    rates.data.request_token,
    picked.courier_id,
    picked.service_code,
    false
  );

  const newOrderId = created?.data?.order_id;
  const newShipmentId = created?.data?.shipment_id || newOrderId;
  const newTrackingUrl = created?.data?.tracking_url;

  if (!newOrderId) {
    console.error('❌ Shipbubble returned no order_id. Response:', JSON.stringify(created, null, 2));
    process.exit(1);
  }

  const fresh = await Order.findById(order._id);
  const freshShipment: any = (fresh as any).vendorShipments[0];
  freshShipment.trackingNumber = newOrderId;
  freshShipment.shipmentId = newShipmentId;
  freshShipment.courier = picked.courier_name;
  freshShipment.requestedCourier = picked.courier_name;
  if (newTrackingUrl) freshShipment.trackingUrl = newTrackingUrl;
  if (!freshShipment.status || freshShipment.status === 'pending' || freshShipment.status === 'cancelled') {
    freshShipment.status = 'created';
  }
  await fresh!.save();

  console.log('\n✅ Rebooked silently. New tracking info:');
  console.log(`   Courier:     ${picked.courier_name}`);
  console.log(`   TrackingNo:  ${newOrderId}`);
  console.log(`   ShipmentId:  ${newShipmentId}`);
  console.log(`   TrackingUrl: ${newTrackingUrl || '-'}`);
  console.log('\n📨 No notification was fired. Order status untouched.');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Fatal:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
