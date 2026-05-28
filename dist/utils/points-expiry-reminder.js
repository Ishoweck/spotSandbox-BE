"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupPointsExpiryReminders = setupPointsExpiryReminders;
const PointsTransaction_1 = __importDefault(require("../models/PointsTransaction"));
const notification_service_1 = require("../services/notification.service");
const logger_1 = require("./logger");
// Reminder windows in days before expiry
const REMINDER_DAYS = [14, 7, 3, 1];
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
async function runExpiryReminders() {
    const now = new Date();
    for (const daysLeft of REMINDER_DAYS) {
        // Window: transactions expiring within the next daysLeft days but not yet in the next (daysLeft - 1) days
        // e.g. for 7-day reminder: expires between now+6d and now+7d
        const windowStart = new Date(now.getTime() + (daysLeft - 1) * 24 * 60 * 60 * 1000);
        const windowEnd = new Date(now.getTime() + daysLeft * 24 * 60 * 60 * 1000);
        // Find active transactions in this expiry window that haven't had this reminder sent
        const transactions = await PointsTransaction_1.default.find({
            type: 'earn',
            status: 'active',
            expiresAt: { $gte: windowStart, $lt: windowEnd },
            remindersSent: { $ne: daysLeft },
        }).select('user points remindersSent');
        if (transactions.length === 0)
            continue;
        // Group by user and sum points
        const byUser = new Map();
        for (const tx of transactions) {
            const uid = tx.user.toString();
            if (!byUser.has(uid))
                byUser.set(uid, { txIds: [], totalPoints: 0 });
            const entry = byUser.get(uid);
            entry.txIds.push(tx._id);
            entry.totalPoints += tx.points;
        }
        for (const [userId, { txIds, totalPoints }] of byUser) {
            try {
                await notification_service_1.notificationService.pointsExpiringSoon(userId, totalPoints, daysLeft);
                // Mark all their transactions for this window as reminded
                await PointsTransaction_1.default.updateMany({ _id: { $in: txIds } }, { $addToSet: { remindersSent: daysLeft } });
                logger_1.logger.info(`⏳ Sent ${daysLeft}-day expiry reminder to user ${userId} (${totalPoints} pts)`);
            }
            catch (err) {
                logger_1.logger.error(`Error sending ${daysLeft}-day expiry reminder to user ${userId}:`, err);
            }
        }
    }
}
function setupPointsExpiryReminders() {
    logger_1.logger.info('⏳ Points expiry reminder scheduler started (daily)');
    // Run once at startup to catch any missed windows
    runExpiryReminders().catch(err => logger_1.logger.error('Points expiry reminder startup run failed:', err.message));
    // Then every 24 hours
    setInterval(() => {
        runExpiryReminders().catch(err => logger_1.logger.error('Points expiry reminder interval run failed:', err.message));
    }, CHECK_INTERVAL_MS);
}
//# sourceMappingURL=points-expiry-reminder.js.map