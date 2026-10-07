// Seed a verified vendor with a VENDORSPOT_DELIVERY product so VSL_FORCE can
// be tested end-to-end: shop as customer, pay, log in as vendor, mark the
// order as processing, watch VSL book the shipment.
//
// Idempotent — safe to run repeatedly. If the user/profile/product already
// exist (by email/slug/sku), they're reused and the credentials are reprinted.
//
// Run: `node -r ts-node/register scripts/seed-vsl-vendor.ts`
// Or with dotenv:  `node -r dotenv/config -r ts-node/register scripts/seed-vsl-vendor.ts`

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../src/models/User';
import VendorProfile from '../src/models/VendorProfile';
import Product from '../src/models/Product';
import { UserRole, UserStatus, VendorVerificationStatus, ProductType, ProductStatus } from '../src/types';

const EMAIL = 'vsl-test-vendor@test.local';
const PASSWORD = 'VslTest1234!';
const PRODUCT_SKU = 'VSL-TEST-PRODUCT-001';
const PRODUCT_SLUG = 'vsl-test-wall-clock';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri);
  console.log(`✓ Connected to ${mongoose.connection.name}@${mongoose.connection.host}`);

  // ─── 1) User ─────────────────────────────────────────────────────────────
  let user = await User.findOne({ email: EMAIL });
  if (user) {
    console.log(`= User already exists: ${user._id} (${user.email})`);
    // Force-reset the password + verify flags so the login always works.
    user.password = PASSWORD; // pre-save hook will hash
    user.status = UserStatus.ACTIVE;
    user.emailVerified = true;
    user.role = UserRole.VENDOR;
    await user.save();
    console.log('  → password reset + status/role/verified refreshed');
  } else {
    user = await User.create({
      firstName: 'VSL',
      lastName: 'TestVendor',
      email: EMAIL,
      phone: '+2348011110001',
      password: PASSWORD,
      role: UserRole.VENDOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    console.log(`✓ Created user ${user._id} (${user.email})`);
  }

  // ─── 2) VendorProfile ────────────────────────────────────────────────────
  let profile = await VendorProfile.findOne({ user: user._id });
  if (profile) {
    console.log(`= Profile already exists: ${profile._id}`);
    profile.verificationStatus = VendorVerificationStatus.VERIFIED;
    profile.isActive = true;
    profile.deliveryModes = ['VENDORSPOT_DELIVERY'];
    profile.businessAddress = {
      street: '12 Admiralty Way',
      city: 'Lekki',
      state: 'Lagos',
      country: 'Nigeria',
    } as any;
    profile.businessPhone = '+2348011110001';
    profile.businessEmail = EMAIL;
    await profile.save();
    console.log('  → profile refreshed (verified, VENDORSPOT_DELIVERY, Lagos address)');
  } else {
    profile = await VendorProfile.create({
      user: user._id,
      businessName: 'VSL Test Shop',
      slug: 'vsl-test-shop',
      businessDescription: 'Temporary vendor used for end-to-end VSL_FORCE testing.',
      businessAddress: {
        street: '12 Admiralty Way',
        city: 'Lekki',
        state: 'Lagos',
        country: 'Nigeria',
      },
      businessPhone: '+2348011110001',
      businessEmail: EMAIL,
      verificationStatus: VendorVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      isActive: true,
      deliveryModes: ['VENDORSPOT_DELIVERY'],
    });
    console.log(`✓ Created vendor profile ${profile._id} (${profile.businessName})`);
  }

  // ─── 3) Category (reuse any existing) ────────────────────────────────────
  const Category = mongoose.model('Category', new mongoose.Schema({}, { strict: false }));
  let category = await Category.findOne({});
  if (!category) {
    category = await Category.create({
      name: 'Test Category',
      slug: 'test-category',
      isActive: true,
    });
    console.log(`✓ Created category ${category._id} (none existed)`);
  } else {
    console.log(`= Using existing category ${category._id} (${(category as any).name})`);
  }

  // ─── 4) Product ──────────────────────────────────────────────────────────
  let product = await Product.findOne({ sku: PRODUCT_SKU });
  if (product) {
    console.log(`= Product already exists: ${product._id} (${product.name})`);
    product.vendor = user._id as any;
    product.status = ProductStatus.ACTIVE;
    product.quantity = 100;
    await product.save();
    console.log('  → product refreshed (ACTIVE, qty=100, vendor refreshed)');
  } else {
    product = await Product.create({
      name: 'VSL Test Wall Clock',
      slug: PRODUCT_SLUG,
      description: 'Dummy product for end-to-end VSL_FORCE testing. Not real stock.',
      shortDescription: 'VSL test product',
      vendor: user._id,
      category: category._id,
      productType: ProductType.PHYSICAL,
      price: 12000,
      sku: PRODUCT_SKU,
      quantity: 100,
      weight: 0.8, // kg — gives the quote a non-trivial weight to work with
      images: ['https://via.placeholder.com/400x400.png?text=VSL+Test'],
      status: ProductStatus.ACTIVE,
      tags: ['test', 'vsl'],
    });
    console.log(`✓ Created product ${product._id} (${product.name})`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ VSL TEST VENDOR READY');
  console.log('═'.repeat(60));
  console.log('  Login email   :', EMAIL);
  console.log('  Password      :', PASSWORD);
  console.log('  Role          : vendor');
  console.log('  Business name :', profile.businessName);
  console.log('  Vendor status : verified / active');
  console.log('  Delivery mode : VENDORSPOT_DELIVERY (triggers VSL path)');
  console.log('  Address       : 12 Admiralty Way, Lekki, Lagos');
  console.log('  Product       :', product.name, '— ₦' + product.price);
  console.log('  Product qty   :', product.quantity);
  console.log('  Product slug  :', product.slug);
  console.log('═'.repeat(60));
  console.log('\nTest flow:');
  console.log('  1) Log in as a CUSTOMER, find "VSL Test Shop" or product "VSL Test Wall Clock"');
  console.log('  2) Add to cart → checkout → pay (sandbox Paystack)');
  console.log('  3) Log out, log in as the vendor above');
  console.log('  4) Open the vendor dashboard, find the pending order, mark it as processing');
  console.log('  5) Shipment appears in VSL admin at http://localhost:4001/shipments');
  console.log('  6) Simulate Event → in_transit → delivered');
  console.log('  7) Reload the order in parent — vendorShipments[0].vslStatus walks the same path');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
