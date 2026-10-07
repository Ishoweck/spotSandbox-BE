/**
 * Force-complete an order on behalf of a customer who has confirmed
 * receipt out-of-band (phone call, WhatsApp) but can't tap the
 * "Confirm Receipt" button (client offline, deploy broken, etc.).
 *
 * Mirrors the completeOrder controller: sets status=DELIVERED,
 * fundsReleased=true, deliveredAt=now, credits each vendor's wallet at
 * their tiered commission rate, deducts any affiliate share, and awards
 * customer + referral + vendor-first-sale points. Safe to re-run —
 * atomic fundsReleased guard prevents double payout.
 *
 * Dry-run:
 *   npx ts-node scripts/complete-order.ts --order VS220739837911
 *
 * Actually release funds:
 *   npx ts-node scripts/complete-order.ts --order VS220739837911 --commit
 *
 * With an audit note stashed on the order:
 *   npx ts-node scripts/complete-order.ts --order VS220739837911 \
 *     --note "Customer confirmed receipt by phone — client couldn't reach backend" \
 *     --commit
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Order from '../src/models/Order';
import User from '../src/models/User';
import VendorProfile from '../src/models/VendorProfile';
import Product from '../src/models/Product';
import { Wallet, AffiliateLink } from '../src/models/Additional';
import { OrderStatus, PaymentStatus, TransactionType, WalletPurpose } from '../src/types';
import { notificationService } from '../src/services/notification.service';
import { rewardController } from '../src/controllers/reward.controller';

void Product;
void User;
void VendorProfile;
void AffiliateLink;

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
    note: get('note'),
    commit: has('commit'),
  };
}

async function getCommissionRate(vendorId: string): Promise<number> {
  const profile = await VendorProfile.findOne({ user: vendorId }).select('isPremium commissionRate');
  if (!profile) return 8;
  if (profile.isPremium) return 5;
  const rate = profile.commissionRate ?? 8;
  return rate === 5 ? 8 : rate;
}

async function main() {
  const { order: orderNumber, note, commit } = parseArgs();
  if (!orderNumber) {
    console.error('❌ Missing --order <orderNumber>');
    process.exit(1);
  }
  if (!commit) {
    console.warn('⚠️  DRY-RUN MODE. Nothing will be written. Add --commit to release funds.\n');
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to Mongo\n');

  const order = await Order.findOne({ orderNumber }).populate('items.vendor', 'firstName lastName');
  if (!order) {
    console.error(`❌ Order ${orderNumber} not found`);
    process.exit(1);
  }

  console.log(`📦 Order ${order.orderNumber}`);
  console.log(`   Buyer         : ${order.user}`);
  console.log(`   Status        : ${order.status}`);
  console.log(`   Payment       : ${order.paymentStatus}`);
  console.log(`   Total         : ₦${((order as any).totalAmount || (order as any).total || 0).toLocaleString()}`);
  console.log(`   fundsReleased : ${(order as any).fundsReleased}`);
  console.log(`   Items         : ${order.items.length}`);

  // Guards mirror the controller
  if (order.paymentStatus !== PaymentStatus.COMPLETED) {
    console.error(`❌ Payment status is "${order.paymentStatus}" — must be "completed" to release funds`);
    process.exit(1);
  }
  if ((order as any).fundsReleased === true) {
    console.log('\n✅ Funds already released — nothing to do.');
    process.exit(0);
  }

  // Build vendor earnings map
  const vendorEarnings = new Map<string, number>();
  for (const item of order.items) {
    const rawVendor: any = (item as any).vendor;
    const vId = typeof rawVendor === 'object' && rawVendor
      ? rawVendor._id?.toString()
      : rawVendor?.toString();
    if (!vId) continue;
    const itemTotal = item.price * item.quantity;
    vendorEarnings.set(vId, (vendorEarnings.get(vId) || 0) + itemTotal);
  }

  // Affiliate deduction map
  const affiliateVendorDeductions = new Map<string, number>();
  if ((order as any).affiliateUser && (order as any).affiliateCommission && (order as any).affiliateLinkId) {
    try {
      const linkDoc = await AffiliateLink.findById((order as any).affiliateLinkId).select('product').lean() as any;
      if (linkDoc?.product) {
        const affItem = order.items.find((item: any) => item.product?.toString() === linkDoc.product.toString());
        if (affItem) {
          const vId = typeof (affItem as any).vendor === 'object'
            ? (affItem as any).vendor._id?.toString()
            : (affItem as any).vendor?.toString();
          if (vId) affiliateVendorDeductions.set(vId, (order as any).affiliateCommission);
        }
      } else {
        const totalSubtotal = [...vendorEarnings.values()].reduce((s, v) => s + v, 0);
        for (const [vid, sub] of vendorEarnings) {
          const deduction = Math.round((sub / totalSubtotal) * (order as any).affiliateCommission * 100) / 100;
          if (deduction > 0) affiliateVendorDeductions.set(vid, deduction);
        }
      }
    } catch (e) {
      console.warn('⚠️  Failed to compute affiliate vendor deductions:', e);
    }
  }

  // Plan every payout row so the dry-run shows exactly what will happen
  console.log('\n📊 Planned payouts:');
  const payoutRows: Array<{ vendorId: string; subtotal: number; commission: number; commissionPct: number; affiliateDeduction: number; net: number }> = [];
  for (const [vendorId, subtotal] of vendorEarnings) {
    const commissionPct = await getCommissionRate(vendorId);
    const commission = Math.round(subtotal * (commissionPct / 100) * 100) / 100;
    const affiliateDeduction = affiliateVendorDeductions.get(vendorId) || 0;
    const net = Math.max(0, Math.round((subtotal - commission - affiliateDeduction) * 100) / 100);
    payoutRows.push({ vendorId, subtotal, commission, commissionPct, affiliateDeduction, net });
    console.log(`   vendor ${vendorId}: subtotal ₦${subtotal.toLocaleString()} − ${commissionPct}% commission ₦${commission.toLocaleString()}${affiliateDeduction > 0 ? ` − affiliate ₦${affiliateDeduction.toLocaleString()}` : ''} = ₦${net.toLocaleString()}`);
  }
  if ((order as any).affiliateUser && (order as any).affiliateCommission) {
    console.log(`   affiliate ${(order as any).affiliateUser}: +₦${(order as any).affiliateCommission.toLocaleString()}`);
  }

  if (!commit) {
    console.log('\n⚠️  DRY-RUN: nothing written. Re-run with --commit to release funds.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Atomic claim — mirrors the controller so we can't race with the 24h autocomplete
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      fundsReleased: { $ne: true },
      paymentStatus: PaymentStatus.COMPLETED,
    },
    {
      $set: {
        status: OrderStatus.DELIVERED,
        fundsReleased: true,
        deliveredAt: new Date(),
        ...(note ? { adminNote: `${(order as any).adminNote ? (order as any).adminNote + '\n' : ''}[support-complete ${new Date().toISOString()}] ${note}` } : {}),
      },
    },
    { new: true }
  );
  if (!claimed) {
    console.log('⚠️  Funds were already released by another process — nothing to do.');
    await mongoose.disconnect();
    process.exit(0);
  }
  console.log('\n✅ Status set to DELIVERED, fundsReleased=true');

  // Credit vendor wallets
  for (const row of payoutRows) {
    await Wallet.findOneAndUpdate(
      { user: row.vendorId },
      {
        $inc: { balance: row.net, totalEarned: row.net },
        $push: {
          transactions: {
            type: TransactionType.CREDIT,
            amount: row.net,
            purpose: WalletPurpose.COMMISSION,
            reference: `order_${order.orderNumber}_${row.vendorId}`,
            description: `Payment for Order #${order.orderNumber} (${row.commissionPct}% platform fee${row.affiliateDeduction > 0 ? `, ₦${row.affiliateDeduction} affiliate commission` : ''} deducted) — released by support`,
            relatedOrder: order._id,
            status: 'completed',
            timestamp: new Date(),
          },
        },
      },
      { upsert: true }
    );
    console.log(`✅ Credited ₦${row.net.toLocaleString()} to vendor ${row.vendorId}`);
    notificationService.vendorSaleCompleted(row.vendorId, order.orderNumber, row.subtotal, row.net).catch(() => {});
  }

  // Affiliate commission — atomic guard
  if ((order as any).affiliateUser && (order as any).affiliateCommission) {
    const affClaimed = await Order.findOneAndUpdate(
      { _id: order._id, affiliateCommissionPaid: { $ne: true } },
      { $set: { affiliateCommissionPaid: true } }
    );
    if (affClaimed) {
      const commissionAmount = (order as any).affiliateCommission;
      await Wallet.findOneAndUpdate(
        { user: (order as any).affiliateUser },
        {
          $inc: { balance: commissionAmount, totalEarned: commissionAmount },
          $push: {
            transactions: {
              type: TransactionType.CREDIT,
              amount: commissionAmount,
              purpose: WalletPurpose.COMMISSION,
              reference: `affiliate_${order.orderNumber}`,
              description: `Affiliate commission for Order #${order.orderNumber} — released by support`,
              relatedOrder: order._id,
              status: 'completed',
              timestamp: new Date(),
            },
          },
        },
        { upsert: true }
      );
      if ((order as any).affiliateLinkId) {
        await AffiliateLink.findByIdAndUpdate((order as any).affiliateLinkId, {
          $inc: { conversions: 1, totalEarned: commissionAmount },
        });
      }
      console.log(`✅ Credited ₦${commissionAmount.toLocaleString()} affiliate commission`);
    }
  }

  // Reward points
  try {
    await rewardController.awardOrderPoints((order as any)._id.toString());
    await rewardController.awardCustomerReferralPoints(order.user.toString(), (order as any)._id.toString());
    console.log('✅ Purchase + referral points awarded');

    const uniqueVendorIds = [...new Set(order.items.map((item: any) => {
      const v = item.vendor;
      return typeof v === 'object' ? v._id?.toString() : v?.toString();
    }).filter(Boolean))] as string[];
    for (const vendorId of uniqueVendorIds) {
      const claimedV = await VendorProfile.findOneAndUpdate(
        { user: vendorId, referredBy: { $exists: true }, referralRewarded: { $ne: true } },
        { $set: { referralRewarded: true } }
      );
      if (claimedV) {
        await rewardController.unlockVendorReferralPoints(vendorId);
        console.log(`✅ Vendor referral unlocked for ${vendorId}`);
      }
      import('../src/controllers/ambassador.controller').then(({ handleVendorFirstSale }) => {
        handleVendorFirstSale(vendorId);
      }).catch(() => {});
    }
  } catch (err: any) {
    console.warn(`⚠️  Points award failed: ${err?.message}`);
  }

  console.log(`\n🎉 Order ${order.orderNumber} completed. Buyer confirmation was recorded${note ? ` (note: "${note}")` : ''}.`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
