"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyDashboard = exports.deleteApplication = exports.updateApplication = exports.getAmbassadorReferrals = exports.addNote = exports.rejectApplication = exports.approveApplication = exports.getApplication = exports.getAllApplications = exports.verifyInvite = exports.submitApplication = void 0;
exports.getTierRate = getTierRate;
exports.handleVendorProductApproved = handleVendorProductApproved;
exports.handleVendorFirstSale = handleVendorFirstSale;
exports.handleCustomerOrderCompleted = handleCustomerOrderCompleted;
exports.createReferralRecord = createReferralRecord;
const crypto_1 = __importDefault(require("crypto"));
const Ambassador_1 = __importDefault(require("../models/Ambassador"));
const AmbassadorReferral_1 = __importDefault(require("../models/AmbassadorReferral"));
const User_1 = __importDefault(require("../models/User"));
const Additional_1 = require("../models/Additional");
const error_1 = require("../middleware/error");
const email_1 = require("../utils/email");
const logger_1 = require("../utils/logger");
// ─── Tier rate lookup ──────────────────────────────────────────────────────────
// Vendors 1-50: ₦150, 51-100: ₦250, 101-200: ₦300
function getTierRate(ordinalPosition) {
    if (ordinalPosition <= 50)
        return 150;
    if (ordinalPosition <= 100)
        return 250;
    return 300;
}
// ─── Generate unique ambassador code (AMB-XXXX) ───────────────────────────────
async function generateAmbassadorCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const code = `AMB-${suffix}`;
    const exists = await Ambassador_1.default.findOne({ ambassadorCode: code });
    if (exists)
        return generateAmbassadorCode();
    return code;
}
// ─── Public: Submit application from website ──────────────────────────────────
exports.submitApplication = (0, error_1.asyncHandler)(async (req, res) => {
    const { name, email, phone, role, location, social, why } = req.body;
    if (!name || !email || !role || !location || !why) {
        throw new error_1.AppError('Missing required fields', 400);
    }
    const existing = await Ambassador_1.default.findOne({ email: email.toLowerCase(), status: 'pending' });
    if (existing) {
        res.json({ success: true, message: 'Application received' });
        return;
    }
    await Ambassador_1.default.create({ name, email, phone, role, location, social, why });
    logger_1.logger.info(`Ambassador application received: ${email}`);
    res.status(201).json({ success: true, message: 'Application received successfully' });
});
// ─── Public: Verify invite token before signup ────────────────────────────────
exports.verifyInvite = (0, error_1.asyncHandler)(async (req, res) => {
    const { token } = req.query;
    if (!token)
        throw new error_1.AppError('Token is required', 400);
    const hashed = crypto_1.default.createHash('sha256').update(token).digest('hex');
    const ambassador = await Ambassador_1.default
        .findOne({ inviteToken: hashed, inviteTokenExpires: { $gt: new Date() }, status: 'approved' })
        .select('name email ambassadorCode role');
    if (!ambassador)
        throw new error_1.AppError('Invalid or expired invite link', 400);
    if (ambassador.userId)
        throw new error_1.AppError('This invite has already been used', 400);
    res.json({
        success: true,
        data: {
            name: ambassador.name,
            email: ambassador.email,
            ambassadorCode: ambassador.ambassadorCode,
            role: ambassador.role,
        },
    });
});
// ─── Admin: Get all applications ──────────────────────────────────────────────
exports.getAllApplications = (0, error_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { search, status } = req.query;
    const filter = {};
    if (status && ['pending', 'approved', 'rejected'].includes(status))
        filter.status = status;
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { location: { $regex: search, $options: 'i' } },
        ];
    }
    const [applications, total, stats] = await Promise.all([
        Ambassador_1.default.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('-inviteToken'),
        Ambassador_1.default.countDocuments(filter),
        Ambassador_1.default.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
    ]);
    const statsMap = { pending: 0, approved: 0, rejected: 0 };
    stats.forEach((s) => { statsMap[s._id] = s.count; });
    res.json({
        success: true,
        data: { applications, stats: statsMap },
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
});
// ─── Admin: Get single application ───────────────────────────────────────────
exports.getApplication = (0, error_1.asyncHandler)(async (req, res) => {
    const ambassador = await Ambassador_1.default.findById(req.params.id).select('-inviteToken');
    if (!ambassador)
        throw new error_1.AppError('Application not found', 404);
    let referralData = null;
    if (ambassador.userId) {
        const [referredVendors, referredCustomers, referralEarnings] = await Promise.all([
            AmbassadorReferral_1.default.find({ ambassadorId: ambassador.userId, referredUserType: 'vendor' })
                .populate('referredUserId', 'firstName lastName email')
                .sort({ createdAt: -1 })
                .limit(10),
            AmbassadorReferral_1.default.find({ ambassadorId: ambassador.userId, referredUserType: 'customer' })
                .populate('referredUserId', 'firstName lastName email')
                .sort({ createdAt: -1 })
                .limit(10),
            AmbassadorReferral_1.default.aggregate([
                { $match: { ambassadorId: ambassador.userId } },
                { $group: { _id: null, total: { $sum: '$totalEarned' } } },
            ]),
        ]);
        referralData = {
            referredVendors,
            referredCustomers,
            totalEarned: referralEarnings[0]?.total || 0,
        };
    }
    res.json({ success: true, data: { ambassador, referralData } });
});
// ─── Admin: Approve application ───────────────────────────────────────────────
exports.approveApplication = (0, error_1.asyncHandler)(async (req, res) => {
    const ambassador = await Ambassador_1.default.findById(req.params.id);
    if (!ambassador)
        throw new error_1.AppError('Application not found', 404);
    if (ambassador.status === 'approved')
        throw new error_1.AppError('Already approved', 400);
    const ambassadorCode = await generateAmbassadorCode();
    const rawToken = crypto_1.default.randomBytes(32).toString('hex');
    const hashedToken = crypto_1.default.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
    const signupLink = `${frontendUrl}/ambassador-signup?token=${rawToken}`;
    ambassador.status = 'approved';
    ambassador.ambassadorCode = ambassadorCode;
    ambassador.inviteToken = hashedToken;
    ambassador.inviteTokenExpires = expires;
    ambassador.approvedBy = req.user?.id;
    ambassador.approvedAt = new Date();
    await ambassador.save();
    await (0, email_1.sendAmbassadorApprovalEmail)(ambassador.email, ambassador.name, ambassadorCode, signupLink);
    if (process.env.NODE_ENV !== 'production') {
        logger_1.logger.info(`[DEV] Ambassador signup link: ${signupLink}`);
    }
    logger_1.logger.info(`Ambassador approved: ${ambassador.email} | Code: ${ambassadorCode}`);
    res.json({
        success: true,
        message: 'Ambassador approved and invitation email sent',
        data: { ambassadorCode },
    });
});
// ─── Admin: Reject application ────────────────────────────────────────────────
exports.rejectApplication = (0, error_1.asyncHandler)(async (req, res) => {
    const { reason } = req.body;
    const ambassador = await Ambassador_1.default.findById(req.params.id);
    if (!ambassador)
        throw new error_1.AppError('Application not found', 404);
    if (ambassador.status === 'rejected')
        throw new error_1.AppError('Already rejected', 400);
    ambassador.status = 'rejected';
    ambassador.rejectedAt = new Date();
    ambassador.rejectionReason = reason;
    await ambassador.save();
    res.json({ success: true, message: 'Application rejected' });
});
// ─── Admin: Add note ──────────────────────────────────────────────────────────
exports.addNote = (0, error_1.asyncHandler)(async (req, res) => {
    const { text } = req.body;
    if (!text)
        throw new error_1.AppError('Note text is required', 400);
    const ambassador = await Ambassador_1.default.findById(req.params.id);
    if (!ambassador)
        throw new error_1.AppError('Application not found', 404);
    const adminUser = await User_1.default.findById(req.user?.id).select('firstName lastName').lean();
    const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : req.user?.email || 'Admin';
    ambassador.adminNotes.push({
        text,
        createdBy: req.user?.id,
        createdByName: adminName,
        createdAt: new Date(),
    });
    await ambassador.save();
    res.json({ success: true, message: 'Note added' });
});
// ─── Admin: Get referral dashboard for one ambassador ─────────────────────────
exports.getAmbassadorReferrals = (0, error_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { type } = req.query;
    const ambassador = await Ambassador_1.default.findById(req.params.id).select('userId ambassadorCode name');
    if (!ambassador || !ambassador.userId) {
        res.json({ success: true, data: { referrals: [], summary: {} } });
        return;
    }
    const filter = { ambassadorId: ambassador.userId };
    if (type === 'vendor' || type === 'customer')
        filter.referredUserType = type;
    const [referrals, total, summary] = await Promise.all([
        AmbassadorReferral_1.default.find(filter)
            .populate('referredUserId', 'firstName lastName email role createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),
        AmbassadorReferral_1.default.countDocuments(filter),
        AmbassadorReferral_1.default.aggregate([
            { $match: { ambassadorId: ambassador.userId } },
            {
                $group: {
                    _id: '$referredUserType',
                    count: { $sum: 1 },
                    totalEarned: { $sum: '$totalEarned' },
                    qualifiedCount: {
                        $sum: { $cond: [{ $gte: ['$partialCount', 1] }, 1, 0] },
                    },
                    partialSum: { $sum: '$partialCount' },
                },
            },
        ]),
    ]);
    const summaryMap = {};
    summary.forEach((s) => { summaryMap[s._id] = s; });
    const vendorPartialSum = summaryMap.vendor?.partialSum || 0;
    const nextMilestone = vendorPartialSum < 20 ? 20
        : vendorPartialSum < 50 ? 50
            : vendorPartialSum < 100 ? 100
                : vendorPartialSum < 200 ? 200
                    : null;
    const milestoneTarget = nextMilestone === 20 ? 3000
        : nextMilestone === 50 ? 7500
            : nextMilestone === 100 ? 20000
                : nextMilestone === 200 ? 50000
                    : null;
    res.json({
        success: true,
        data: {
            referrals,
            summaryByType: summaryMap,
            milestone: {
                current: Math.round(vendorPartialSum * 10) / 10,
                next: nextMilestone,
                reward: milestoneTarget,
            },
        },
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
});
// ─── Admin: Edit application ──────────────────────────────────────────────────
exports.updateApplication = (0, error_1.asyncHandler)(async (req, res) => {
    const { name, email, phone, location, social, role, status } = req.body;
    const ambassador = await Ambassador_1.default.findById(req.params.id);
    if (!ambassador)
        throw new error_1.AppError('Application not found', 404);
    if (name !== undefined)
        ambassador.name = name.trim();
    if (email !== undefined)
        ambassador.email = email.toLowerCase().trim();
    if (phone !== undefined)
        ambassador.phone = phone;
    if (location !== undefined)
        ambassador.location = location.trim();
    if (social !== undefined)
        ambassador.social = social;
    if (role && ['student', 'state'].includes(role))
        ambassador.role = role;
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
        ambassador.status = status;
    }
    await ambassador.save();
    logger_1.logger.info(`Ambassador updated: ${ambassador.email} by admin ${req.user?.id}`);
    res.json({ success: true, message: 'Ambassador updated', data: { ambassador } });
});
// ─── Admin: Delete application ────────────────────────────────────────────────
exports.deleteApplication = (0, error_1.asyncHandler)(async (req, res) => {
    const ambassador = await Ambassador_1.default.findById(req.params.id);
    if (!ambassador)
        throw new error_1.AppError('Application not found', 404);
    if (ambassador.userId) {
        await AmbassadorReferral_1.default.deleteMany({ ambassadorId: ambassador.userId });
    }
    await ambassador.deleteOne();
    logger_1.logger.info(`Ambassador deleted: ${ambassador.email} by admin ${req.user?.id}`);
    res.json({ success: true, message: 'Ambassador deleted' });
});
// ─── Ambassador: Own dashboard ────────────────────────────────────────────────
exports.getMyDashboard = (0, error_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.id;
    const ambassador = await Ambassador_1.default.findOne({ userId }).select('ambassadorCode role name status approvedAt');
    if (!ambassador)
        throw new error_1.AppError('Ambassador profile not found', 404);
    const [vendors, customers] = await Promise.all([
        AmbassadorReferral_1.default.find({ ambassadorId: userId, referredUserType: 'vendor' })
            .populate('referredUserId', 'firstName lastName email createdAt')
            .sort({ createdAt: -1 }),
        AmbassadorReferral_1.default.find({ ambassadorId: userId, referredUserType: 'customer' })
            .populate('referredUserId', 'firstName lastName email createdAt')
            .sort({ createdAt: -1 }),
    ]);
    const vendorPartialSum = vendors.reduce((sum, v) => sum + (v.partialCount || 0), 0);
    const vendorEarned = vendors.reduce((sum, v) => sum + (v.totalEarned || 0), 0);
    const customerEarned = customers.reduce((sum, c) => sum + (c.totalEarned || 0), 0);
    const nextMilestone = vendorPartialSum < 20 ? 20
        : vendorPartialSum < 50 ? 50
            : vendorPartialSum < 100 ? 100
                : vendorPartialSum < 200 ? 200
                    : null;
    const milestoneReward = nextMilestone === 20 ? 3000
        : nextMilestone === 50 ? 7500
            : nextMilestone === 100 ? 20000
                : nextMilestone === 200 ? 50000
                    : null;
    res.json({
        success: true,
        data: {
            ambassador,
            milestone: {
                current: Math.round(vendorPartialSum * 10) / 10,
                next: nextMilestone,
                reward: milestoneReward,
                targets: [
                    { count: 20, reward: 3000 },
                    { count: 50, reward: 7500 },
                    { count: 100, reward: 20000 },
                    { count: 200, reward: 50000 },
                ],
            },
            vendors,
            customers,
            summary: {
                totalVendors: vendors.length,
                totalCustomers: customers.length,
                vendorEarned,
                customerEarned,
                totalEarned: vendorEarned + customerEarned,
            },
        },
    });
});
// ─── Ambassador commission service (called by other controllers) ───────────────
/**
 * Called when a vendor's product is approved AND vendor account is verified.
 * Checks if this vendor was referred by an ambassador. If so, credits 40% commission.
 */
async function handleVendorProductApproved(vendorUserId) {
    try {
        const referral = await AmbassadorReferral_1.default.findOne({
            referredUserId: vendorUserId,
            referredUserType: 'vendor',
            stage40Reached: false,
        });
        if (!referral)
            return;
        // Verify vendor account is also active/verified
        const vendor = await User_1.default.findById(vendorUserId).select('status emailVerified');
        if (!vendor || vendor.status !== 'active' || !vendor.emailVerified)
            return;
        const commissionAmount = Math.round(referral.tierRate * 0.4 * 100) / 100;
        referral.stage40Reached = true;
        referral.partialCount = 0.4;
        referral.commission40Amount = commissionAmount;
        referral.commission40PaidAt = new Date();
        referral.totalEarned += commissionAmount;
        await referral.save();
        await creditAmbassadorWallet(referral.ambassadorId.toString(), commissionAmount, `Ambassador vendor referral (40%) — vendor ${vendorUserId} approved with product`);
        logger_1.logger.info(`Ambassador 40% commission: ₦${commissionAmount} → ${referral.ambassadorId}`);
    }
    catch (err) {
        logger_1.logger.error('Error processing ambassador 40% commission:', err);
    }
}
/**
 * Called when a vendor makes their first completed sale.
 * Releases the remaining 60% commission to their referring ambassador.
 */
async function handleVendorFirstSale(vendorUserId) {
    try {
        const referral = await AmbassadorReferral_1.default.findOne({
            referredUserId: vendorUserId,
            referredUserType: 'vendor',
            stage40Reached: true,
            stage60Reached: false,
        });
        if (!referral)
            return;
        const commissionAmount = Math.round(referral.tierRate * 0.6 * 100) / 100;
        referral.stage60Reached = true;
        referral.partialCount = 1.0;
        referral.commission60Amount = commissionAmount;
        referral.commission60PaidAt = new Date();
        referral.totalEarned += commissionAmount;
        await referral.save();
        await creditAmbassadorWallet(referral.ambassadorId.toString(), commissionAmount, `Ambassador vendor referral (60%) — vendor ${vendorUserId} first sale`);
        logger_1.logger.info(`Ambassador 60% commission: ₦${commissionAmount} → ${referral.ambassadorId}`);
    }
    catch (err) {
        logger_1.logger.error('Error processing ambassador 60% commission:', err);
    }
}
/**
 * Called when a customer's order is completed.
 * Awards 3% commission on the customer's first 3 completed orders if they were referred by an ambassador.
 */
async function handleCustomerOrderCompleted(customerUserId, orderId, orderAmount) {
    try {
        const referral = await AmbassadorReferral_1.default.findOne({
            referredUserId: customerUserId,
            referredUserType: 'customer',
        });
        if (!referral)
            return;
        if (referral.customerOrdersTracked.length >= 3)
            return;
        const alreadyTracked = referral.customerOrdersTracked.some((r) => r.orderId.toString() === orderId);
        if (alreadyTracked)
            return;
        const commissionAmount = Math.round(orderAmount * 0.03 * 100) / 100;
        referral.customerOrdersTracked.push({
            orderId: orderId,
            orderAmount,
            commissionAmount,
            paidAt: new Date(),
        });
        referral.totalEarned += commissionAmount;
        await referral.save();
        await creditAmbassadorWallet(referral.ambassadorId.toString(), commissionAmount, `Ambassador customer referral commission (3%) — order ${orderId}`);
        logger_1.logger.info(`Ambassador customer commission: ₦${commissionAmount} → ${referral.ambassadorId}`);
    }
    catch (err) {
        logger_1.logger.error('Error processing ambassador customer commission:', err);
    }
}
/**
 * Creates an AmbassadorReferral record when a referred user registers.
 * Determines ordinalPosition and tierRate for vendor referrals.
 */
async function createReferralRecord(ambassadorUserId, referredUserId, referredUserType) {
    try {
        const existing = await AmbassadorReferral_1.default.findOne({
            ambassadorId: ambassadorUserId,
            referredUserId,
        });
        if (existing)
            return;
        let ordinalPosition;
        let tierRate;
        if (referredUserType === 'vendor') {
            const existingCount = await AmbassadorReferral_1.default.countDocuments({
                ambassadorId: ambassadorUserId,
                referredUserType: 'vendor',
            });
            ordinalPosition = existingCount + 1;
            tierRate = getTierRate(ordinalPosition);
        }
        await AmbassadorReferral_1.default.create({
            ambassadorId: ambassadorUserId,
            referredUserId,
            referredUserType,
            ordinalPosition,
            tierRate,
        });
        logger_1.logger.info(`Ambassador referral recorded: ${ambassadorUserId} → ${referredUserId} (${referredUserType})`);
    }
    catch (err) {
        logger_1.logger.error('Error creating ambassador referral record:', err);
    }
}
// ─── Internal: Credit ambassador wallet ──────────────────────────────────────
async function creditAmbassadorWallet(ambassadorUserId, amount, description) {
    await Additional_1.Wallet.findOneAndUpdate({ user: ambassadorUserId }, {
        $inc: { balance: amount, totalEarned: amount },
        $push: {
            transactions: {
                type: 'credit',
                amount,
                purpose: 'ambassador_commission',
                reference: `amb_${ambassadorUserId}_${Date.now()}`,
                description,
                status: 'completed',
                timestamp: new Date(),
            },
        },
    }, { upsert: true });
}
//# sourceMappingURL=ambassador.controller.js.map