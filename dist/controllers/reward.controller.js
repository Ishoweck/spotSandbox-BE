"use strict";
// controllers/reward.controller.ts - UPDATED WITH POINTS TRANSACTION TRACKING
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rewardController = exports.RewardController = void 0;
const mongoose_1 = require("mongoose");
const types_1 = require("../types");
const User_1 = __importDefault(require("../models/User"));
const Order_1 = __importDefault(require("../models/Order"));
const PointsTransaction_1 = __importDefault(require("../models/PointsTransaction"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const Additional_1 = require("../models/Additional");
const Review_1 = __importDefault(require("../models/Review"));
const Product_1 = __importDefault(require("../models/Product"));
const error_1 = require("../middleware/error");
const notification_service_1 = require("../services/notification.service");
const logger_1 = require("../utils/logger");
const POINTS_EXPIRY_DAYS = 60;
class RewardController {
    constructor() {
        // Track in-flight redemptions to prevent double-click
        this.redemptionLocks = new Set();
    }
    /**
     * Get user points and rewards
     */
    async getUserPoints(req, res) {
        const userId = req.user?.id;
        // Lazily expire old points before reading balance
        await this.expireOldPoints(userId);
        const user = await User_1.default.findById(userId);
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        const currentPoints = user.points || 0;
        // Count locked points (pending vendor referral)
        const lockedAgg = await PointsTransaction_1.default.aggregate([
            { $match: { user: new mongoose_1.Types.ObjectId(userId), status: 'locked', type: 'earn' } },
            { $group: { _id: null, total: { $sum: '$points' } } },
        ]);
        const lockedPoints = lockedAgg[0]?.total || 0;
        // Calculate tier based on current points (drops when points are redeemed)
        let tier = 'Bronze';
        if (currentPoints >= 10000) {
            tier = 'Diamond';
        }
        else if (currentPoints >= 5000) {
            tier = 'Platinum';
        }
        else if (currentPoints >= 2000) {
            tier = 'Gold';
        }
        else if (currentPoints >= 500) {
            tier = 'Silver';
        }
        // Calculate next tier requirements
        const tierThresholds = {
            Bronze: { min: 0, next: 500 },
            Silver: { min: 500, next: 2000 },
            Gold: { min: 2000, next: 5000 },
            Platinum: { min: 5000, next: 10000 },
            Diamond: { min: 10000, next: null },
        };
        const currentTier = tierThresholds[tier];
        const pointsToNext = currentTier.next ? currentTier.next - currentPoints : 0;
        // Get VCredits balance
        const wallet = await Additional_1.Wallet.findOne({ user: user._id });
        const vCredits = wallet?.vCredits || 0;
        res.json({
            success: true,
            data: {
                points: currentPoints,
                lockedPoints,
                vCredits,
                tier,
                pointsToNextTier: Math.max(0, pointsToNext),
                badges: user.badges || [],
                achievements: user.achievements || [],
            },
        });
    }
    /**
     * Award points to user with transaction tracking
     */
    async awardPoints(userId, points, activity, description, metadata) {
        const user = await User_1.default.findById(userId);
        if (!user) {
            return;
        }
        // Update user points
        user.points = (user.points || 0) + points;
        await user.save();
        // Set 60-day expiry from today
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + POINTS_EXPIRY_DAYS);
        // Create transaction record
        await PointsTransaction_1.default.create({
            user: userId,
            type: 'earn',
            activity,
            points,
            description,
            status: 'active',
            expiresAt,
            metadata,
        });
        // Notify user
        try {
            await notification_service_1.notificationService.pointsEarned(userId, points, description);
        }
        catch (error) {
            logger_1.logger.error('Error sending points notification:', error);
        }
        logger_1.logger.info(`Points awarded: ${points} to user ${userId} - ${description}`);
    }
    /**
     * Redeem points for cash
     */
    async redeemPoints(req, res) {
        const { points } = req.body;
        const userId = req.user?.id;
        if (this.redemptionLocks.has(userId)) {
            throw new error_1.AppError('Redemption already in progress. Please wait.', 429);
        }
        this.redemptionLocks.add(userId);
        try {
            // Expire stale points before allowing redemption
            await this.expireOldPoints(userId);
            const user = await User_1.default.findById(userId);
            if (!user) {
                throw new error_1.AppError('User not found', 404);
            }
            if ((user.points || 0) < points) {
                throw new error_1.AppError('Insufficient points', 400);
            }
            if (points < 100) {
                throw new error_1.AppError('Minimum redemption is 100 points', 400);
            }
            // Tier-based conversion rate
            const conversionRate = this.getTierConversionRate(user.points || 0);
            const cashValue = Math.round(points * conversionRate * 100) / 100;
            // Atomic deduct using findOneAndUpdate to prevent race conditions
            const updated = await User_1.default.findOneAndUpdate({ _id: userId, points: { $gte: points } }, { $inc: { points: -points } }, { new: true });
            if (!updated) {
                throw new error_1.AppError('Insufficient points', 400);
            }
            // Create transaction record for redemption
            await PointsTransaction_1.default.create({
                user: user._id,
                type: 'spend',
                activity: 'redemption',
                points: -points,
                description: `Converted ${points} points to ${cashValue} VCredits`,
                metadata: { vCredits: cashValue },
            });
            // Add to wallet as VCredits (separate from cash balance)
            let wallet = await Additional_1.Wallet.findOne({ user: user._id });
            if (!wallet) {
                wallet = await Additional_1.Wallet.create({ user: user._id });
            }
            wallet.vCredits = (wallet.vCredits || 0) + cashValue;
            wallet.vCreditsExpiresAt = this.vCreditsExpiry();
            wallet.vCreditsRemindersSent = [];
            wallet.transactions.push({
                type: 'credit',
                amount: cashValue,
                purpose: 'reward',
                reference: `VCREDITS-${Date.now()}`,
                description: `Converted ${points} points to ${cashValue} VCredits`,
                status: 'completed',
                timestamp: new Date(),
            });
            await wallet.save();
            logger_1.logger.info(`Points redeemed: ${points} by user ${req.user?.id}`);
            // Notify user
            try {
                await notification_service_1.notificationService.pointsRedeemed(req.user.id, points, cashValue);
            }
            catch (error) {
                logger_1.logger.error('Error sending redeem notification:', error);
            }
            res.json({
                success: true,
                message: `${points} points converted to ${cashValue.toLocaleString()} VCredits. Use them to pay for orders!`,
                data: {
                    pointsRedeemed: points,
                    vCreditsEarned: cashValue,
                    remainingPoints: updated.points,
                    vCreditsBalance: wallet.vCredits,
                },
            });
        }
        finally {
            this.redemptionLocks.delete(userId);
        }
    }
    /**
     * Award badge to user
     */
    async awardBadge(userId, badge) {
        const user = await User_1.default.findById(userId);
        if (!user) {
            return;
        }
        if (!user.badges) {
            user.badges = [];
        }
        if (!user.badges.includes(badge)) {
            user.badges.push(badge);
            await user.save();
            // Notify user
            try {
                await notification_service_1.notificationService.badgeEarned(userId, badge);
            }
            catch (error) {
                logger_1.logger.error('Error sending badge notification:', error);
            }
            logger_1.logger.info(`Badge awarded: ${badge} to user ${userId}`);
        }
    }
    /**
     * Get points history from transactions
     */
    async getPointsHistory(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        // Get transactions from PointsTransaction model
        const transactions = await PointsTransaction_1.default.find({ user: req.user?.id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
        // Get total count for pagination
        const total = await PointsTransaction_1.default.countDocuments({ user: req.user?.id });
        // Format history
        const history = transactions.map((transaction) => ({
            date: transaction.createdAt,
            type: transaction.activity,
            description: transaction.description,
            points: transaction.points,
            metadata: transaction.metadata,
        }));
        res.json({
            success: true,
            data: {
                history,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                }
            },
        });
    }
    /**
     * Get leaderboard
     */
    async getLeaderboard(req, res) {
        const { period = 'all-time', type = 'points' } = req.query;
        let users;
        if (type === 'points') {
            users = await User_1.default.find({ points: { $gt: 0 } })
                .select('firstName lastName points badges')
                .sort({ points: -1 })
                .limit(50);
            const leaderboard = users.map((user, index) => ({
                rank: index + 1,
                user: {
                    id: user._id,
                    name: `${user.firstName} ${user.lastName}`,
                    badges: user.badges || [],
                },
                score: user.points || 0,
            }));
            res.json({
                success: true,
                data: {
                    type: 'points',
                    period,
                    leaderboard,
                },
            });
        }
        else {
            res.json({
                success: true,
                data: {
                    type,
                    period,
                    leaderboard: [],
                },
            });
        }
    }
    /**
     * Get available rewards
     */
    async getAvailableRewards(req, res) {
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        const userPoints = user.points || 0;
        const rate = this.getTierConversionRate(userPoints);
        const tier = this.getTierName(userPoints);
        const rewardOptions = [100, 500, 1000, 5000];
        const rewards = rewardOptions.map((cost) => {
            const vCreditsValue = Math.round(cost * rate * 100) / 100;
            return {
                id: `vcredits-${cost}`,
                name: `₦${vCreditsValue.toLocaleString()} VCredits`,
                description: `Convert ${cost} points → ₦${vCreditsValue.toLocaleString()} VCredits (${tier} rate: ₦${rate}/pt)`,
                pointsCost: cost,
                vCreditsValue,
                available: userPoints >= cost,
            };
        });
        res.json({
            success: true,
            data: {
                userPoints: user.points || 0,
                rewards,
            },
        });
    }
    /**
     * Check and award automatic badges
     */
    async checkBadges(userId) {
        const user = await User_1.default.findById(userId);
        if (!user)
            return;
        // Vendors get their own badge set — route them away from customer checks
        if (user.role === types_1.UserRole.VENDOR) {
            const vendorProfile = await VendorProfile_1.default.findOne({ user: userId }).select('verificationStatus averageRating totalReviews');
            if (!vendorProfile || vendorProfile.verificationStatus !== types_1.VendorVerificationStatus.VERIFIED)
                return;
            await this.checkVendorBadges(userId, user, vendorProfile);
            return;
        }
        // Reload badges fresh so we don't use a stale snapshot from caller
        const badges = user.badges || [];
        // ── Order counts ────────────────────────────────────────────
        const orderCount = await Order_1.default.countDocuments({ user: userId, paymentStatus: 'completed' });
        if (orderCount >= 1 && !badges.includes('first-purchase'))
            await this.awardBadge(userId, 'first-purchase');
        if (orderCount >= 10 && !badges.includes('loyal-customer'))
            await this.awardBadge(userId, 'loyal-customer');
        if (orderCount >= 50 && !badges.includes('vip-customer'))
            await this.awardBadge(userId, 'vip-customer');
        if (orderCount >= 100 && !badges.includes('century-shopper'))
            await this.awardBadge(userId, 'century-shopper');
        // ── Spending ────────────────────────────────────────────────
        const orders = await Order_1.default.find({ user: userId, paymentStatus: 'completed' }).select('total');
        const totalSpent = orders.reduce((sum, o) => sum + o.total, 0);
        if (totalSpent >= 100000 && !badges.includes('high-spender'))
            await this.awardBadge(userId, 'high-spender');
        if (totalSpent >= 500000 && !badges.includes('whale'))
            await this.awardBadge(userId, 'whale');
        // Single order over ₦50,000
        if (!badges.includes('big-spender')) {
            const bigOrder = await Order_1.default.exists({ user: userId, paymentStatus: 'completed', total: { $gte: 50000 } });
            if (bigOrder)
                await this.awardBadge(userId, 'big-spender');
        }
        // Flash sale purchase — checks if any completed order item's product is/was a flash sale item
        if (!badges.includes('flash-buyer')) {
            const userOrders = await Order_1.default.find({ user: userId, paymentStatus: 'completed' }).select('items').lean();
            const productIds = userOrders.flatMap(o => o.items.map((i) => i.product)).filter(Boolean);
            if (productIds.length > 0) {
                const flashProduct = await Product_1.default.exists({ _id: { $in: productIds }, isFlashSale: true });
                if (flashProduct)
                    await this.awardBadge(userId, 'flash-buyer');
            }
        }
        // ── Reviews ─────────────────────────────────────────────────
        const reviewCount = await Review_1.default.countDocuments({ user: userId, status: 'approved' });
        if (reviewCount >= 1 && !badges.includes('first-review'))
            await this.awardBadge(userId, 'first-review');
        if (reviewCount >= 10 && !badges.includes('top-reviewer'))
            await this.awardBadge(userId, 'top-reviewer');
        if (!badges.includes('five-star-fan')) {
            const fiveStarCount = await Review_1.default.countDocuments({ user: userId, rating: 5 });
            if (fiveStarCount >= 5)
                await this.awardBadge(userId, 'five-star-fan');
        }
        // ── Login streak ─────────────────────────────────────────────
        const streak = user.loginStreak?.currentStreak || 0;
        if (streak >= 3 && !badges.includes('streak-3'))
            await this.awardBadge(userId, 'streak-3');
        if (streak >= 7 && !badges.includes('streak-7'))
            await this.awardBadge(userId, 'streak-7');
        if (streak >= 30 && !badges.includes('streak-30'))
            await this.awardBadge(userId, 'streak-30');
        // ── Referrals ────────────────────────────────────────────────
        const referralCount = await User_1.default.countDocuments({ referredBy: new mongoose_1.Types.ObjectId(userId) });
        if (referralCount >= 1 && !badges.includes('referral-rookie'))
            await this.awardBadge(userId, 'referral-rookie');
        if (referralCount >= 5 && !badges.includes('connector'))
            await this.awardBadge(userId, 'connector');
        // ── Wishlist ─────────────────────────────────────────────────
        if (!badges.includes('wishlist-collector')) {
            const wishlist = await Additional_1.Wishlist.findOne({ user: userId }).select('items').lean();
            if (wishlist && (wishlist.items?.length || 0) >= 10) {
                await this.awardBadge(userId, 'wishlist-collector');
            }
        }
        // ── Explorer (ordered from 5+ different categories) ──────────
        if (!badges.includes('explorer')) {
            const categoryAgg = await Order_1.default.aggregate([
                { $match: { user: new mongoose_1.Types.ObjectId(userId), paymentStatus: 'completed' } },
                { $unwind: '$items' },
                { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'prod' } },
                { $unwind: { path: '$prod', preserveNullAndEmptyArrays: true } },
                { $group: { _id: '$prod.category' } },
                { $match: { _id: { $ne: null } } },
                { $count: 'total' },
            ]);
            if ((categoryAgg[0]?.total || 0) >= 5) {
                await this.awardBadge(userId, 'explorer');
            }
        }
        // ── Profile ──────────────────────────────────────────────────
        if (user.emailVerified && !badges.includes('verified-identity')) {
            await this.awardBadge(userId, 'verified-identity');
        }
        // ── Early adopter (joined within first 6 months of platform) ─
        // Update PLATFORM_LAUNCH_DATE to your actual go-live date
        if (!badges.includes('early-adopter')) {
            const PLATFORM_LAUNCH_DATE = new Date('2026-06-09'); // 2nd week of June 2026
            const earlyAdopterCutoff = new Date(PLATFORM_LAUNCH_DATE);
            earlyAdopterCutoff.setMonth(earlyAdopterCutoff.getMonth() + 6);
            if (user.createdAt <= earlyAdopterCutoff) {
                await this.awardBadge(userId, 'early-adopter');
            }
        }
    }
    async checkVendorBadges(userId, user, vendorProfile) {
        const badges = user.badges || [];
        const vid = new mongoose_1.Types.ObjectId(userId);
        // ── Sales count ──────────────────────────────────────────────
        const salesCount = await Order_1.default.countDocuments({
            'vendorShipments.vendor': vid,
            paymentStatus: 'completed',
        });
        if (salesCount >= 1 && !badges.includes('vendor-first-sale'))
            await this.awardBadge(userId, 'vendor-first-sale');
        if (salesCount >= 10 && !badges.includes('vendor-ten-sales'))
            await this.awardBadge(userId, 'vendor-ten-sales');
        if (salesCount >= 50 && !badges.includes('vendor-fifty-sales'))
            await this.awardBadge(userId, 'vendor-fifty-sales');
        if (salesCount >= 100 && !badges.includes('vendor-century-seller'))
            await this.awardBadge(userId, 'vendor-century-seller');
        // ── Revenue ──────────────────────────────────────────────────
        const revenueAgg = await Order_1.default.aggregate([
            { $match: { paymentStatus: 'completed' } },
            { $unwind: '$items' },
            { $match: { 'items.vendor': vid } },
            { $group: { _id: null, total: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
        ]);
        const revenue = revenueAgg[0]?.total || 0;
        if (revenue >= 50000 && !badges.includes('vendor-revenue-50k'))
            await this.awardBadge(userId, 'vendor-revenue-50k');
        if (revenue >= 500000 && !badges.includes('vendor-revenue-500k'))
            await this.awardBadge(userId, 'vendor-revenue-500k');
        if (revenue >= 1000000 && !badges.includes('vendor-millionaire'))
            await this.awardBadge(userId, 'vendor-millionaire');
        // ── Product listings ─────────────────────────────────────────
        const productCount = await Product_1.default.countDocuments({
            vendor: vid,
            status: { $in: ['active', 'pending_approval'] },
        });
        if (productCount >= 1 && !badges.includes('vendor-first-listing'))
            await this.awardBadge(userId, 'vendor-first-listing');
        if (productCount >= 10 && !badges.includes('vendor-ten-products'))
            await this.awardBadge(userId, 'vendor-ten-products');
        if (productCount >= 50 && !badges.includes('vendor-prolific'))
            await this.awardBadge(userId, 'vendor-prolific');
        // ── Reviews received ─────────────────────────────────────────
        if (!badges.includes('vendor-five-star') || !badges.includes('vendor-highly-rated')) {
            const vendorProductIds = await Product_1.default.distinct('_id', { vendor: vid });
            if (!badges.includes('vendor-five-star')) {
                const fiveStarExists = await Review_1.default.exists({
                    product: { $in: vendorProductIds },
                    rating: 5,
                });
                if (fiveStarExists)
                    await this.awardBadge(userId, 'vendor-five-star');
            }
            if (!badges.includes('vendor-highly-rated') &&
                (vendorProfile.averageRating || 0) >= 4.5 &&
                (vendorProfile.totalReviews || 0) >= 10) {
                await this.awardBadge(userId, 'vendor-highly-rated');
            }
        }
        // ── Login streak (shared logic) ───────────────────────────────
        const streak = user.loginStreak?.currentStreak || 0;
        if (streak >= 3 && !badges.includes('streak-3'))
            await this.awardBadge(userId, 'streak-3');
        if (streak >= 7 && !badges.includes('streak-7'))
            await this.awardBadge(userId, 'streak-7');
        if (streak >= 30 && !badges.includes('streak-30'))
            await this.awardBadge(userId, 'streak-30');
        // ── Verified store ────────────────────────────────────────────
        if (!badges.includes('vendor-verified-store')) {
            await this.awardBadge(userId, 'vendor-verified-store');
        }
        // ── Early vendor (joined within first 6 months of platform) ──
        if (!badges.includes('vendor-early')) {
            const PLATFORM_LAUNCH_DATE = new Date('2026-06-09');
            const earlyVendorCutoff = new Date(PLATFORM_LAUNCH_DATE);
            earlyVendorCutoff.setMonth(earlyVendorCutoff.getMonth() + 6);
            if (user.createdAt <= earlyVendorCutoff) {
                await this.awardBadge(userId, 'vendor-early');
            }
        }
    }
    /**
     * Expire points older than 60 days (lazy — call before any balance read/write)
     */
    async expireOldPoints(userId) {
        const now = new Date();
        const expired = await PointsTransaction_1.default.find({
            user: userId,
            type: 'earn',
            status: 'active',
            expiresAt: { $lt: now },
        });
        if (expired.length === 0)
            return;
        const totalExpired = expired.reduce((sum, tx) => sum + tx.points, 0);
        await PointsTransaction_1.default.updateMany({ _id: { $in: expired.map((t) => t._id) } }, { status: 'expired' });
        // Deduct from user — clamp to 0 to avoid negative points
        await User_1.default.findByIdAndUpdate(userId, {
            $inc: { points: -totalExpired },
        });
        await User_1.default.findOneAndUpdate({ _id: userId, points: { $lt: 0 } }, { points: 0 });
        await PointsTransaction_1.default.create({
            user: userId,
            type: 'expire',
            activity: 'other',
            points: -totalExpired,
            description: `${totalExpired} points expired after ${POINTS_EXPIRY_DAYS} days`,
            status: 'expired',
            metadata: { expiredCount: expired.length },
        });
        logger_1.logger.info(`Expired ${totalExpired} points for user ${userId} (${expired.length} transactions)`);
    }
    /**
     * Award locked points for vendor referral — not usable until vendor's first sale
     */
    async awardVendorReferralPoints(referrerId, vendorId) {
        const REFERRAL_POINTS = 1000;
        await PointsTransaction_1.default.create({
            user: referrerId,
            type: 'earn',
            activity: 'referral',
            points: REFERRAL_POINTS,
            description: 'Vendor referral reward (locked until vendor makes first sale)',
            status: 'locked',
            lockedForVendor: new mongoose_1.Types.ObjectId(vendorId),
            metadata: { vendorId },
        });
        try {
            await notification_service_1.notificationService.pointsEarned(referrerId, REFERRAL_POINTS, 'You referred a vendor! 1,000 points will unlock when they make their first sale.');
        }
        catch (err) {
            logger_1.logger.error('Error sending referral notification:', err);
        }
        logger_1.logger.info(`Locked 1,000 referral points for user ${referrerId} pending vendor ${vendorId} first sale`);
    }
    /**
     * Unlock vendor referral points when the vendor makes their first sale
     */
    async unlockVendorReferralPoints(vendorId) {
        const lockedTx = await PointsTransaction_1.default.findOne({
            lockedForVendor: new mongoose_1.Types.ObjectId(vendorId),
            status: 'locked',
            type: 'earn',
            activity: 'referral',
        });
        if (!lockedTx)
            return;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + POINTS_EXPIRY_DAYS);
        await PointsTransaction_1.default.findByIdAndUpdate(lockedTx._id, {
            status: 'active',
            expiresAt,
            description: 'Vendor referral reward (unlocked — vendor made first sale)',
        });
        await User_1.default.findByIdAndUpdate(lockedTx.user, {
            $inc: { points: lockedTx.points },
        });
        try {
            await notification_service_1.notificationService.pointsEarned(lockedTx.user.toString(), lockedTx.points, `Your vendor referral reward is now active! ${lockedTx.points.toLocaleString()} points added to your balance.`);
        }
        catch (err) {
            logger_1.logger.error('Error sending unlock notification:', err);
        }
        logger_1.logger.info(`Unlocked ${lockedTx.points} referral points for user ${lockedTx.user} (vendor ${vendorId} first sale)`);
    }
    /**
     * Award points after order completion — 1 pt per ₦100 spent
     * Guard: only runs once funds have been released to the vendor (fundsReleased=true),
     * so points are never given for cancelled or still-in-escrow orders.
     */
    async awardOrderPoints(orderId) {
        const order = await Order_1.default.findById(orderId);
        if (!order || order.paymentStatus !== 'completed' || !order.fundsReleased)
            return;
        // Idempotency: bail if points were already awarded for this order
        const alreadyAwarded = await PointsTransaction_1.default.findOne({
            user: order.user,
            activity: 'purchase',
            'metadata.orderId': order._id,
        });
        if (alreadyAwarded)
            return;
        const points = Math.floor(order.total / 100);
        if (points > 0) {
            await this.awardPoints(order.user.toString(), points, 'purchase', `Order ${order.orderNumber}`, { orderId: order._id, orderTotal: order.total });
        }
        await this.checkBadges(order.user.toString());
    }
    /**
     * Award points to a referrer when their referred customer completes their first order
     */
    async awardCustomerReferralPoints(buyerUserId, orderId) {
        const REFERRER_BONUS = 200;
        const buyer = await User_1.default.findById(buyerUserId).select('referredBy');
        if (!buyer?.referredBy)
            return;
        // Only on first completed order
        const completedCount = await Order_1.default.countDocuments({ user: buyerUserId, status: 'delivered' });
        if (completedCount !== 1)
            return;
        // Idempotency: one referral reward per referred user
        const alreadyRewarded = await PointsTransaction_1.default.findOne({
            user: buyer.referredBy,
            activity: 'referral',
            'metadata.referredUserId': buyerUserId,
        });
        if (alreadyRewarded)
            return;
        await this.awardPoints(buyer.referredBy.toString(), REFERRER_BONUS, 'referral', 'Your referral made their first purchase!', { referredUserId: buyerUserId, orderId });
    }
    /** Returns a Date 60 days from now — used to (re)set vCredits expiry */
    vCreditsExpiry() {
        return new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    }
    /**
     * Points → VCredits conversion rate (₦ per point) per tier
     */
    getTierConversionRate(points) {
        if (points >= 10000)
            return 1.00; // Diamond  ₦1.00/pt
        if (points >= 5000)
            return 1.00; // Platinum ₦1.00/pt
        if (points >= 2000)
            return 0.70; // Gold     ₦0.70/pt
        if (points >= 500)
            return 0.50; // Silver   ₦0.50/pt
        return 0.40; // Bronze   ₦0.40/pt
    }
    getTierName(points) {
        if (points >= 10000)
            return 'Diamond';
        if (points >= 5000)
            return 'Platinum';
        if (points >= 2000)
            return 'Gold';
        if (points >= 500)
            return 'Silver';
        return 'Bronze';
    }
}
exports.RewardController = RewardController;
exports.rewardController = new RewardController();
//# sourceMappingURL=reward.controller.js.map