import Wallet from '../models/Wallet';
import { notificationService } from '../services/notification.service';
import { logger } from './logger';

const REMINDER_DAYS = [14, 7, 3, 1];
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runVCreditsExpiry(): Promise<void> {
  const now = new Date();

  // ── 1. Send reminders ────────────────────────────────────────────
  for (const daysLeft of REMINDER_DAYS) {
    const windowStart = new Date(now.getTime() + (daysLeft - 1) * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() +  daysLeft      * 24 * 60 * 60 * 1000);

    const wallets = await Wallet.find({
      vCredits: { $gt: 0 },
      vCreditsExpiresAt: { $gte: windowStart, $lt: windowEnd },
      vCreditsRemindersSent: { $ne: daysLeft },
    }).select('user vCredits vCreditsRemindersSent');

    for (const wallet of wallets) {
      try {
        await notificationService.vCreditsExpiringSoon(
          wallet.user.toString(),
          wallet.vCredits,
          daysLeft
        );
        await Wallet.findByIdAndUpdate(wallet._id, {
          $addToSet: { vCreditsRemindersSent: daysLeft },
        });
        logger.info(`⏳ VCredits ${daysLeft}-day reminder sent to user ${wallet.user} (₦${wallet.vCredits})`);
      } catch (err) {
        logger.error(`Error sending VCredits ${daysLeft}-day reminder to ${wallet.user}:`, err);
      }
    }
  }

  // ── 2. Expire overdue balances ───────────────────────────────────
  const expired = await Wallet.find({
    vCredits: { $gt: 0 },
    vCreditsExpiresAt: { $lt: now },
  }).select('user vCredits');

  for (const wallet of expired) {
    try {
      const amount = wallet.vCredits;
      await Wallet.findByIdAndUpdate(wallet._id, {
        $set: { vCredits: 0, vCreditsExpiresAt: null, vCreditsRemindersSent: [] },
      });
      await notificationService.send({
        userId: wallet.user.toString(),
        type: 'system' as any,
        title: 'VCredits Expired',
        message: `₦${amount.toLocaleString()} VCredits have expired. Earn more by shopping or converting your points!`,
        data: { type: 'points', amount },
        link: '/rewards',
      });
      logger.info(`💸 ₦${amount} VCredits expired for user ${wallet.user}`);
    } catch (err) {
      logger.error(`Error expiring VCredits for wallet ${wallet._id}:`, err);
    }
  }
}

export function setupVCreditsExpiry(): void {
  logger.info('💎 VCredits expiry scheduler started (daily)');
  runVCreditsExpiry().catch(err =>
    logger.error('VCredits expiry startup run failed:', err.message)
  );
  setInterval(() => {
    runVCreditsExpiry().catch(err =>
      logger.error('VCredits expiry interval run failed:', err.message)
    );
  }, CHECK_INTERVAL_MS);
}
