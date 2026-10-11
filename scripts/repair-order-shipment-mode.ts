/**
 * Patch deliveryMode on a vendor's shipment inside an order, OR create the
 * shipment entry if the order has none for that vendor. Unblocks the "stuck
 * on ShipBubble banner" case (deliveryMode wrong) AND the "shipment never
 * created" case (empty vendorShipments[] after payment).
 *
 * Dry-run (prints state only):
 *   npx ts-node scripts/repair-order-shipment-mode.ts --order VS407923989103 --vendor Ishowleckcc
 *
 * Apply patch to existing shipment:
 *   npx ts-node scripts/repair-order-shipment-mode.ts --order VS407923989103 --vendor Ishowleckcc --mode SELF_DELIVERY --apply
 *
 * Apply insert when vendorShipments is empty / missing for this vendor:
 *   npx ts-node scripts/repair-order-shipment-mode.ts --order VS418198217933 --vendor Ishowleckcc --mode PICKUP --apply --insert
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Order from '../src/models/Order';
import VendorProfile from '../src/models/VendorProfile';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vendorspot';
const VALID_MODES = new Set(['VENDORSPOT_DELIVERY', 'SELF_DELIVERY', 'PICKUP']);

function arg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const orderNumber = arg('order');
  const vendorNeedle = arg('vendor');
  const mode = arg('mode');
  const apply = process.argv.includes('--apply');

  if (!orderNumber || !vendorNeedle) {
    console.error('Usage: --order <VS...> --vendor <businessName or user id> [--mode <SELF_DELIVERY|PICKUP|VENDORSPOT_DELIVERY>] [--apply]');
    process.exit(1);
  }
  if (apply && (!mode || !VALID_MODES.has(mode))) {
    console.error('--apply requires --mode with one of: VENDORSPOT_DELIVERY, SELF_DELIVERY, PICKUP');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  const order: any = await Order.findOne({ orderNumber });
  if (!order) {
    console.error(`Order ${orderNumber} not found`);
    process.exit(1);
  }

  console.log(`\nOrder ${orderNumber}  (status=${order.status}, paymentStatus=${order.paymentStatus})`);
  console.log(`vendorShipments:`);
  for (const s of order.vendorShipments || []) {
    const vId = typeof s.vendor === 'object' ? s.vendor?._id?.toString() : s.vendor?.toString();
    console.log(
      `  - ${s.vendorName || '(no name)'}  vendor=${vId}  mode=${s.deliveryMode || '(none)'}  status=${s.status}  courier=${s.courier || '-'}`
    );
  }

  const insert = process.argv.includes('--insert');

  const shipment = (order.vendorShipments || []).find((s: any) => {
    const vId = typeof s.vendor === 'object' ? s.vendor?._id?.toString() : s.vendor?.toString();
    return (
      (s.vendorName && s.vendorName.toLowerCase() === vendorNeedle.toLowerCase()) ||
      vId === vendorNeedle
    );
  });

  if (!shipment && !insert) {
    console.error(`\nNo shipment matching "${vendorNeedle}" in this order. Pass --insert to create one from the vendor's items.`);
    process.exit(1);
  }

  if (shipment) {
    console.log(`\nTargeting shipment for "${shipment.vendorName}":`);
    console.log(`   current deliveryMode: ${shipment.deliveryMode || '(none)'}`);
    console.log(`   current status:       ${shipment.status}`);

    if (!apply) {
      console.log(`\n(dry run — pass --mode <X> --apply to patch)`);
      await mongoose.disconnect();
      return;
    }

    shipment.deliveryMode = mode;
    await order.save();

    console.log(`\nApplied: deliveryMode="${mode}" on ${shipment.vendorName}'s shipment.`);
    await mongoose.disconnect();
    return;
  }

  // Insert path — build a fresh shipment entry from vendor profile + order items.
  const vendorProfile: any = await VendorProfile.findOne({
    $or: [
      { businessName: new RegExp(`^${vendorNeedle}$`, 'i') },
      ...(mongoose.isValidObjectId(vendorNeedle) ? [{ user: vendorNeedle as any }] : []),
    ],
  }).lean();
  if (!vendorProfile) {
    console.error(`\nVendor profile for "${vendorNeedle}" not found; cannot insert.`);
    process.exit(1);
  }

  const vendorUserId = vendorProfile.user?.toString();
  const vendorItems = (order.items || []).filter((it: any) => {
    const vid = typeof it.vendor === 'object' ? it.vendor?._id?.toString() : it.vendor?.toString();
    return vid === vendorUserId;
  });

  if (vendorItems.length === 0) {
    console.error(`\n"${vendorProfile.businessName}" has no items in this order; cannot insert.`);
    process.exit(1);
  }

  if (!apply) {
    console.log(`\n(dry run — would insert a ${mode || '???'} shipment for ${vendorProfile.businessName} with ${vendorItems.length} item(s). Pass --mode <X> --apply --insert to create it.)`);
    await mongoose.disconnect();
    return;
  }

  const pickup = vendorProfile.pickupAddress || {};
  const business = vendorProfile.businessAddress || {};
  const newShipment: any = {
    vendor: vendorUserId,
    vendorName: vendorProfile.businessName,
    items: vendorItems.map((it: any) => it.product?.toString()),
    origin: {
      street: business.street || '',
      city: business.city,
      state: business.state,
      country: business.country || 'Nigeria',
    },
    shippingCost: 0,
    courier: mode === 'PICKUP' ? 'Pickup' : mode === 'SELF_DELIVERY' ? 'Vendor delivery' : 'Standard Courier',
    requestedCourier: mode === 'PICKUP' ? 'Pickup' : mode === 'SELF_DELIVERY' ? 'Vendor delivery' : 'Standard Courier',
    status: mode === 'VENDORSPOT_DELIVERY' ? 'pending' : 'confirmed',
    deliveryMode: mode,
  };
  if (mode === 'PICKUP' && pickup?.street && pickup.status === 'APPROVED') {
    newShipment.pickupAddress = {
      street: pickup.street,
      city: pickup.city,
      state: pickup.state,
      country: pickup.country || 'Nigeria',
      landmark: pickup.landmark,
      instructions: pickup.instructions,
    };
  }

  (order.vendorShipments as any) = (order.vendorShipments as any) || [];
  (order.vendorShipments as any).push(newShipment);
  await order.save();

  console.log(`\nInserted ${mode} shipment for ${vendorProfile.businessName}.`);
  console.log(`  items:     ${vendorItems.length}`);
  console.log(`  status:    ${newShipment.status}`);
  if (newShipment.pickupAddress) {
    console.log(`  pickup:    ${[newShipment.pickupAddress.street, newShipment.pickupAddress.city, newShipment.pickupAddress.state].filter(Boolean).join(', ')}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Script failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
