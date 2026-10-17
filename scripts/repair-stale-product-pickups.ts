/**
 * Re-point a vendor's products whose pickupAddress snapshot no longer matches
 * any of their saved addresses (the address was edited or deleted before
 * address.controller started resyncing product snapshots). Stale products are
 * moved to the vendor's default saved address.
 *
 * Dry-run (prints state only):
 *   npx ts-node scripts/repair-stale-product-pickups.ts --vendor seyiscents
 *
 * Apply:
 *   npx ts-node scripts/repair-stale-product-pickups.ts --vendor seyiscents --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../src/models/Product';
import User from '../src/models/User';
import VendorProfile from '../src/models/VendorProfile';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vendorspot';

function arg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const sameLocation = (a: any, b: any) =>
  (a?.street || '') === (b?.street || '') &&
  (a?.city || '') === (b?.city || '') &&
  (a?.state || '') === (b?.state || '');

async function main() {
  const vendorNeedle = arg('vendor');
  const apply = process.argv.includes('--apply');

  if (!vendorNeedle) {
    console.error('Usage: --vendor <slug, businessName or user id> [--apply]');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);

  const profile: any = mongoose.Types.ObjectId.isValid(vendorNeedle)
    ? await VendorProfile.findOne({ user: vendorNeedle })
    : await VendorProfile.findOne({
        $or: [{ slug: vendorNeedle }, { businessName: new RegExp(`^${vendorNeedle}$`, 'i') }],
      });
  if (!profile) {
    console.error(`Vendor ${vendorNeedle} not found`);
    process.exit(1);
  }

  const user: any = await User.findById(profile.user).select('addresses');
  const addresses: any[] = user?.addresses || [];
  const target = addresses.find((a) => a.isDefault) || addresses[0];

  console.log(`\nVendor ${profile.businessName} (user=${profile.user})`);
  console.log('Saved addresses:');
  for (const a of addresses) {
    console.log(`  - ${a._id}  ${a.street}, ${a.city}, ${a.state}  code=${a.shipBubble?.addressCode ?? '-'}${a.isDefault ? '  [default]' : ''}`);
  }
  if (!target) {
    console.error('Vendor has no saved addresses; nothing to re-point to.');
    process.exit(1);
  }

  const products: any[] = await Product.find({ vendor: profile.user, 'pickupAddress.street': { $exists: true } })
    .select('name pickupAddress');

  const stale = products.filter((p) => {
    const pa = p.pickupAddress;
    if (pa.addressId) return !addresses.some((a) => a._id.equals(pa.addressId));
    return !addresses.some((a) => sameLocation(a, pa));
  });

  console.log(`\n${stale.length} of ${products.length} product(s) point at an address that is no longer saved:`);
  for (const p of stale) {
    console.log(`  - ${p.name}  ->  ${p.pickupAddress.street}, ${p.pickupAddress.city}`);
  }
  console.log(`\nTarget: ${target.street}, ${target.city}, ${target.state}  code=${target.shipBubble?.addressCode ?? '-'}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to update.');
    await mongoose.disconnect();
    return;
  }

  if (stale.length > 0) {
    const result = await Product.updateMany(
      { _id: { $in: stale.map((p) => p._id) } },
      {
        $set: {
          pickupAddress: {
            addressId: target._id,
            street: target.street,
            city: target.city,
            state: target.state,
            country: target.country || 'Nigeria',
            fullName: target.fullName || '',
            phone: target.phone || '',
            shipBubble: target.shipBubble,
          },
        },
      },
    );
    console.log(`\nUpdated ${result.modifiedCount} product(s).`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
