import Order from '../models/Order';
import Wallet from '../models/Wallet';
import VendorProfile from '../models/VendorProfile';
import { logger } from './logger';
import { OrderStatus, PaymentStatus, TransactionType, WalletPurpose } from '../types';
import { notificationService } from '../services/notification.service';
import { rewardController } from '../controllers/reward.controller';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

async function getCommissionRate(vendorId: string): Promise<number> {
  const profile = await VendorProfile.findOne({ user: vendorId }).select('isPremium commissionRate');
  if (!profile) return 8;
  if (profile.isPremium) return 5;
  const rate = profile.commissionRate ?? 8;
  return rate === 5 ? 8 : rate;
}

async function runAutoComplete(): Promise<void> {
  const twentyFourHoursAgo = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);

  const orders = await Order.find({
    status: OrderStatus.DELIVERED,
    paymentStatus: PaymentStatus.COMPLETED,
    fundsReleased: { $ne: true },
    deliveredAt: { $lte: twentyFourHoursAgo },
  });

  if (orders.length === 0) return;

  logger.info(`⏰ Auto-complete: releasing funds for ${orders.length} order(s)`);

  for (const order of orders) {
    try {
      // Atomic claim — prevents race with completeOrder (customer-triggered confirm delivery).
      // Only the first process to set fundsReleased=true proceeds; the other skips safely.
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, fundsReleased: { $ne: true } },
        { fundsReleased: true },
      );
      if (!claimed) {
        logger.info(`⚠️ Auto-complete: order ${order.orderNumber} already claimed — skipping`);
        continue;
      }

      const vendorShipments = (order as any).vendorShipments as any[] | undefined;

      if (vendorShipments && vendorShipments.length > 0) {
        // Multi-vendor: credit each vendor that hasn't been paid yet
        for (const shipment of vendorShipments) {
          if (shipment.paidAt || shipment.status === 'cancelled') continue;

          const vendorId = typeof shipment.vendor === 'object'
            ? shipment.vendor._id?.toString()
            : shipment.vendor?.toString();
          if (!vendorId) continue;

          const vendorItems = order.items.filter((item: any) => {
            const iid = typeof item.vendor === 'object' ? item.vendor._id?.toString() : item.vendor?.toString();
            return iid === vendorId;
          });
          const subtotal = vendorItems.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);

          const commissionRatePct = await getCommissionRate(vendorId);
          const commission = Math.round(subtotal * (commissionRatePct / 100) * 100) / 100;
          const vendorAmount = Math.max(0, Math.round((subtotal - commission) * 100) / 100);

          await Wallet.findOneAndUpdate(
            { user: vendorId },
            {
              $inc: { balance: vendorAmount, totalEarned: vendorAmount },
              $push: {
                transactions: {
                  type: TransactionType.CREDIT,
                  amount: vendorAmount,
                  purpose: WalletPurpose.COMMISSION,
                  reference: `autocomplete_${order.orderNumber}_${vendorId}`,
                  description: `Auto-released payment for Order #${order.orderNumber} (24-hour window)`,
                  relatedOrder: order._id,
                  status: 'completed',
                  timestamp: new Date(),
                },
              },
            },
            { upsert: true }
          );

          logger.info(`✅ Auto-credited ₦${vendorAmount} to vendor ${vendorId} (order ${order.orderNumber})`);
          notificationService.vendorSaleCompleted(vendorId, order.orderNumber, subtotal, vendorAmount).catch(() => {});
        }
      } else {
        // Single-vendor: credit each unique vendor from order items
        const vendorMap = new Map<string, number>();
        for (const item of order.items) {
          const v = item.vendor as any;
          const vid = typeof v === 'object' ? v._id?.toString() : v?.toString();
          if (vid) vendorMap.set(vid, (vendorMap.get(vid) || 0) + item.price * item.quantity);
        }

        for (const [vendorId, subtotal] of vendorMap) {
          const commissionRatePct = await getCommissionRate(vendorId);
          const commission = Math.round(subtotal * (commissionRatePct / 100) * 100) / 100;
          const vendorAmount = Math.max(0, Math.round((subtotal - commission) * 100) / 100);

          await Wallet.findOneAndUpdate(
            { user: vendorId },
            {
              $inc: { balance: vendorAmount, totalEarned: vendorAmount },
              $push: {
                transactions: {
                  type: TransactionType.CREDIT,
                  amount: vendorAmount,
                  purpose: WalletPurpose.COMMISSION,
                  reference: `autocomplete_${order.orderNumber}_${vendorId}`,
                  description: `Auto-released payment for Order #${order.orderNumber} (24-hour window)`,
                  relatedOrder: order._id,
                  status: 'completed',
                  timestamp: new Date(),
                },
              },
            },
            { upsert: true }
          );
          logger.info(`✅ Auto-credited ₦${vendorAmount} to vendor ${vendorId} (order ${order.orderNumber})`);
          notificationService.vendorSaleCompleted(vendorId, order.orderNumber, subtotal, vendorAmount).catch(() => {});
        }
      }

      // Credit affiliate commission if applicable (atomic guard prevents double-credit with completeOrder)
      if ((order as any).affiliateUser && (order as any).affiliateCommission) {
        const claimed = await Order.findOneAndUpdate(
          { _id: order._id, affiliateCommissionPaid: { $ne: true } },
          { $set: { affiliateCommissionPaid: true } }
        );
        if (claimed) {
          const affiliateUserId = (order as any).affiliateUser;
          const commissionAmount = (order as any).affiliateCommission;
          await Wallet.findOneAndUpdate(
            { user: affiliateUserId },
            {
              $inc: { balance: commissionAmount, totalEarned: commissionAmount },
              $push: {
                transactions: {
                  type: TransactionType.CREDIT,
                  amount: commissionAmount,
                  purpose: WalletPurpose.COMMISSION,
                  reference: `autocomplete_affiliate_${order.orderNumber}`,
                  description: `Affiliate commission for Order #${order.orderNumber} (auto-released)`,
                  relatedOrder: order._id,
                  status: 'completed',
                  timestamp: new Date(),
                },
              },
            },
            { upsert: true }
          );
          logger.info(`✅ Auto-credited ₦${commissionAmount} affiliate commission for order ${order.orderNumber}`);
        }
      }

      // Award purchase points to customer and referral points to their referrer
      try {
        await rewardController.awardOrderPoints(order._id.toString());
        await rewardController.awardCustomerReferralPoints(order.user.toString(), order._id.toString());

        // Unlock vendor referral points for any vendor making their first sale
        const uniqueVendorIds = [...new Set(order.items.map((item: any) => {
          const v = item.vendor;
          return typeof v === 'object' ? v._id?.toString() : v?.toString();
        }).filter(Boolean))] as string[];

        for (const vendorId of uniqueVendorIds) {
          const vendorProfile = await VendorProfile.findOne({ user: vendorId });
          if (vendorProfile && !vendorProfile.referralRewarded && vendorProfile.referredBy) {
            await rewardController.unlockVendorReferralPoints(vendorId);
            vendorProfile.referralRewarded = true;
            await vendorProfile.save();
          }
        }

        logger.info(`✅ Auto-complete: points awarded for order ${order.orderNumber}`);
      } catch (pointsErr: any) {
        logger.error(`❌ Auto-complete: points award failed for order ${order.orderNumber}: ${pointsErr.message}`);
      }

      logger.info(`✅ Auto-complete done: order ${order.orderNumber}`);
    } catch (err: any) {
      logger.error(`❌ Auto-complete failed for order ${order.orderNumber}: ${err.message}`);
    }
  }
}

export function setupOrderAutoComplete(): void {
  logger.info('⏰ Order auto-complete scheduler started (24-hour delivery window)');
  // Run once on startup to catch any orders missed during downtime
  runAutoComplete().catch(err => logger.error('Auto-complete startup run failed:', err.message));
  // Then check every 30 minutes
  setInterval(() => {
    runAutoComplete().catch(err => logger.error('Auto-complete interval run failed:', err.message));
  }, CHECK_INTERVAL_MS);
}
