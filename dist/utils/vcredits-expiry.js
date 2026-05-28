"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupVCreditsExpiry = setupVCreditsExpiry;
const Wallet_1 = __importDefault(require("../models/Wallet"));
const notification_service_1 = require("../services/notification.service");
const logger_1 = require("./logger");
const REMINDER_DAYS = [14, 7, 3, 1];
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
async function runVCreditsExpiry() {
    const now = new Date();
    // ── 1. Send reminders ────────────────────────────────────────────
    for (const daysLeft of REMINDER_DAYS) {
        const windowStart = new Date(now.getTime() + (daysLeft - 1) * 24 * 60 * 60 * 1000);
        const windowEnd = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000);
        const wallets = await Wallet_1.default.find({
            vCredits: { $gt: 0 },
            vCreditsExpiresAt: { $gte: windowStart, $lt: windowEnd },
            vCreditsRemindersSent: { $ne: daysLeft },
        }).select('user vCredits vCreditsRemindersSent');
        for (const wallet of wallets) {
            try {
                await notification_service_1.notificationService.vCreditsExpiringSoon(wallet.user.toString(), wallet.vCredits, daysLeft);
                await Wallet_1.default.findByIdAndUpdate(wallet._id, {
                    $addToSet: { vCreditsRemindersSent: daysLeft },
                });
                logger_1.logger.info(`⏳ VCredits ${daysLeft}-day reminder sent to user ${wallet.user} (₦${wallet.vCredits})`);
            }
            catch (err) {
                logger_1.logger.error(`Error sending VCredits ${daysLeft}-day reminder to ${wallet.user}:`, err);
            }
        }
    }
    // ── 2. Expire overdue balances ───────────────────────────────────
    const expired = await Wallet_1.default.find({
        vCredits: { $gt: 0 },
        vCreditsExpiresAt: { $lt: now },
    }).select('user vCredits');
    for (const wallet of expired) {
        try {
            const amount = wallet.vCredits;
            await Wallet_1.default.findByIdAndUpdate(wallet._id, {
                $set: { vCredits: 0, vCreditsExpiresAt: null, vCreditsRemindersSent: [] },
            });
            await notification_service_1.notificationService.send({
                userId: wallet.user.toString(),
                type: 'system',
                title: 'VCredits Expired',
                message: `₦${amount.toLocaleString()} VCredits have expired. Earn more by shopping or converting your points!`,
                data: { type: 'points', amount },
                link: '/rewards',
            });
            logger_1.logger.info(`💸 ₦${amount} VCredits expired for user ${wallet.user}`);
        }
        catch (err) {
            logger_1.logger.error(`Error expiring VCredits for wallet ${wallet._id}:`, err);
        }
    }
}
function setupVCreditsExpiry() {
    logger_1.logger.info('💎 VCredits expiry scheduler started (daily)');
    runVCreditsExpiry().catch(err => logger_1.logger.error('VCredits expiry startup run failed:', err.message));
    setInterval(() => {
        runVCreditsExpiry().catch(err => logger_1.logger.error('VCredits expiry interval run failed:', err.message));
    }, CHECK_INTERVAL_MS);
}
//# sourceMappingURL=vcredits-expiry.js.map