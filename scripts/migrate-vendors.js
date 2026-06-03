// scripts/migrate-vendors.js
// Migrates all Vendor + Customer users from old DB into new DB as vendors.
// Does NOT create VendorProfiles. Uses raw collection insert to bypass bcrypt pre-save hook.

const mongoose = require('mongoose');

const SOURCE_URI =
  'mongodb+srv://dave:Luv2laf1@vendorspot-production.pn1re.mongodb.net/VendorSpot-Production?retryWrites=true&w=majority&appName=VendorSpot-Production';

const TARGET_URI =
  'mongodb+srv://admin:O0Xmg3P2W3Ih2X5N@cluster0.vboavsv.mongodb.net/test?appName=Cluster0';

const BATCH_SIZE = 100;

async function migrate() {
  console.log('🔌 Connecting to source and target databases...');
  const sourceConn = await mongoose.createConnection(SOURCE_URI).asPromise();
  const targetConn = await mongoose.createConnection(TARGET_URI).asPromise();
  console.log('✅ Connected to both databases\n');

  const srcUsers    = sourceConn.db.collection('users');
  const srcShops    = sourceConn.db.collection('shop');
  const srcSettings = sourceConn.db.collection('ShopSettings');
  const tgtUsers    = targetConn.db.collection('users');

  // ── 1. Build phone lookup: source userId → phone number ──────────────────
  console.log('📞 Building phone lookup from ShopSettings...');
  const allShops    = await srcShops.find({}, { projection: { _id: 1, userId: 1 } }).toArray();
  const allSettings = await srcSettings.find({}, { projection: { shopId: 1, phoneNumber: 1 } }).toArray();

  const phoneByShopId = new Map();
  for (const s of allSettings) {
    if (s.phoneNumber) phoneByShopId.set(s.shopId?.toString(), s.phoneNumber.toString().trim());
  }

  const phoneByUserId = new Map();
  for (const shop of allShops) {
    const phone = phoneByShopId.get(shop._id.toString());
    if (phone && shop.userId) phoneByUserId.set(shop.userId.toString(), phone);
  }
  console.log(`   ${phoneByUserId.size} phone numbers found\n`);

  // ── 2. Fetch existing emails in target (skip duplicates) ─────────────────
  console.log('📋 Fetching existing emails in target DB...');
  const existingDocs  = await tgtUsers.find({}, { projection: { email: 1 } }).toArray();
  const existingEmails = new Set(existingDocs.map(u => u.email?.toLowerCase().trim()).filter(Boolean));
  console.log(`   ${existingEmails.size} emails already in target\n`);

  // ── 3. Fetch source users (Vendor + Customer only) ───────────────────────
  console.log('👥 Fetching source users...');
  const sourceUserDocs = await srcUsers
    .find({ role: { $in: ['Vendor', 'Customer'] } })
    .toArray();
  console.log(`   ${sourceUserDocs.length} users found in source\n`);

  // ── 4. Build insert batch ─────────────────────────────────────────────────
  const now = new Date();
  const toInsert = [];
  let skippedEmail = 0;
  let skippedOther = 0;

  for (const user of sourceUserDocs) {
    const email = user.email?.toLowerCase().trim();

    if (!email || !user.password) {
      skippedOther++;
      continue;
    }

    if (existingEmails.has(email)) {
      skippedEmail++;
      continue;
    }

    const emailVerified = !!(
      user.emailVerified instanceof Date ||
      (typeof user.emailVerified === 'string' && user.emailVerified)
    );

    const status = user.verificationStatus === 'Complete' ? 'active' : 'pending_verification';
    const phone  = phoneByUserId.get(user._id.toString());

    const doc = {
      _id:          user._id,
      firstName:    (user.firstname  || '').trim(),
      lastName:     (user.lastname   || '').trim(),
      email,
      password:     user.password,        // bcrypt hash — copied as-is
      role:         'vendor',
      status,
      emailVerified,
      phoneVerified: false,
      points:        0,
      badges:        [],
      achievements:  [],
      fcmTokens:     [],
      isAffiliate:   false,
      addresses:     [],
      loginStreak: {
        currentStreak:  0,
        lastLoginDate:  null,
      },
      notificationPreferences: {
        pushEnabled: true,
        order:  [],
        promo:  [],
        social: [],
      },
      createdAt: user.createdAt || now,
      updatedAt: user.updatedAt || now,
    };

    if (phone) doc.phone = phone;

    toInsert.push(doc);
    existingEmails.add(email); // guard against duplicates within the same source batch
  }

  console.log('📊 Pre-migration summary:');
  console.log(`   To insert:              ${toInsert.length}`);
  console.log(`   Skipped (email exists): ${skippedEmail}`);
  console.log(`   Skipped (no email/pwd): ${skippedOther}\n`);

  if (toInsert.length === 0) {
    console.log('⚠️  Nothing to insert. Exiting.');
    await sourceConn.close();
    await targetConn.close();
    return;
  }

  // ── 5. Insert in batches ──────────────────────────────────────────────────
  console.log(`🚀 Inserting ${toInsert.length} users in batches of ${BATCH_SIZE}...`);
  let totalInserted = 0;
  let totalErrors   = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch     = toInsert.slice(i, i + BATCH_SIZE);
    const batchNum  = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toInsert.length / BATCH_SIZE);

    try {
      const result = await tgtUsers.insertMany(batch, { ordered: false });
      totalInserted += result.insertedCount;
      console.log(`   Batch ${batchNum}/${totalBatches}: ✅ ${result.insertedCount} inserted`);
    } catch (err) {
      if (err.writeErrors) {
        const ok = batch.length - err.writeErrors.length;
        totalInserted += ok;
        totalErrors   += err.writeErrors.length;
        console.warn(`   Batch ${batchNum}/${totalBatches}: ⚠️  ${ok} inserted, ${err.writeErrors.length} duplicates skipped`);
      } else {
        console.error(`   Batch ${batchNum}/${totalBatches}: ❌ Fatal error:`, err.message);
        throw err;
      }
    }
  }

  // ── 6. Final report ───────────────────────────────────────────────────────
  console.log('\n🎉 ═══════════════════════════════════');
  console.log('   MIGRATION COMPLETE');
  console.log('═══════════════════════════════════');
  console.log(`   Inserted:               ${totalInserted}`);
  console.log(`   Skipped (email exists): ${skippedEmail}`);
  console.log(`   Skipped (no email/pwd): ${skippedOther}`);
  console.log(`   Errors (dup _id):       ${totalErrors}`);
  console.log('═══════════════════════════════════\n');

  // ── 7. Verify ─────────────────────────────────────────────────────────────
  const finalCount = await tgtUsers.countDocuments();
  console.log(`✅ Target DB now has ${finalCount} users total`);

  await sourceConn.close();
  await targetConn.close();
}

migrate().catch(err => {
  console.error('💥 FATAL:', err.message);
  process.exit(1);
});
