/**
 * Quick audit of vendor delivery-mode adoption.
 * Run: npx ts-node scripts/audit-delivery-modes.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import VendorProfile from '../src/models/VendorProfile';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vendorspot';

async function main() {
  await mongoose.connect(MONGO_URI);
  const total = await VendorProfile.countDocuments({});

  const hasAnyPricing = await VendorProfile.countDocuments({ 'selfDeliveryPricing.0': { $exists: true } });
  const hasLegacyFee = await VendorProfile.countDocuments({ selfDeliveryFee: { $gt: 0 } });
  const hasLegacyStates = await VendorProfile.countDocuments({ 'selfDeliveryStates.0': { $exists: true } });
  const selfAccepted = await VendorProfile.countDocuments({ selfDeliveryAcceptedAt: { $exists: true, $ne: null } });
  const pickupAccepted = await VendorProfile.countDocuments({ pickupAcceptedAt: { $exists: true, $ne: null } });
  const hasPickupAddr = await VendorProfile.countDocuments({ 'pickupAddress.street': { $exists: true, $ne: '' } });
  const deliveryModesSet = await VendorProfile.countDocuments({ 'deliveryModes.0': { $exists: true } });
  const deliveryModesUnset = await VendorProfile.countDocuments({
    $or: [{ deliveryModes: { $exists: false } }, { deliveryModes: { $size: 0 } }],
  });

  console.log(`\nTotal vendor profiles: ${total}`);
  console.log(`\n--- deliveryModes field ---`);
  console.log(`  with at least 1 entry : ${deliveryModesSet}`);
  console.log(`  missing / empty       : ${deliveryModesUnset}  (falls back to VENDORSPOT_DELIVERY at read time)`);

  console.log(`\n--- Self-delivery adoption signals ---`);
  console.log(`  selfDeliveryPricing populated : ${hasAnyPricing}`);
  console.log(`  legacy selfDeliveryFee > 0    : ${hasLegacyFee}`);
  console.log(`  legacy selfDeliveryStates     : ${hasLegacyStates}`);
  console.log(`  selfDeliveryAcceptedAt stamp  : ${selfAccepted}`);

  console.log(`\n--- Pickup adoption signals ---`);
  console.log(`  pickupAcceptedAt stamp : ${pickupAccepted}`);
  console.log(`  pickupAddress.street   : ${hasPickupAddr}`);

  if (selfAccepted > 0) {
    console.log(`\nVendors who accepted self-delivery T&C:`);
    const rows = await VendorProfile.find({ selfDeliveryAcceptedAt: { $exists: true, $ne: null } })
      .select('businessName user deliveryModes selfDeliveryPricing selfDeliveryFee selfDeliveryStates selfDeliveryAcceptedAt')
      .limit(20).lean();
    for (const v of rows as any[]) {
      console.log(`  - ${v.businessName || '(no name)'}  modes=${JSON.stringify(v.deliveryModes || [])}  pricingRows=${(v.selfDeliveryPricing || []).length}  legacyFee=${v.selfDeliveryFee || 0}  legacyStates=${(v.selfDeliveryStates || []).length}`);
    }
  }

  if (pickupAccepted > 0) {
    console.log(`\nVendors who accepted pickup T&C:`);
    const rows = await VendorProfile.find({ pickupAcceptedAt: { $exists: true, $ne: null } })
      .select('businessName user deliveryModes pickupAddress')
      .limit(20).lean();
    for (const v of rows as any[]) {
      console.log(`  - ${v.businessName || '(no name)'}  modes=${JSON.stringify(v.deliveryModes || [])}  status=${v.pickupAddress?.status || 'n/a'}  city=${v.pickupAddress?.city || 'n/a'}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
