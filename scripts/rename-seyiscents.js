// One-off: rename vendor "Seyiscents" → "Seyi's Scents" (display name only, slug preserved).
// Run once with: node scripts/rename-seyiscents.js
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');

  console.log('🔌 Connecting...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  console.log('✅ Connected\n');

  const VendorProfile = mongoose.connection.collection('vendorprofiles');

  const before = await VendorProfile.findOne(
    { user: new mongoose.Types.ObjectId('67e44f58cf7ee02f91ead283') },
    { projection: { businessName: 1, slug: 1 } },
  );

  if (!before) {
    console.log('❌ Vendor not found');
    process.exit(1);
  }

  console.log(`BEFORE: businessName="${before.businessName}", slug="${before.slug}"`);

  const result = await VendorProfile.updateOne(
    { user: new mongoose.Types.ObjectId('67e44f58cf7ee02f91ead283') },
    { $set: { businessName: "Seyi's Scents" } }, // slug intentionally NOT changed
  );

  console.log(`\n✅ Updated ${result.modifiedCount} document(s)`);

  const after = await VendorProfile.findOne(
    { user: new mongoose.Types.ObjectId('67e44f58cf7ee02f91ead283') },
    { projection: { businessName: 1, slug: 1 } },
  );
  console.log(`AFTER:  businessName="${after.businessName}", slug="${after.slug}"`);

  await mongoose.disconnect();
  console.log('\n🔌 Disconnected');
}

run().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
