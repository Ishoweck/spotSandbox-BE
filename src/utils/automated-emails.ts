// ══════════════════════════════════════════════════════════════════════════════
// Consolidated scheduler for 4 automated email flows:
//   1. Abandoned cart reminders (24h + 72h)
//   2. Customer come-back after 30 days silent
//   3. Weekly admin digest
//   4. Weekly ambassador performance summary
//
// Every send is deduplicated via AutomatedEmailLog with a unique
// (recipient, type, periodKey) index. Weekly flows use ISO week keys
// ("YYYY-Www"); one-shot flows use "ONCE" and rely on the 180-day TTL.
// ══════════════════════════════════════════════════════════════════════════════

import { Types } from 'mongoose';
import Cart from '../models/Cart';
import Order from '../models/Order';
import User from '../models/User';
import Ambassador from '../models/Ambassador';
import AmbassadorReferral from '../models/AmbassadorReferral';
import VendorProfile from '../models/VendorProfile';
import Dispute from '../models/Dispute';
import AutomatedEmailLog from '../models/AutomatedEmailLog';
import { enqueueEmail, EmailJobType } from '../queues/email.queue';
import { UserRole, OrderStatus, PaymentStatus, VendorVerificationStatus } from '../types';
import { logger } from './logger';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ─── Dedup helper ───────────────────────────────────────────────────────────

async function sendOnce(
  recipient: Types.ObjectId,
  type: EmailJobType,
  periodKey: string,
  enqueue: () => Promise<void>,
): Promise<boolean> {
  try {
    await AutomatedEmailLog.create({ recipient, type, periodKey });
  } catch (err: any) {
    if (err?.code === 11000) return false; // duplicate — already sent
    throw err;
  }
  try {
    await enqueue();
    return true;
  } catch (err) {
    // Rollback the log so a future run can retry — otherwise we'd never re-attempt.
    await AutomatedEmailLog.deleteOne({ recipient, type, periodKey }).catch(() => {});
    throw err;
  }
}

/** ISO week key like "2026-W33" — used as the periodKey for weekly digests. */
function isoWeekKey(d: Date): string {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNr = 1 + Math.ceil((firstThursday - target.getTime()) / (7 * DAY));
  return `${d.getUTCFullYear()}-W${String(weekNr).padStart(2, '0')}`;
}

// ─── 1. Abandoned cart (24h + 72h) ──────────────────────────────────────────

async function checkAbandonedCarts(now: Date): Promise<void> {
  const stages: { hours: number; type: EmailJobType }[] = [
    { hours: 24, type: EmailJobType.CART_ABANDONED_24H },
    { hours: 72, type: EmailJobType.CART_ABANDONED_72H },
  ];

  for (const stage of stages) {
    const cutoffOld = new Date(now.getTime() - stage.hours * HOUR);
    const cutoffNew = new Date(now.getTime() - (stage.hours + 6) * HOUR); // 6h window
    const carts = await Cart.find({
      'items.0': { $exists: true },
      updatedAt: { $lte: cutoffOld, $gte: cutoffNew },
    }).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string; role: string } }>(
      'user',
      'email firstName role',
    );

    for (const cart of carts) {
      if (!cart.user?.email || cart.user.role !== UserRole.CUSTOMER) continue;
      const total = (cart.items || []).reduce((s: number, i: any) => s + (i.price * i.quantity), 0);
      try {
        await sendOnce(cart.user._id, stage.type, `cart-${cart._id}`, () =>
          enqueueEmail(stage.type, cart.user.email, cart.user.firstName, 0, {
            itemCount: cart.items.length,
            cartTotal: total,
          }),
        );
      } catch (err: any) {
        logger.error(`[AutomatedEmails] Abandoned cart ${stage.hours}h failed for user ${cart.user._id}:`, { error: err.message });
      }
    }
  }
}

// ─── 2. Customer come-back after 30 days silent ─────────────────────────────

async function checkCustomerComeback(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 30 * DAY);
  const olderThan = new Date(now.getTime() - 35 * DAY); // 5-day window to avoid re-hitting daily

  // Customers whose most recent order was between 30-35 days ago
  const stalePayers = await Order.aggregate([
    { $match: { createdAt: { $gte: olderThan } } },
    { $group: { _id: '$user', lastOrderAt: { $max: '$createdAt' } } },
    { $match: { lastOrderAt: { $lte: cutoff, $gte: olderThan } } },
    { $limit: 1000 },
  ]);

  const userIds = stalePayers.map((s: any) => s._id).filter(Boolean);
  if (userIds.length === 0) return;

  const users = await User.find({ _id: { $in: userIds }, role: UserRole.CUSTOMER })
    .select('email firstName _id')
    .lean();

  for (const user of users) {
    if (!user.email) continue;
    const stale = stalePayers.find((s: any) => String(s._id) === String(user._id));
    const daysSince = stale ? Math.floor((now.getTime() - new Date(stale.lastOrderAt).getTime()) / DAY) : 30;
    try {
      await sendOnce(user._id as Types.ObjectId, EmailJobType.CUSTOMER_COMEBACK, 'ONCE', () =>
        enqueueEmail(EmailJobType.CUSTOMER_COMEBACK, user.email, user.firstName, 0, { daysSince }),
      );
    } catch (err: any) {
      logger.error(`[AutomatedEmails] Customer comeback failed for user ${user._id}:`, { error: err.message });
    }
  }
}

// ─── 3. Weekly admin digest (Monday morning) ────────────────────────────────

async function checkWeeklyAdminDigest(now: Date): Promise<void> {
  const weekKey = isoWeekKey(now);
  const weekStart = new Date(now.getTime() - 7 * DAY);

  const [
    pendingKycs,
    openDisputes,
    refundsThisWeek,
    newSignups,
    revenueAgg,
    admins,
  ] = await Promise.all([
    VendorProfile.countDocuments({ verificationStatus: VendorVerificationStatus.PENDING }),
    Dispute.countDocuments({ status: { $in: ['open', 'vendor_responded', 'under_review'] } }),
    Order.countDocuments({ status: OrderStatus.REFUNDED, updatedAt: { $gte: weekStart } }),
    User.countDocuments({ createdAt: { $gte: weekStart } }),
    Order.aggregate([
      { $match: { paymentStatus: PaymentStatus.COMPLETED, createdAt: { $gte: weekStart } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    // Weekly digest is a strategic snapshot — only send to top-level admins.
    // Other admin sub-roles (financial/support/kyc/content/marketing) don't need it.
    User.find({
      role: { $in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
    }).select('email firstName _id').lean(),
  ]);

  const revenueThisWeek = revenueAgg?.[0]?.total || 0;
  const weekLabel = `${weekStart.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}`;

  for (const admin of admins) {
    if (!admin.email) continue;
    try {
      await sendOnce(admin._id as Types.ObjectId, EmailJobType.ADMIN_WEEKLY_DIGEST, weekKey, () =>
        enqueueEmail(EmailJobType.ADMIN_WEEKLY_DIGEST, admin.email, admin.firstName, 0, {
          stats: { pendingKycs, openDisputes, refundsThisWeek, newSignups, revenueThisWeek, weekLabel },
        }),
      );
    } catch (err: any) {
      logger.error(`[AutomatedEmails] Admin weekly digest failed for ${admin.email}:`, { error: err.message });
    }
  }
}

// ─── 4. Weekly ambassador summary (Monday morning) ──────────────────────────

async function checkWeeklyAmbassadorSummary(now: Date): Promise<void> {
  const weekKey = isoWeekKey(now);
  const weekStart = new Date(now.getTime() - 7 * DAY);

  const ambassadors = await Ambassador.find({ status: 'approved', userId: { $exists: true } })
    .select('email name userId')
    .lean();

  for (const amb of ambassadors) {
    if (!amb.email || !amb.userId) continue;

    const [thisWeekRefs, totals] = await Promise.all([
      AmbassadorReferral.aggregate([
        { $match: { ambassadorId: amb.userId, createdAt: { $gte: weekStart } } },
        { $group: { _id: null, count: { $sum: 1 }, commissions: { $sum: '$totalEarned' } } },
      ]),
      AmbassadorReferral.aggregate([
        { $match: { ambassadorId: amb.userId } },
        { $group: { _id: null, count: { $sum: 1 }, earned: { $sum: '$totalEarned' } } },
      ]),
    ]);

    const referralsThisWeek = thisWeekRefs?.[0]?.count || 0;
    const commissionsThisWeek = thisWeekRefs?.[0]?.commissions || 0;
    const totalReferrals = totals?.[0]?.count || 0;
    const totalEarned = totals?.[0]?.earned || 0;

    // Skip if nothing to report this week AND no history — avoids empty-nudge spam
    if (referralsThisWeek === 0 && totalReferrals === 0) continue;

    const weekLabel = `${weekStart.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}`;

    try {
      await sendOnce(amb.userId as Types.ObjectId, EmailJobType.AMBASSADOR_WEEKLY_SUMMARY, weekKey, () =>
        enqueueEmail(EmailJobType.AMBASSADOR_WEEKLY_SUMMARY, amb.email, amb.name?.split(' ')[0] || '', 0, {
          stats: { referralsThisWeek, commissionsThisWeek, totalReferrals, totalEarned, weekLabel },
        }),
      );
    } catch (err: any) {
      logger.error(`[AutomatedEmails] Ambassador weekly summary failed for ${amb.email}:`, { error: err.message });
    }
  }
}

// ─── Runner + scheduler ─────────────────────────────────────────────────────

async function runHourly(): Promise<void> {
  const now = new Date();
  try { await checkAbandonedCarts(now); } catch (err: any) { logger.error('[AutomatedEmails] checkAbandonedCarts:', { error: err.message }); }
}

async function runDaily(): Promise<void> {
  const now = new Date();
  try { await checkCustomerComeback(now); } catch (err: any) { logger.error('[AutomatedEmails] checkCustomerComeback:', { error: err.message }); }
}

async function runWeeklyIfMonday(): Promise<void> {
  const now = new Date();
  // Run weekly flows on Mondays only
  if (now.getDay() !== 1) return;
  try { await checkWeeklyAdminDigest(now); } catch (err: any) { logger.error('[AutomatedEmails] checkWeeklyAdminDigest:', { error: err.message }); }
  try { await checkWeeklyAmbassadorSummary(now); } catch (err: any) { logger.error('[AutomatedEmails] checkWeeklyAmbassadorSummary:', { error: err.message }); }
}

export function setupAutomatedEmails(): void {
  logger.info('[AutomatedEmails] Scheduler started (hourly cart check, daily comeback + weekly digests)');

  // Kick off once on boot (catches anything missed while server was down)
  runHourly().catch(() => {});
  runDaily().catch(() => {});
  runWeeklyIfMonday().catch(() => {});

  setInterval(() => { runHourly().catch(() => {}); }, HOUR);
  setInterval(() => { runDaily().catch(() => {}); }, DAY);
  // Check every 6h if it's Monday — weekly dedup via periodKey prevents duplicates
  setInterval(() => { runWeeklyIfMonday().catch(() => {}); }, 6 * HOUR);
}
