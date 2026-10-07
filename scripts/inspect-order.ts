/**
 * Print product / protection / shipping breakdown for an order.
 * Read-only.
 *
 *   npx ts-node scripts/inspect-order.ts --order VS220739837911
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Order from '../src/models/Order';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vendorspot';

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--order');
  const orderNumber = idx >= 0 ? args[idx + 1] : undefined;
  if (!orderNumber) {
    console.error('❌ Missing --order <orderNumber>');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  const order: any = await Order.findOne({ orderNumber }).lean();
  if (!order) {
    console.error(`❌ Order ${orderNumber} not found`);
    process.exit(1);
  }

  const productAmount = (order.items || []).reduce((sum: number, item: any) => {
    return sum + (Number(item.price) || 0) * (Number(item.quantity) || 0);
  }, 0);
  const protectionFee = Number(order.serviceCharge ?? order.buyerProtectionFee ?? 0);
  const shippingCost = Number(order.totalShippingCost ?? order.shippingCost ?? order.deliveryFee ?? 0);
  const totalPaid = Number(order.totalAmount ?? order.total ?? 0);

  console.log(`\n📦 Order ${order.orderNumber}\n`);
  console.log(`   Product amount   : ₦${productAmount.toLocaleString()}`);
  console.log(`   Protection fee   : ₦${protectionFee.toLocaleString()}`);
  console.log(`   Shipping cost    : ₦${shippingCost.toLocaleString()}`);
  console.log(`   ─────────────────────────────`);
  console.log(`   Sum of the above : ₦${(productAmount + protectionFee + shippingCost).toLocaleString()}`);
  console.log(`   Order totalAmount: ₦${totalPaid.toLocaleString()}`);

  const diff = totalPaid - (productAmount + protectionFee + shippingCost);
  if (Math.abs(diff) > 1) {
    console.log(`\n   ⚠️  Discrepancy of ₦${diff.toLocaleString()} — likely VCredits/discount. Dumping every money field:`);
    for (const [k, v] of Object.entries(order)) {
      if (typeof v === 'number' && k !== 'quantity' && k !== '__v') {
        console.log(`      ${k.padEnd(28)}= ₦${(v as number).toLocaleString()}`);
      }
    }
  }
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
