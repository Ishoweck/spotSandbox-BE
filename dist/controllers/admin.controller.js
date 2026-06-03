"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCoupon = exports.updateCoupon = exports.createCoupon = exports.getAllCoupons = exports.closeDispute = exports.addDisputeMessage = exports.resolveDispute = exports.markDisputeUnderReview = exports.getDisputeDetails = exports.getAllDisputes = exports.deleteReview = exports.updateReviewStatus = exports.getReviewById = exports.getAllReviews = exports.resolveVendorWallet = exports.processWithdrawal = exports.getPendingWithdrawals = exports.getTransactionById = exports.getAllTransactions = exports.getFinancialOverview = exports.processRefund = exports.addAdminNote = exports.updateOrderStatus = exports.getOrderDetails = exports.getAllOrders = exports.deleteProduct = exports.toggleProductFeatured = exports.updateProductStatus = exports.getProductDetails = exports.getAllProducts = exports.updateVendorCommission = exports.toggleVendorPremium = exports.toggleVendorStatus = exports.verifyVendor = exports.getVendorDetails = exports.fixLegacyCommissionRates = exports.getAllVendors = exports.deleteUser = exports.updateUserRole = exports.updateUserStatus = exports.getUserDetails = exports.getAllUsers = exports.removeAdmin = exports.updateAdminRole = exports.getAllAdmins = exports.createAdmin = exports.getOrderAnalytics = exports.getUserAnalytics = exports.getRevenueAnalytics = exports.getDashboard = void 0;
exports.getChallengeLeaderboard = exports.getPointsTransactions = exports.adjustUserPoints = exports.getRewardsUsers = exports.getRewardsOverview = exports.updateAppVersionConfig = exports.getAppVersionConfig = exports.globalSearch = exports.getActivityLog = exports.getProductReport = exports.getVendorReport = exports.getSalesReport = exports.deleteChallenge = exports.updateChallenge = exports.createChallenge = exports.getAllChallenges = exports.toggleAffiliateStatus = exports.getAffiliateLinks = exports.getAllAffiliates = exports.adminCreateDeletionRequest = exports.rejectAccountDeletion = exports.approveAccountDeletion = exports.getAccountDeletionRequests = exports.getNotificationHistory = exports.broadcastNotification = exports.toggleCategoryStatus = exports.deleteCategory = exports.updateCategory = exports.createCategory = exports.getAllCategories = exports.toggleCouponActive = exports.getCouponUsage = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const types_1 = require("../types");
const User_1 = __importDefault(require("../models/User"));
const Product_1 = __importDefault(require("../models/Product"));
const Order_1 = __importDefault(require("../models/Order"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const Category_1 = __importDefault(require("../models/Category"));
const Review_1 = __importDefault(require("../models/Review"));
const Dispute_1 = __importDefault(require("../models/Dispute"));
const Wallet_1 = __importDefault(require("../models/Wallet"));
const AccountDeletionRequest_1 = __importDefault(require("../models/AccountDeletionRequest"));
const PointsTransaction_1 = __importDefault(require("../models/PointsTransaction"));
const Additional_1 = require("../models/Additional");
const notification_service_1 = require("../services/notification.service");
const email_1 = require("../utils/email");
const email_queue_1 = require("../utils/email-queue");
const firebase_1 = require("../config/firebase");
const helpers_1 = require("../utils/helpers");
const ayncHandler_1 = require("../utils/ayncHandler");
const logger_1 = require("../utils/logger");
const AppVersion_1 = __importDefault(require("../models/AppVersion"));
// ================================================================
// DASHBOARD & ANALYTICS
// ================================================================
/**
 * GET /admin/dashboard
 * Platform overview stats - accessible by all admin roles
 */
exports.getDashboard = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const [totalUsers, totalVendors, totalProducts, totalOrders, activeUsers, pendingVendors, pendingProducts, openDisputes, recentOrders, totalRevenue, pendingWithdrawals,] = await Promise.all([
        User_1.default.countDocuments(),
        VendorProfile_1.default.countDocuments(),
        Product_1.default.countDocuments(),
        Order_1.default.countDocuments(),
        User_1.default.countDocuments({ status: types_1.UserStatus.ACTIVE }),
        VendorProfile_1.default.countDocuments({ verificationStatus: types_1.VendorVerificationStatus.PENDING }),
        Product_1.default.countDocuments({ status: types_1.ProductStatus.PENDING_APPROVAL }),
        Dispute_1.default.countDocuments({ status: { $in: ['open', 'vendor_responded', 'under_review'] } }),
        Order_1.default.find().sort({ createdAt: -1 }).limit(10).populate('user', 'firstName lastName email'),
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED } },
            { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        Wallet_1.default.aggregate([
            { $unwind: '$transactions' },
            {
                $match: {
                    'transactions.purpose': types_1.WalletPurpose.WITHDRAWAL,
                    'transactions.status': 'pending',
                },
            },
            { $count: 'count' },
        ]),
    ]);
    // Orders by status
    const ordersByStatus = await Order_1.default.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    // Users by role
    const usersByRole = await User_1.default.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    // Today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [todayOrders, todayRevenue, todaySignups] = await Promise.all([
        Order_1.default.countDocuments({ createdAt: { $gte: today } }),
        Order_1.default.aggregate([
            { $match: { createdAt: { $gte: today }, paymentStatus: types_1.PaymentStatus.COMPLETED } },
            { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        User_1.default.countDocuments({ createdAt: { $gte: today } }),
    ]);
    res.json({
        success: true,
        data: {
            overview: {
                totalUsers,
                activeUsers,
                totalVendors,
                pendingVendors,
                totalProducts,
                pendingProducts,
                totalOrders,
                openDisputes,
                totalRevenue: totalRevenue[0]?.total || 0,
                pendingWithdrawals: pendingWithdrawals[0]?.count || 0,
            },
            today: {
                orders: todayOrders,
                revenue: todayRevenue[0]?.total || 0,
                signups: todaySignups,
            },
            ordersByStatus: ordersByStatus.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
            usersByRole: usersByRole.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
            recentOrders,
        },
    });
});
/**
 * GET /admin/analytics/revenue
 * Revenue analytics with date range
 */
exports.getRevenueAnalytics = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { period = '30d', startDate, endDate } = req.query;
    let dateFilter = {};
    const now = new Date();
    if (startDate && endDate) {
        dateFilter = {
            createdAt: {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
            },
        };
    }
    else {
        const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
        const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        dateFilter = { createdAt: { $gte: from } };
    }
    const [dailyRevenue, revenueByPaymentMethod, topVendorsByRevenue, refundTotal] = await Promise.all([
        Order_1.default.aggregate([
            { $match: { ...dateFilter, paymentStatus: types_1.PaymentStatus.COMPLETED } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    revenue: { $sum: '$total' },
                    orders: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        Order_1.default.aggregate([
            { $match: { ...dateFilter, paymentStatus: types_1.PaymentStatus.COMPLETED } },
            {
                $group: {
                    _id: '$paymentMethod',
                    revenue: { $sum: '$total' },
                    count: { $sum: 1 },
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: { ...dateFilter, paymentStatus: types_1.PaymentStatus.COMPLETED } },
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.vendor',
                    revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                    orders: { $sum: 1 },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'vendorprofiles',
                    localField: '_id',
                    foreignField: 'user',
                    as: 'vendor',
                },
            },
            { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    vendorId: '$_id',
                    businessName: '$vendor.businessName',
                    revenue: 1,
                    orders: 1,
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: { ...dateFilter, status: types_1.OrderStatus.REFUNDED } },
            { $group: { _id: null, total: { $sum: '$refundAmount' } } },
        ]),
    ]);
    const totalRevenue = dailyRevenue.reduce((sum, day) => sum + day.revenue, 0);
    const totalOrders = dailyRevenue.reduce((sum, day) => sum + day.orders, 0);
    res.json({
        success: true,
        data: {
            summary: {
                totalRevenue,
                totalOrders,
                averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
                totalRefunds: refundTotal[0]?.total || 0,
            },
            dailyRevenue,
            revenueByPaymentMethod,
            topVendorsByRevenue,
        },
    });
});
/**
 * GET /admin/analytics/users
 * User growth analytics
 */
exports.getUserAnalytics = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { period = '30d' } = req.query;
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [dailySignups, usersByStatus, usersByRole, topBuyers] = await Promise.all([
        User_1.default.aggregate([
            { $match: { createdAt: { $gte: from } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        User_1.default.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        User_1.default.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED } },
            {
                $group: {
                    _id: '$user',
                    totalSpent: { $sum: '$total' },
                    orderCount: { $sum: 1 },
                },
            },
            { $sort: { totalSpent: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            { $unwind: '$user' },
            {
                $project: {
                    userId: '$_id',
                    firstName: '$user.firstName',
                    lastName: '$user.lastName',
                    email: '$user.email',
                    totalSpent: 1,
                    orderCount: 1,
                },
            },
        ]),
    ]);
    res.json({
        success: true,
        data: {
            dailySignups,
            usersByStatus: usersByStatus.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
            usersByRole: usersByRole.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
            topBuyers,
        },
    });
});
/**
 * GET /admin/analytics/orders
 * Order analytics
 */
exports.getOrderAnalytics = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { period = '30d' } = req.query;
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [dailyOrders, ordersByStatus, ordersByPaymentMethod, averageOrderValue] = await Promise.all([
        Order_1.default.aggregate([
            { $match: { createdAt: { $gte: from } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 },
                    revenue: { $sum: '$total' },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        Order_1.default.aggregate([
            { $match: { createdAt: { $gte: from } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Order_1.default.aggregate([
            { $match: { createdAt: { $gte: from } } },
            { $group: { _id: '$paymentMethod', count: { $sum: 1 } } },
        ]),
        Order_1.default.aggregate([
            {
                $match: {
                    createdAt: { $gte: from },
                    paymentStatus: types_1.PaymentStatus.COMPLETED,
                },
            },
            { $group: { _id: null, avg: { $avg: '$total' } } },
        ]),
    ]);
    res.json({
        success: true,
        data: {
            dailyOrders,
            ordersByStatus: ordersByStatus.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
            ordersByPaymentMethod: ordersByPaymentMethod.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
            averageOrderValue: averageOrderValue[0]?.avg || 0,
        },
    });
});
// ================================================================
// ADMIN MANAGEMENT (SUPER_ADMIN ONLY)
// ================================================================
/**
 * POST /admin/admins/create
 * Create a new admin account
 */
exports.createAdmin = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { firstName, lastName, email, password, phone, role } = req.body;
    if (!firstName || !lastName || !email || !password) {
        res.status(400).json({
            success: false,
            message: 'firstName, lastName, email, and password are required',
        });
        return;
    }
    const validAdminRoles = [
        types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN,
        types_1.UserRole.SUPPORT_ADMIN, types_1.UserRole.CONTENT_ADMIN, types_1.UserRole.KYC_ADMIN, types_1.UserRole.MARKETING_ADMIN,
    ];
    if (role && !validAdminRoles.includes(role)) {
        res.status(400).json({
            success: false,
            message: `Invalid admin role. Must be one of: ${validAdminRoles.join(', ')}`,
        });
        return;
    }
    const existingUser = await User_1.default.findOne({ email: email.toLowerCase() });
    if (existingUser) {
        res.status(409).json({
            success: false,
            message: 'User with this email already exists',
        });
        return;
    }
    const admin = await User_1.default.create({
        firstName,
        lastName,
        email: email.toLowerCase(),
        password,
        phone,
        role: role || types_1.UserRole.ADMIN,
        status: types_1.UserStatus.ACTIVE,
        emailVerified: true,
    });
    res.status(201).json({
        success: true,
        message: 'Admin account created successfully',
        data: {
            id: admin._id,
            firstName: admin.firstName,
            lastName: admin.lastName,
            email: admin.email,
            role: admin.role,
            status: admin.status,
        },
    });
});
/**
 * GET /admin/admins
 * List all admin users
 */
exports.getAllAdmins = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const admins = await User_1.default.find({
        role: {
            $in: [
                types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN,
                types_1.UserRole.SUPPORT_ADMIN, types_1.UserRole.CONTENT_ADMIN, types_1.UserRole.KYC_ADMIN, types_1.UserRole.MARKETING_ADMIN,
            ],
        },
    })
        .select('-password -otp -resetPasswordToken -resetPasswordExpires -fcmTokens')
        .sort({ createdAt: -1 });
    res.json({
        success: true,
        data: admins,
        meta: { total: admins.length },
    });
});
/**
 * PUT /admin/admins/:id/role
 * Update an admin's role
 */
exports.updateAdminRole = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    const validAdminRoles = [
        types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN,
        types_1.UserRole.SUPPORT_ADMIN, types_1.UserRole.CONTENT_ADMIN, types_1.UserRole.KYC_ADMIN, types_1.UserRole.MARKETING_ADMIN,
    ];
    if (!validAdminRoles.includes(role)) {
        res.status(400).json({
            success: false,
            message: `Invalid role. Must be one of: ${validAdminRoles.join(', ')}`,
        });
        return;
    }
    if (id === req.user.id) {
        res.status(400).json({
            success: false,
            message: 'You cannot change your own role',
        });
        return;
    }
    const admin = await User_1.default.findById(id);
    if (!admin) {
        res.status(404).json({ success: false, message: 'Admin not found' });
        return;
    }
    const currentAdminRoles = [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN, types_1.UserRole.SUPPORT_ADMIN, types_1.UserRole.CONTENT_ADMIN, types_1.UserRole.KYC_ADMIN, types_1.UserRole.MARKETING_ADMIN];
    if (!currentAdminRoles.includes(admin.role)) {
        res.status(400).json({
            success: false,
            message: 'Target user is not an admin',
        });
        return;
    }
    admin.role = role;
    await admin.save();
    res.json({
        success: true,
        message: `Admin role updated to ${role}`,
        data: {
            id: admin._id,
            firstName: admin.firstName,
            lastName: admin.lastName,
            email: admin.email,
            role: admin.role,
        },
    });
});
/**
 * DELETE /admin/admins/:id
 * Remove admin privileges (reverts to customer)
 */
exports.removeAdmin = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    if (id === req.user.id) {
        res.status(400).json({
            success: false,
            message: 'You cannot remove your own admin privileges',
        });
        return;
    }
    const admin = await User_1.default.findById(id);
    if (!admin) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    const adminRoles = [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN, types_1.UserRole.SUPPORT_ADMIN, types_1.UserRole.CONTENT_ADMIN, types_1.UserRole.KYC_ADMIN, types_1.UserRole.MARKETING_ADMIN];
    if (!adminRoles.includes(admin.role)) {
        res.status(400).json({
            success: false,
            message: 'Target user is not an admin',
        });
        return;
    }
    admin.role = types_1.UserRole.CUSTOMER;
    await admin.save();
    res.json({
        success: true,
        message: 'Admin privileges removed. User reverted to customer role.',
    });
});
// ================================================================
// USER MANAGEMENT
// ================================================================
/**
 * GET /admin/users
 * List all users with filtering, pagination, search
 */
exports.getAllUsers = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, role, status, search, sort = 'createdAt', order = 'desc', } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (role)
        filter.role = role;
    if (status)
        filter.status = status;
    if (search) {
        filter.$or = [
            { firstName: { $regex: escapeRegex(search), $options: 'i' } },
            { lastName: { $regex: escapeRegex(search), $options: 'i' } },
            { email: { $regex: escapeRegex(search), $options: 'i' } },
            { phone: { $regex: escapeRegex(search), $options: 'i' } },
        ];
    }
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [users, total] = await Promise.all([
        User_1.default.find(filter)
            .select('-password -otp -resetPasswordToken -resetPasswordExpires')
            .sort(sortObj)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        User_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: users,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * GET /admin/users/:id
 * Get detailed user info including wallet, orders, vendor profile
 */
exports.getUserDetails = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const userId = new mongoose_1.default.Types.ObjectId(id);
    const now = new Date();
    const [user, wallet, orderStats, vendorProfile, pointsSummary, recentOrders, assignedCoupons, lastActivities, recentReviews] = await Promise.all([
        User_1.default.findById(id).select('-password -otp -resetPasswordToken -resetPasswordExpires'),
        Wallet_1.default.findOne({ user: id }),
        Order_1.default.aggregate([
            { $match: { user: userId } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalSpent: { $sum: '$total' },
                    completedOrders: {
                        $sum: { $cond: [{ $eq: ['$status', types_1.OrderStatus.DELIVERED] }, 1, 0] },
                    },
                    cancelledOrders: {
                        $sum: { $cond: [{ $eq: ['$status', types_1.OrderStatus.CANCELLED] }, 1, 0] },
                    },
                },
            },
        ]),
        VendorProfile_1.default.findOne({ user: id }),
        PointsTransaction_1.default.aggregate([
            { $match: { user: userId } },
            {
                $group: {
                    _id: '$type',
                    total: { $sum: '$points' },
                    count: { $sum: 1 },
                },
            },
        ]),
        Order_1.default.find({ user: id })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('orderNumber total status paymentStatus createdAt items')
            .lean(),
        Additional_1.Coupon.find({
            assignedTo: userId,
            isActive: true,
            validUntil: { $gte: now },
            usedBy: { $ne: userId },
        })
            .select('code discountType discountValue minPurchase maxDiscount validUntil description')
            .lean(),
        // Last 10 activity records (login, purchase, review, referral, redemption, etc.)
        PointsTransaction_1.default.find({ user: userId })
            .sort({ createdAt: -1 })
            .limit(10)
            .select('type activity points description createdAt status')
            .lean(),
        // Last 3 reviews written by this user
        Review_1.default.find({ user: userId })
            .sort({ createdAt: -1 })
            .limit(3)
            .populate('product', 'name images')
            .select('rating title comment status createdAt product')
            .lean(),
    ]);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    // Referral info: who referred this user + how many they've referred
    const [referredByUser, referralsCount] = await Promise.all([
        user.referredBy
            ? User_1.default.findById(user.referredBy).select('firstName lastName email').lean()
            : null,
        User_1.default.countDocuments({ referredBy: id }),
    ]);
    // Points summary map
    const pointsMap = Object.fromEntries(pointsSummary.map((p) => [p._id, { total: p.total, count: p.count }]));
    res.json({
        success: true,
        data: {
            user,
            wallet: wallet
                ? {
                    balance: wallet.balance,
                    vCredits: wallet.vCredits,
                    vCreditsExpiresAt: wallet.vCreditsExpiresAt,
                    totalEarned: wallet.totalEarned,
                    totalSpent: wallet.totalSpent,
                    totalWithdrawn: wallet.totalWithdrawn,
                    pendingBalance: wallet.pendingBalance,
                }
                : null,
            orderStats: orderStats[0] || { totalOrders: 0, totalSpent: 0, completedOrders: 0, cancelledOrders: 0 },
            vendorProfile,
            pointsSummary: {
                earned: pointsMap['earn'] ?? { total: 0, count: 0 },
                spent: pointsMap['spend'] ?? { total: 0, count: 0 },
                expired: pointsMap['expire'] ?? { total: 0, count: 0 },
                balance: user.points ?? 0,
            },
            recentOrders,
            assignedCoupons,
            lastActivities,
            recentReviews,
            referralInfo: {
                referredBy: referredByUser ?? null,
                referralsCount,
            },
        },
    });
});
/**
 * PUT /admin/users/:id/status
 * Update user status (active, suspended, inactive)
 */
exports.updateUserStatus = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body;
    if (!Object.values(types_1.UserStatus).includes(status)) {
        res.status(400).json({
            success: false,
            message: `Invalid status. Must be one of: ${Object.values(types_1.UserStatus).join(', ')}`,
        });
        return;
    }
    const user = await User_1.default.findById(id);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    // Prevent modifying super admins unless you're a super admin
    if (user.role === types_1.UserRole.SUPER_ADMIN && req.user.role !== types_1.UserRole.SUPER_ADMIN) {
        res.status(403).json({
            success: false,
            message: 'Only super admins can modify other super admins',
        });
        return;
    }
    user.status = status;
    await user.save();
    // Notify user
    await notification_service_1.notificationService.send({
        userId: id,
        type: types_1.NotificationType.ACCOUNT,
        title: 'Account Status Updated',
        message: status === types_1.UserStatus.SUSPENDED
            ? `Your account has been suspended.${reason ? ` Reason: ${reason}` : ''}`
            : `Your account status has been updated to ${status}.`,
    });
    res.json({
        success: true,
        message: `User status updated to ${status}`,
        data: { id: user._id, status: user.status },
    });
});
/**
 * PUT /admin/users/:id/role
 * Update user role (SUPER_ADMIN only)
 */
exports.updateUserRole = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!Object.values(types_1.UserRole).includes(role)) {
        res.status(400).json({
            success: false,
            message: `Invalid role. Must be one of: ${Object.values(types_1.UserRole).join(', ')}`,
        });
        return;
    }
    if (id === req.user.id) {
        res.status(400).json({
            success: false,
            message: 'You cannot change your own role',
        });
        return;
    }
    const user = await User_1.default.findById(id);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    user.role = role;
    await user.save();
    res.json({
        success: true,
        message: `User role updated to ${role}`,
        data: { id: user._id, role: user.role },
    });
});
/**
 * DELETE /admin/users/:id
 * Delete a user account
 */
exports.deleteUser = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    if (id === req.user.id) {
        res.status(400).json({
            success: false,
            message: 'You cannot delete your own account from here',
        });
        return;
    }
    const user = await User_1.default.findById(id);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    // Prevent deleting any admin account unless you're a super admin
    if ((user.role === types_1.UserRole.SUPER_ADMIN || user.role === types_1.UserRole.ADMIN) &&
        req.user.role !== types_1.UserRole.SUPER_ADMIN) {
        res.status(403).json({
            success: false,
            message: 'Only super admins can delete admin accounts',
        });
        return;
    }
    // Check for pending orders
    const pendingOrders = await Order_1.default.countDocuments({
        user: id,
        status: { $in: [types_1.OrderStatus.PENDING, types_1.OrderStatus.CONFIRMED, types_1.OrderStatus.PROCESSING, types_1.OrderStatus.SHIPPED] },
    });
    if (pendingOrders > 0) {
        res.status(400).json({
            success: false,
            message: `Cannot delete user with ${pendingOrders} pending order(s). Resolve them first.`,
        });
        return;
    }
    await User_1.default.findByIdAndDelete(id);
    // Clean up related data
    await Promise.all([
        Wallet_1.default.findOneAndDelete({ user: id }),
        Additional_1.Notification.deleteMany({ user: id }),
        PointsTransaction_1.default.deleteMany({ user: id }),
    ]);
    res.json({
        success: true,
        message: 'User deleted successfully',
    });
});
// ================================================================
// VENDOR MANAGEMENT
// ================================================================
/**
 * GET /admin/vendors
 * List all vendors with filtering
 */
exports.getAllVendors = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status, search, sort = 'createdAt', order = 'desc', } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (status)
        filter.verificationStatus = status;
    if (req.query.hasKyc === 'true') {
        filter['kycDocuments.0'] = { $exists: true };
    }
    if (search) {
        filter.$or = [
            { businessName: { $regex: escapeRegex(search), $options: 'i' } },
            { businessEmail: { $regex: escapeRegex(search), $options: 'i' } },
        ];
    }
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [vendors, total] = await Promise.all([
        VendorProfile_1.default.find(filter)
            .populate('user', 'firstName lastName email phone status')
            .sort(sortObj)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        VendorProfile_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: vendors,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * POST /admin/vendors/fix-commission-rates
 * One-time migration: set all non-premium vendors with legacy 5% default to 8%
 */
exports.fixLegacyCommissionRates = (0, ayncHandler_1.asyncHandler)(async (_req, res) => {
    const result = await VendorProfile_1.default.updateMany({ isPremium: false, commissionRate: 5 }, { $set: { commissionRate: 8 } });
    res.json({
        success: true,
        message: `Fixed ${result.modifiedCount} vendor commission rates from 5% to 8%`,
        data: { modifiedCount: result.modifiedCount },
    });
});
/**
 * GET /admin/vendors/:id
 * Get detailed vendor profile with analytics
 */
exports.getVendorDetails = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const vendor = await VendorProfile_1.default.findById(id).populate('user', 'firstName lastName email phone status avatar createdAt');
    if (!vendor) {
        res.status(404).json({ success: false, message: 'Vendor not found' });
        return;
    }
    const vendorUserId = vendor.user._id;
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const [productStats, orderStats, orderStatusBreakdown, recentOrders, wallet, openDisputesCount, topProducts, monthlyRevenue, vendorProductIds, vendorProducts,] = await Promise.all([
        Product_1.default.aggregate([
            { $match: { vendor: vendorUserId } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Order_1.default.aggregate([
            { $match: { 'items.vendor': vendorUserId } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalRevenue: { $sum: '$total' },
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: { 'items.vendor': vendorUserId } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Order_1.default.find({ 'items.vendor': vendorUserId })
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('user', 'firstName lastName')
            .select('orderNumber total status paymentStatus createdAt user')
            .lean(),
        Wallet_1.default.findOne({ user: vendorUserId }),
        Dispute_1.default.countDocuments({
            vendor: vendorUserId,
            status: { $in: ['open', 'vendor_responded', 'under_review'] },
        }),
        // Top 5 products by revenue
        Order_1.default.aggregate([
            { $match: { 'items.vendor': vendorUserId } },
            { $unwind: '$items' },
            { $match: { 'items.vendor': vendorUserId } },
            {
                $group: {
                    _id: '$items.product',
                    productName: { $first: '$items.productName' },
                    totalQuantity: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                    orderCount: { $sum: 1 },
                },
            },
            { $sort: { totalRevenue: -1 } },
            { $limit: 5 },
        ]),
        // Monthly revenue – last 6 months
        Order_1.default.aggregate([
            {
                $match: {
                    'items.vendor': vendorUserId,
                    paymentStatus: types_1.PaymentStatus.COMPLETED,
                    createdAt: { $gte: sixMonthsAgo },
                },
            },
            {
                $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    revenue: { $sum: '$total' },
                    orders: { $sum: 1 },
                },
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),
        Product_1.default.distinct('_id', { vendor: vendorUserId }),
        // Full product list for this vendor
        Product_1.default.find({ vendor: vendorUserId })
            .select('name images price status averageRating totalReviews slug category createdAt')
            .populate('category', 'name')
            .sort({ createdAt: -1 })
            .limit(50)
            .lean(),
    ]);
    const recentReviews = await Review_1.default.find({ product: { $in: vendorProductIds } })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'firstName lastName avatar')
        .populate('product', 'name images')
        .select('rating title comment status createdAt vendorResponse')
        .lean();
    const statusBreakdown = orderStatusBreakdown.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {});
    const totalOrders = orderStats[0]?.totalOrders || 0;
    const cancelledCount = statusBreakdown['cancelled'] || 0;
    const cancellationRate = totalOrders > 0
        ? +((cancelledCount / totalOrders) * 100).toFixed(1)
        : 0;
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedMonthlyRevenue = monthlyRevenue.map((m) => ({
        label: `${MONTH_NAMES[m._id.month - 1]} ${m._id.year}`,
        revenue: m.revenue,
        orders: m.orders,
    }));
    res.json({
        success: true,
        data: {
            vendor,
            productStats: productStats.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
            orderStats: {
                ...(orderStats[0] || { totalOrders: 0, totalRevenue: 0 }),
                statusBreakdown,
                cancellationRate,
            },
            recentOrders,
            wallet: wallet
                ? {
                    balance: wallet.balance,
                    totalEarned: wallet.totalEarned || 0,
                    totalSpent: wallet.totalSpent || 0,
                    totalWithdrawn: wallet.totalWithdrawn || 0,
                    pendingBalance: wallet.pendingBalance || 0,
                }
                : null,
            openDisputesCount,
            topProducts,
            vendorProducts,
            monthlyRevenue: formattedMonthlyRevenue,
            recentReviews,
            performance: {
                responseRate: vendor.responseRate || 0,
                responseSpeed: vendor.responseSpeed || 0,
                cancellationRate,
                openDisputesCount,
            },
        },
    });
});
/**
 * PUT /admin/vendors/:id/verify
 * Verify or reject vendor KYC
 */
exports.verifyVendor = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;
    if (!['verified', 'rejected'].includes(status)) {
        res.status(400).json({
            success: false,
            message: 'Status must be "verified" or "rejected"',
        });
        return;
    }
    if (status === 'rejected' && !rejectionReason) {
        res.status(400).json({
            success: false,
            message: 'Rejection reason is required when rejecting',
        });
        return;
    }
    const vendor = await VendorProfile_1.default.findById(id);
    if (!vendor) {
        res.status(404).json({ success: false, message: 'Vendor not found' });
        return;
    }
    vendor.verificationStatus = status;
    if (status === 'verified') {
        vendor.verifiedAt = new Date();
        vendor.rejectionReason = undefined;
        // Restore previously suspended products only if the store is currently active
        if (vendor.isActive) {
            await Product_1.default.updateMany({ vendor: vendor.user, status: 'vendor_suspended' }, { $set: { status: 'active' } });
        }
    }
    else {
        vendor.rejectionReason = rejectionReason;
        // Cascade: suspend all currently active products
        await Product_1.default.updateMany({ vendor: vendor.user, status: 'active' }, { $set: { status: 'vendor_suspended' } });
    }
    // Audit trail
    vendor.statusHistory.push({
        action: status,
        changedBy: req.user?.id,
        reason: rejectionReason || undefined,
        at: new Date(),
    });
    await vendor.save();
    // Send notification
    if (status === 'verified') {
        await notification_service_1.notificationService.vendorVerified(vendor.user.toString());
        // Send vendor welcome emails now that the store is approved
        const vendorUser = await User_1.default.findById(vendor.user).select('email firstName');
        if (vendorUser) {
            (0, email_queue_1.queueEmailsInBackground)([
                () => (0, email_1.sendVendorWelcomeEmail)(vendorUser.email, vendorUser.firstName),
                () => (0, email_1.sendFounderWelcomeEmail)(vendorUser.email, vendorUser.firstName),
                () => (0, email_1.sendProductPostingGuideEmail)(vendorUser.email),
            ], 10000);
        }
    }
    else {
        await notification_service_1.notificationService.vendorRejected(vendor.user.toString(), rejectionReason);
    }
    res.json({
        success: true,
        message: `Vendor ${status === 'verified' ? 'approved' : 'rejected'} successfully`,
        data: { verificationStatus: vendor.verificationStatus },
    });
});
/**
 * PUT /admin/vendors/:id/status
 * Toggle vendor active status
 */
exports.toggleVendorStatus = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    const vendor = await VendorProfile_1.default.findById(id);
    if (!vendor) {
        res.status(404).json({ success: false, message: 'Vendor not found' });
        return;
    }
    const wasActive = vendor.isActive;
    vendor.isActive = typeof isActive === 'boolean' ? isActive : !vendor.isActive;
    const nowActive = vendor.isActive;
    // Cascade product statuses + notify affected cart customers
    if (!nowActive && wasActive) {
        const activeProdIds = await Product_1.default.find({ vendor: vendor.user, status: 'active' }).select('_id').lean();
        await Product_1.default.updateMany({ vendor: vendor.user, status: 'active' }, { $set: { status: 'vendor_suspended' } });
        if (activeProdIds.length > 0) {
            try {
                const Cart = require('../models/Cart').default;
                const affectedCarts = await Cart.find({
                    'items.product': { $in: activeProdIds.map((p) => p._id) },
                }).select('user').lean();
                const affectedUserIds = [...new Set(affectedCarts.map((c) => c.user.toString()))];
                if (affectedUserIds.length > 0) {
                    await notification_service_1.notificationService.sendToMany({
                        userIds: affectedUserIds,
                        type: types_1.NotificationType.ACCOUNT,
                        title: 'Cart Update',
                        message: 'Some items in your cart are no longer available. Please review your cart before checkout.',
                        data: { screen: 'Cart' },
                    });
                }
            }
            catch (err) {
                logger_1.logger.error('Error notifying cart customers on vendor deactivation:', err);
            }
        }
    }
    else if (nowActive && !wasActive) {
        await Product_1.default.updateMany({ vendor: vendor.user, status: 'vendor_suspended' }, { $set: { status: 'active' } });
    }
    // Audit trail
    vendor.statusHistory.push({
        action: nowActive ? 'activated' : 'deactivated',
        changedBy: req.user?.id,
        at: new Date(),
    });
    await vendor.save();
    // Notify vendor
    await notification_service_1.notificationService.send({
        userId: vendor.user.toString(),
        type: types_1.NotificationType.ACCOUNT,
        title: nowActive ? 'Store Activated' : 'Store Deactivated',
        message: nowActive
            ? 'Your store has been activated. Your products are now live again.'
            : 'Your store has been deactivated by admin. Your products are no longer visible. Please contact support for more information.',
        data: { screen: 'VendorDashboard' },
    });
    res.json({
        success: true,
        message: `Vendor ${nowActive ? 'activated' : 'deactivated'} successfully`,
        data: { isActive: vendor.isActive },
    });
});
/**
 * PUT /admin/vendors/:id/premium
 * Toggle vendor premium status
 */
exports.toggleVendorPremium = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const vendor = await VendorProfile_1.default.findById(id);
    if (!vendor) {
        res.status(404).json({ success: false, message: 'Vendor not found' });
        return;
    }
    vendor.isPremium = !vendor.isPremium;
    await vendor.save();
    res.json({
        success: true,
        message: `Vendor ${vendor.isPremium ? 'upgraded to premium' : 'removed from premium'}`,
        data: { isPremium: vendor.isPremium },
    });
});
/**
 * PUT /admin/vendors/:id/commission
 * Update vendor commission rate
 */
exports.updateVendorCommission = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { commissionRate } = req.body;
    if (commissionRate == null || commissionRate < 0 || commissionRate > 100) {
        res.status(400).json({
            success: false,
            message: 'Commission rate must be between 0 and 100',
        });
        return;
    }
    const vendor = await VendorProfile_1.default.findById(id);
    if (!vendor) {
        res.status(404).json({ success: false, message: 'Vendor not found' });
        return;
    }
    vendor.commissionRate = commissionRate;
    await vendor.save();
    res.json({
        success: true,
        message: `Commission rate updated to ${commissionRate}%`,
        data: { commissionRate: vendor.commissionRate },
    });
});
// ================================================================
// PRODUCT MANAGEMENT
// ================================================================
/**
 * GET /admin/products
 * List all products with filtering
 */
exports.getAllProducts = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status, category, vendor, productType, featured, search, sort = 'createdAt', order = 'desc', } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (status)
        filter.status = status;
    if (category)
        filter.category = category;
    if (vendor)
        filter.vendor = vendor;
    if (productType)
        filter.productType = productType;
    if (featured === 'true')
        filter.isFeatured = true;
    if (search) {
        filter.$or = [
            { name: { $regex: escapeRegex(search), $options: 'i' } },
            { sku: { $regex: escapeRegex(search), $options: 'i' } },
        ];
    }
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [products, total] = await Promise.all([
        Product_1.default.find(filter)
            .populate('vendor', 'firstName lastName email')
            .populate('category', 'name slug')
            .sort(sortObj)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        Product_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: products,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * GET /admin/products/:id
 * Get detailed product info
 */
exports.getProductDetails = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const product = await Product_1.default.findById(id)
        .populate('vendor', 'firstName lastName email')
        .populate('category', 'name slug');
    if (!product) {
        res.status(404).json({ success: false, message: 'Product not found' });
        return;
    }
    const [reviewStats, orderCount] = await Promise.all([
        Review_1.default.aggregate([
            { $match: { product: product._id } },
            {
                $group: {
                    _id: null,
                    averageRating: { $avg: '$rating' },
                    totalReviews: { $sum: 1 },
                },
            },
        ]),
        Order_1.default.countDocuments({ 'items.product': product._id }),
    ]);
    res.json({
        success: true,
        data: {
            product,
            reviewStats: reviewStats[0] || { averageRating: 0, totalReviews: 0 },
            orderCount,
        },
    });
});
/**
 * PUT /admin/products/:id/status
 * Update product status (approve, reject, deactivate)
 */
exports.updateProductStatus = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body;
    if (!Object.values(types_1.ProductStatus).includes(status)) {
        res.status(400).json({
            success: false,
            message: `Invalid status. Must be one of: ${Object.values(types_1.ProductStatus).join(', ')}`,
        });
        return;
    }
    const product = await Product_1.default.findById(id);
    if (!product) {
        res.status(404).json({ success: false, message: 'Product not found' });
        return;
    }
    // If approving (setting to active), check if vendor's store is verified
    if (status === types_1.ProductStatus.ACTIVE) {
        const vendorProfile = await VendorProfile_1.default.findOne({ user: product.vendor });
        if (!vendorProfile || vendorProfile.verificationStatus !== 'verified') {
            res.status(400).json({
                success: false,
                message: 'Cannot approve product - vendor store is not verified.',
            });
            return;
        }
    }
    product.status = status;
    await product.save();
    // Notify vendor
    const statusMessages = {
        active: `Your product "${product.name}" has been approved and is now live.`,
        inactive: `Your product "${product.name}" has been deactivated.${reason ? ` Reason: ${reason}` : ''}`,
        pending_approval: `Your product "${product.name}" has been set back to pending approval.`,
    };
    await notification_service_1.notificationService.send({
        userId: product.vendor.toString(),
        type: types_1.NotificationType.SYSTEM,
        title: 'Product Status Updated',
        message: statusMessages[status] || `Your product "${product.name}" status changed to ${status}.`,
    });
    // Notify followers only when product goes live for the first time
    if (status === types_1.ProductStatus.ACTIVE) {
        try {
            const vendorProfile = await VendorProfile_1.default.findOne({ user: product.vendor }).select('followers businessName');
            if (vendorProfile?.followers?.length > 0) {
                const followerIds = vendorProfile.followers.map((f) => f.toString());
                await notification_service_1.notificationService.newProductFromFollowedVendor(followerIds, vendorProfile.businessName || 'A vendor you follow', product.name, product._id.toString());
            }
        }
        catch (err) {
            logger_1.logger.error('Error sending follower notification on product approval:', err);
        }
    }
    res.json({
        success: true,
        message: `Product status updated to ${status}`,
        data: { id: product._id, status: product.status },
    });
});
/**
 * PUT /admin/products/:id/featured
 * Toggle product featured status
 */
exports.toggleProductFeatured = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const product = await Product_1.default.findById(id);
    if (!product) {
        res.status(404).json({ success: false, message: 'Product not found' });
        return;
    }
    product.isFeatured = !product.isFeatured;
    await product.save();
    res.json({
        success: true,
        message: `Product ${product.isFeatured ? 'marked as featured' : 'removed from featured'}`,
        data: { id: product._id, isFeatured: product.isFeatured },
    });
});
/**
 * DELETE /admin/products/:id
 * Delete a product
 */
exports.deleteProduct = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const product = await Product_1.default.findById(id);
    if (!product) {
        res.status(404).json({ success: false, message: 'Product not found' });
        return;
    }
    // Check for active orders
    const activeOrders = await Order_1.default.countDocuments({
        'items.product': id,
        status: { $in: [types_1.OrderStatus.PENDING, types_1.OrderStatus.CONFIRMED, types_1.OrderStatus.PROCESSING, types_1.OrderStatus.SHIPPED] },
    });
    if (activeOrders > 0) {
        res.status(400).json({
            success: false,
            message: `Cannot delete product with ${activeOrders} active order(s)`,
        });
        return;
    }
    await Product_1.default.findByIdAndDelete(id);
    // Clean up reviews
    await Review_1.default.deleteMany({ product: id });
    // Notify vendor
    await notification_service_1.notificationService.send({
        userId: product.vendor.toString(),
        type: types_1.NotificationType.SYSTEM,
        title: 'Product Deleted',
        message: `Your product "${product.name}" has been deleted by admin.`,
    });
    res.json({
        success: true,
        message: 'Product deleted successfully',
    });
});
// ================================================================
// ORDER MANAGEMENT
// ================================================================
/**
 * GET /admin/orders
 * List all orders with filtering
 */
exports.getAllOrders = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status, paymentStatus, paymentMethod, search, startDate, endDate, hasDispute, sort = 'createdAt', order = 'desc', } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (status)
        filter.status = status;
    if (paymentStatus)
        filter.paymentStatus = paymentStatus;
    if (paymentMethod)
        filter.paymentMethod = paymentMethod;
    if (search) {
        filter.$or = [
            { orderNumber: { $regex: escapeRegex(search), $options: 'i' } },
            { paymentReference: { $regex: escapeRegex(search), $options: 'i' } },
        ];
    }
    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate)
            filter.createdAt.$gte = new Date(startDate);
        if (endDate)
            filter.createdAt.$lte = new Date(endDate);
    }
    if (hasDispute === 'true') {
        const disputedOrderIds = await Dispute_1.default.distinct('order');
        filter._id = { $in: disputedOrderIds };
    }
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [orders, total] = await Promise.all([
        Order_1.default.find(filter)
            .populate('user', 'firstName lastName email phone')
            .sort(sortObj)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        Order_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: orders,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * GET /admin/orders/:id
 * Get detailed order info
 */
exports.getOrderDetails = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const order = await Order_1.default.findById(id)
        .populate('user', 'firstName lastName email phone avatar')
        .populate('items.product', 'name images slug')
        .populate('items.vendor', 'firstName lastName email');
    if (!order) {
        res.status(404).json({ success: false, message: 'Order not found' });
        return;
    }
    const orderId = order._id;
    const [linkedDispute, orderReviews] = await Promise.all([
        Dispute_1.default.findOne({ order: orderId })
            .select('disputeNumber status reason description createdAt resolvedAt refundAmount refundType')
            .lean(),
        Review_1.default.find({ order: orderId })
            .populate('product', 'name images')
            .select('rating title comment status product createdAt vendorResponse')
            .lean(),
    ]);
    res.json({
        success: true,
        data: {
            ...order.toObject(),
            linkedDispute: linkedDispute || null,
            orderReviews: orderReviews || [],
        },
    });
});
/**
 * PUT /admin/orders/:id/status
 * Update order status
 */
exports.updateOrderStatus = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status, note } = req.body;
    if (!Object.values(types_1.OrderStatus).includes(status)) {
        res.status(400).json({
            success: false,
            message: `Invalid status. Must be one of: ${Object.values(types_1.OrderStatus).join(', ')}`,
        });
        return;
    }
    const order = await Order_1.default.findById(id);
    if (!order) {
        res.status(404).json({ success: false, message: 'Order not found' });
        return;
    }
    order.status = status;
    if (note) {
        order.statusHistory.push({
            status,
            timestamp: new Date(),
            note: `[Admin] ${note}`,
        });
    }
    await order.save();
    // Notify customer
    await notification_service_1.notificationService.orderStatusUpdated(order._id.toString(), order.orderNumber, status, order.user.toString());
    res.json({
        success: true,
        message: `Order status updated to ${status}`,
        data: { id: order._id, status: order.status },
    });
});
/**
 * PUT /admin/orders/:id/note
 * Add or update an internal admin note on an order
 */
exports.addAdminNote = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { note } = req.body;
    if (typeof note !== 'string') {
        res.status(400).json({ success: false, message: 'Note must be a string' });
        return;
    }
    const order = await Order_1.default.findByIdAndUpdate(id, { $set: { adminNote: note } }, { new: true });
    if (!order) {
        res.status(404).json({ success: false, message: 'Order not found' });
        return;
    }
    res.json({ success: true, message: 'Admin note saved', data: { adminNote: order.adminNote } });
});
/**
 * POST /admin/orders/:id/refund
 * Process order refund
 */
exports.processRefund = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { amount, reason, refundType = 'full' } = req.body;
    const order = await Order_1.default.findById(id);
    if (!order) {
        res.status(404).json({ success: false, message: 'Order not found' });
        return;
    }
    if (order.paymentStatus !== types_1.PaymentStatus.COMPLETED) {
        res.status(400).json({
            success: false,
            message: 'Can only refund orders with completed payments',
        });
        return;
    }
    const refundAmount = refundType === 'full' ? order.total : Number(amount);
    if (!refundAmount || refundAmount <= 0 || refundAmount > order.total) {
        res.status(400).json({
            success: false,
            message: `Invalid refund amount. Must be between 0 and ${order.total}`,
        });
        return;
    }
    // Credit customer wallet
    const wallet = await Wallet_1.default.findOne({ user: order.user });
    if (wallet) {
        wallet.balance += refundAmount;
        wallet.totalEarned += refundAmount;
        wallet.transactions.push({
            type: types_1.TransactionType.CREDIT,
            amount: refundAmount,
            purpose: types_1.WalletPurpose.REFUND,
            reference: `REFUND-${order.orderNumber}-${Date.now()}`,
            description: `Refund for order #${order.orderNumber}${reason ? `: ${reason}` : ''}`,
            relatedOrder: order._id,
            status: 'completed',
            timestamp: new Date(),
        });
        await wallet.save();
    }
    order.status = types_1.OrderStatus.REFUNDED;
    order.paymentStatus = types_1.PaymentStatus.REFUNDED;
    order.refundAmount = refundAmount;
    order.refundReason = reason || 'Admin processed refund';
    await order.save();
    // Notify customer
    await notification_service_1.notificationService.refundIssued(order.user.toString(), order.orderNumber, refundAmount);
    res.json({
        success: true,
        message: `Refund of ₦${refundAmount.toLocaleString()} processed successfully`,
        data: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            refundAmount,
            refundType,
        },
    });
});
// ================================================================
// FINANCIAL MANAGEMENT
// ================================================================
/**
 * GET /admin/finance/overview
 * Financial overview - total revenue, commissions, withdrawals, etc.
 */
exports.getFinancialOverview = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const [totalRevenue, totalCommissions, totalWithdrawals, pendingWithdrawals, walletBalances, monthlyRevenue, refundStats, paymentMethodBreakdown, topVendorsByCommission, vCreditsCirculation, thisMonthRevenue, lastMonthRevenue,] = await Promise.all([
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED } },
            { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        Wallet_1.default.aggregate([
            { $unwind: '$transactions' },
            { $match: { 'transactions.purpose': types_1.WalletPurpose.COMMISSION, 'transactions.status': 'completed' } },
            { $group: { _id: null, total: { $sum: '$transactions.amount' } } },
        ]),
        Wallet_1.default.aggregate([
            { $unwind: '$transactions' },
            { $match: { 'transactions.purpose': types_1.WalletPurpose.WITHDRAWAL, 'transactions.status': 'completed' } },
            { $group: { _id: null, total: { $sum: '$transactions.amount' } } },
        ]),
        Wallet_1.default.aggregate([
            { $unwind: '$transactions' },
            { $match: { 'transactions.purpose': types_1.WalletPurpose.WITHDRAWAL, 'transactions.status': 'pending' } },
            { $group: { _id: null, total: { $sum: '$transactions.amount' }, count: { $sum: 1 } } },
        ]),
        Wallet_1.default.aggregate([
            { $group: { _id: null, totalBalance: { $sum: '$balance' }, totalPending: { $sum: '$pendingBalance' }, totalEarned: { $sum: '$totalEarned' }, totalWithdrawn: { $sum: '$totalWithdrawn' } } },
        ]),
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED } },
            { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 },
        ]),
        Order_1.default.aggregate([
            { $match: { 'refundAmount': { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: '$refundAmount' }, count: { $sum: 1 } } },
        ]),
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED } },
            { $group: { _id: '$paymentMethod', total: { $sum: '$total' }, count: { $sum: 1 } } },
            { $sort: { total: -1 } },
        ]),
        Wallet_1.default.aggregate([
            { $unwind: '$transactions' },
            { $match: { 'transactions.purpose': types_1.WalletPurpose.COMMISSION, 'transactions.status': 'completed' } },
            { $group: { _id: '$user', totalCommission: { $sum: '$transactions.amount' } } },
            { $sort: { totalCommission: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'vendorprofiles', localField: '_id', foreignField: 'user', as: 'vendor' } },
            { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            { $project: { businessName: { $ifNull: ['$vendor.businessName', { $concat: ['$user.firstName', ' ', '$user.lastName'] }] }, totalCommission: 1, vendorId: '$vendor._id' } },
        ]),
        Wallet_1.default.aggregate([
            { $group: { _id: null, totalVCredits: { $sum: '$vCredits' } } },
        ]),
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED, createdAt: { $gte: startOfThisMonth } } },
            { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED, createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
            { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
    ]);
    const totalRev = totalRevenue[0]?.total || 0;
    const totalRef = refundStats[0]?.total || 0;
    const totalComm = totalCommissions[0]?.total || 0;
    const netRevenue = totalRev - totalRef;
    const refundRate = totalRev > 0 ? +((totalRef / totalRev) * 100).toFixed(1) : 0;
    const thisMonthRev = thisMonthRevenue[0]?.total || 0;
    const lastMonthRev = lastMonthRevenue[0]?.total || 0;
    const monthGrowth = lastMonthRev > 0 ? +(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1) : null;
    res.json({
        success: true,
        data: {
            totalRevenue: totalRev,
            netRevenue,
            totalCommissions: totalComm,
            totalWithdrawals: totalWithdrawals[0]?.total || 0,
            pendingWithdrawals: {
                amount: pendingWithdrawals[0]?.total || 0,
                count: pendingWithdrawals[0]?.count || 0,
            },
            walletBalances: {
                totalBalance: walletBalances[0]?.totalBalance || 0,
                totalPending: walletBalances[0]?.totalPending || 0,
                totalEarned: walletBalances[0]?.totalEarned || 0,
                totalWithdrawn: walletBalances[0]?.totalWithdrawn || 0,
            },
            refundStats: {
                total: totalRef,
                count: refundStats[0]?.count || 0,
                refundRate,
            },
            paymentMethodBreakdown,
            topVendorsByCommission,
            vCreditsInCirculation: vCreditsCirculation[0]?.totalVCredits || 0,
            monthlyRevenue,
            thisMonth: { revenue: thisMonthRev, orders: thisMonthRevenue[0]?.count || 0 },
            lastMonth: { revenue: lastMonthRev, orders: lastMonthRevenue[0]?.count || 0 },
            monthGrowth,
        },
    });
});
/**
 * GET /admin/finance/transactions
 * All wallet transactions across the platform
 */
exports.getAllTransactions = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, type, purpose, status, search, startDate, endDate, } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const matchStage = {};
    if (type)
        matchStage['transactions.type'] = type;
    if (purpose)
        matchStage['transactions.purpose'] = purpose;
    if (status)
        matchStage['transactions.status'] = status;
    if (search) {
        matchStage.$or = [
            { 'transactions.reference': { $regex: escapeRegex(search), $options: 'i' } },
            { 'transactions.description': { $regex: escapeRegex(search), $options: 'i' } },
        ];
    }
    if (startDate || endDate) {
        matchStage['transactions.timestamp'] = {};
        if (startDate)
            matchStage['transactions.timestamp'].$gte = new Date(startDate);
        if (endDate)
            matchStage['transactions.timestamp'].$lte = new Date(endDate);
    }
    const pipeline = [
        { $unwind: '$transactions' },
        { $match: matchStage },
        { $sort: { 'transactions.timestamp': -1 } },
        {
            $facet: {
                data: [
                    { $skip: (pageNum - 1) * limitNum },
                    { $limit: limitNum },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'user',
                            foreignField: '_id',
                            as: 'userInfo',
                        },
                    },
                    { $unwind: '$userInfo' },
                    {
                        $project: {
                            userId: '$user',
                            userName: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
                            userEmail: '$userInfo.email',
                            transaction: '$transactions',
                        },
                    },
                ],
                total: [{ $count: 'count' }],
            },
        },
    ];
    const result = await Wallet_1.default.aggregate(pipeline);
    const data = result[0]?.data || [];
    const total = result[0]?.total[0]?.count || 0;
    res.json({
        success: true,
        data,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * GET /admin/finance/transactions/:transactionId
 * Get full detail for a single wallet transaction
 */
exports.getTransactionById = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { transactionId } = req.params;
    const result = await Wallet_1.default.aggregate([
        { $unwind: '$transactions' },
        { $match: { 'transactions._id': new mongoose_1.default.Types.ObjectId(transactionId) } },
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userInfo' } },
        { $unwind: '$userInfo' },
        { $lookup: { from: 'vendorprofiles', localField: 'user', foreignField: 'user', as: 'vendorProfile' } },
        { $unwind: { path: '$vendorProfile', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                walletId: '$_id',
                walletBalance: '$balance',
                userId: '$user',
                userName: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
                userEmail: '$userInfo.email',
                userPhone: '$userInfo.phone',
                businessName: '$vendorProfile.businessName',
                payoutDetails: { $ifNull: ['$vendorProfile.payoutDetails', '$userInfo.payoutDetails'] },
                transaction: '$transactions',
            },
        },
        { $limit: 1 },
    ]);
    if (!result.length) {
        res.status(404).json({ success: false, message: 'Transaction not found' });
        return;
    }
    res.json({ success: true, data: result[0] });
});
/**
 * GET /admin/finance/withdrawals
 * Pending withdrawal requests
 */
exports.getPendingWithdrawals = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status = 'pending', search, startDate, endDate } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const txnMatch = { 'transactions.purpose': types_1.WalletPurpose.WITHDRAWAL };
    if (status && status !== 'all')
        txnMatch['transactions.status'] = status;
    if (startDate || endDate) {
        txnMatch['transactions.timestamp'] = {};
        if (startDate)
            txnMatch['transactions.timestamp'].$gte = new Date(startDate);
        if (endDate)
            txnMatch['transactions.timestamp'].$lte = new Date(endDate);
    }
    const pipeline = [
        { $unwind: '$transactions' },
        { $match: txnMatch },
        { $sort: { 'transactions.timestamp': -1 } },
        {
            $facet: {
                data: [
                    { $skip: (pageNum - 1) * limitNum },
                    { $limit: limitNum },
                    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userInfo' } },
                    { $unwind: '$userInfo' },
                    { $lookup: { from: 'vendorprofiles', localField: 'user', foreignField: 'user', as: 'vendorProfile' } },
                    { $unwind: { path: '$vendorProfile', preserveNullAndEmptyArrays: true } },
                    {
                        $project: {
                            walletId: '$_id',
                            userId: '$user',
                            userName: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
                            userEmail: '$userInfo.email',
                            userRole: '$userInfo.role',
                            transaction: '$transactions',
                            payoutDetails: { $ifNull: ['$vendorProfile.payoutDetails', '$userInfo.payoutDetails'] },
                            walletBalance: '$balance',
                        },
                    },
                ],
                total: [{ $count: 'count' }],
                stats: [
                    {
                        $group: {
                            _id: '$transactions.status',
                            count: { $sum: 1 },
                            total: { $sum: '$transactions.amount' },
                        },
                    },
                ],
            },
        },
    ];
    // Apply search post-lookup if needed (search by userName/userEmail)
    const result = await Wallet_1.default.aggregate(pipeline);
    let data = result[0]?.data || [];
    if (search) {
        const q = search.toLowerCase();
        data = data.filter((d) => d.userName?.toLowerCase().includes(q) || d.userEmail?.toLowerCase().includes(q));
    }
    const total = result[0]?.total[0]?.count || 0;
    const stats = result[0]?.stats || [];
    const withdrawalStats = stats.reduce((acc, s) => ({ ...acc, [s._id]: { count: s.count, total: s.total } }), {});
    res.json({
        success: true,
        data: { withdrawals: data, withdrawalStats },
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * POST /admin/finance/withdrawals/:walletId/:transactionId/process
 * Process a pending withdrawal (approve or reject)
 */
exports.processWithdrawal = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { walletId, transactionId } = req.params;
    const { action, note } = req.body;
    if (!['approve', 'reject'].includes(action)) {
        res.status(400).json({
            success: false,
            message: 'Action must be "approve" or "reject"',
        });
        return;
    }
    // Pre-read to get the transaction amount for the atomic update
    const walletRead = await Wallet_1.default.findOne({
        _id: walletId,
        transactions: { $elemMatch: { _id: transactionId, purpose: types_1.WalletPurpose.WITHDRAWAL } },
    });
    if (!walletRead) {
        res.status(404).json({ success: false, message: 'Wallet or withdrawal transaction not found' });
        return;
    }
    const txn = walletRead.transactions.id(transactionId);
    if (txn.status !== 'pending') {
        res.status(400).json({ success: false, message: 'Transaction is not a pending withdrawal' });
        return;
    }
    const txnAmount = txn.amount;
    const newStatus = action === 'approve' ? 'completed' : 'failed';
    // Atomic: only update if transaction is still 'pending' — prevents double-processing
    const wallet = await Wallet_1.default.findOneAndUpdate({
        _id: walletId,
        transactions: { $elemMatch: { _id: txn._id, status: 'pending', purpose: types_1.WalletPurpose.WITHDRAWAL } },
    }, {
        $set: { 'transactions.$.status': newStatus },
        $inc: {
            pendingBalance: -txnAmount,
            ...(action === 'approve' ? { totalWithdrawn: txnAmount } : { balance: txnAmount }),
        },
    }, { new: true });
    if (!wallet) {
        res.status(400).json({ success: false, message: 'Transaction already processed' });
        return;
    }
    // Notify user
    await notification_service_1.notificationService.walletWithdrawalProcessed(wallet.user.toString(), txnAmount, action === 'approve' ? 'completed' : 'failed');
    res.json({
        success: true,
        message: `Withdrawal ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
        data: {
            transactionId,
            amount: txnAmount,
            status: newStatus,
        },
    });
});
/**
 * POST /admin/vendors/:id/wallet/resolve
 * Admin-initiated resolution for a rejected/suspended vendor's frozen wallet balance.
 * Creates a pending withdrawal record so it flows through the normal processWithdrawal flow.
 */
exports.resolveVendorWallet = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { note } = req.body;
    const vendor = await VendorProfile_1.default.findById(id).select('user verificationStatus isActive businessName');
    if (!vendor) {
        res.status(404).json({ success: false, message: 'Vendor not found' });
        return;
    }
    const wallet = await Wallet_1.default.findOne({ user: vendor.user });
    if (!wallet || wallet.balance <= 0) {
        res.status(400).json({ success: false, message: 'Vendor has no balance to resolve' });
        return;
    }
    const amount = wallet.balance;
    const reference = `ADMIN-WD-${Date.now().toString(36).toUpperCase()}`;
    const updated = await Wallet_1.default.findOneAndUpdate({ user: vendor.user, balance: { $gte: amount } }, {
        $inc: { balance: -amount, pendingBalance: amount },
        $push: {
            transactions: {
                type: types_1.TransactionType.DEBIT,
                amount,
                purpose: types_1.WalletPurpose.WITHDRAWAL,
                reference,
                description: `Admin-initiated wallet resolution${note ? `: ${note}` : ''}`,
                status: 'pending',
                timestamp: new Date(),
            },
        },
    }, { new: true });
    if (!updated) {
        res.status(400).json({ success: false, message: 'Failed to process wallet resolution' });
        return;
    }
    // Notify the vendor
    await notification_service_1.notificationService.send({
        userId: vendor.user.toString(),
        type: types_1.NotificationType.PAYMENT,
        title: 'Wallet Balance Under Review',
        message: `Your wallet balance of ₦${amount.toLocaleString()} has been queued for processing by admin.${note ? ` Note: ${note}` : ''}`,
    });
    logger_1.logger.info(`Admin ${req.user?.id} initiated wallet resolution of ₦${amount} for vendor ${vendor.user}`);
    res.json({
        success: true,
        message: `₦${amount.toLocaleString()} queued for processing. It will appear in the pending withdrawals list.`,
        data: { amount, reference },
    });
});
// ================================================================
// REVIEW MANAGEMENT
// ================================================================
/**
 * GET /admin/reviews
 * List all reviews with filtering
 */
exports.getAllReviews = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status, reported, rating, search, startDate, endDate, vendor, sort = 'createdAt', order = 'desc', } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (status)
        filter.status = status;
    if (reported === 'true')
        filter.reported = true;
    if (rating)
        filter.rating = Number(rating);
    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate)
            filter.createdAt.$gte = new Date(startDate);
        if (endDate)
            filter.createdAt.$lte = new Date(endDate);
    }
    // Search across comment, user name/email, product name
    if (search) {
        const searchRegex = new RegExp(search, 'i');
        const [matchingUserIds, matchingProductIds] = await Promise.all([
            User_1.default.find({
                $or: [{ firstName: searchRegex }, { lastName: searchRegex }, { email: searchRegex }],
            }).distinct('_id'),
            Product_1.default.find({ name: searchRegex }).distinct('_id'),
        ]);
        filter.$or = [
            { user: { $in: matchingUserIds } },
            { product: { $in: matchingProductIds } },
            { comment: searchRegex },
            { title: searchRegex },
        ];
    }
    // Filter by vendor's products
    if (vendor) {
        const vendorProductIds = await Product_1.default.distinct('_id', { vendor: new mongoose_1.default.Types.ObjectId(vendor) });
        filter.product = { $in: vendorProductIds };
    }
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [[reviews, total], globalStats, ratingDist] = await Promise.all([
        Promise.all([
            Review_1.default.find(filter)
                .populate('user', 'firstName lastName email avatar')
                .populate('product', 'name images slug vendor')
                .populate('order', 'orderNumber')
                .sort(sortObj)
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            Review_1.default.countDocuments(filter),
        ]),
        Review_1.default.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
                    rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
                    reported: { $sum: { $cond: [{ $eq: ['$reported', true] }, 1, 0] } },
                    avgRating: { $avg: '$rating' },
                },
            },
        ]),
        Review_1.default.aggregate([
            { $group: { _id: '$rating', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]),
    ]);
    res.json({
        success: true,
        data: {
            reviews,
            stats: globalStats[0] || { total: 0, pending: 0, approved: 0, rejected: 0, reported: 0, avgRating: 0 },
            ratingDist,
        },
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * GET /admin/reviews/:id
 * Get a single review with full context (order, vendor info)
 */
exports.getReviewById = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const review = await Review_1.default.findById(id)
        .populate('user', 'firstName lastName email avatar')
        .populate('product', 'name images slug vendor')
        .populate('order', 'orderNumber total status paymentStatus createdAt')
        .lean();
    if (!review) {
        res.status(404).json({ success: false, message: 'Review not found' });
        return;
    }
    const vendorUserId = review.product?.vendor;
    const vendorProfile = vendorUserId
        ? await VendorProfile_1.default.findOne({ user: vendorUserId }).select('_id businessName').lean()
        : null;
    res.json({ success: true, data: { ...review, vendorProfile } });
});
/**
 * PUT /admin/reviews/:id/status
 * Approve, reject, or reset a review to pending
 */
exports.updateReviewStatus = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
        res.status(400).json({
            success: false,
            message: 'Status must be "pending", "approved", or "rejected"',
        });
        return;
    }
    const updateFields = { status };
    if (status !== 'pending')
        updateFields.reported = false;
    const review = await Review_1.default.findByIdAndUpdate(id, updateFields, { new: true });
    if (!review) {
        res.status(404).json({ success: false, message: 'Review not found' });
        return;
    }
    // Award 5 points to reviewer when their review is approved
    if (status === 'approved') {
        try {
            const { rewardController } = await Promise.resolve().then(() => __importStar(require('./reward.controller')));
            await rewardController.awardPoints(review.user.toString(), 5, 'review', 'Review approved by admin', { reviewId: review._id });
        }
        catch (err) {
            console.error('Error awarding review points:', err);
        }
    }
    // Recalculate product rating on approve/reject
    if (status === 'approved' || status === 'rejected') {
        const approvedReviews = await Review_1.default.find({ product: review.product, status: 'approved' });
        const avgRating = approvedReviews.length > 0
            ? approvedReviews.reduce((sum, r) => sum + r.rating, 0) / approvedReviews.length
            : 0;
        await Product_1.default.findByIdAndUpdate(review.product, {
            averageRating: Math.round(avgRating * 10) / 10,
            totalReviews: approvedReviews.length,
        });
    }
    res.json({
        success: true,
        message: `Review ${status}`,
        data: review,
    });
});
/**
 * DELETE /admin/reviews/:id
 * Delete a review and recalculate product rating
 */
exports.deleteReview = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const review = await Review_1.default.findByIdAndDelete(id);
    if (!review) {
        res.status(404).json({ success: false, message: 'Review not found' });
        return;
    }
    const remainingReviews = await Review_1.default.find({ product: review.product, status: 'approved' });
    const avgRating = remainingReviews.length > 0
        ? remainingReviews.reduce((sum, r) => sum + r.rating, 0) / remainingReviews.length
        : 0;
    await Product_1.default.findByIdAndUpdate(review.product, {
        averageRating: Math.round(avgRating * 10) / 10,
        totalReviews: remainingReviews.length,
    });
    res.json({
        success: true,
        message: 'Review deleted successfully',
    });
});
// ================================================================
// DISPUTE MANAGEMENT
// ================================================================
/**
 * GET /admin/disputes
 * List all disputes
 */
exports.getAllDisputes = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status, reason, search, startDate, endDate, sort = 'createdAt', order = 'desc', } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (status)
        filter.status = status;
    if (reason)
        filter.reason = reason;
    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate)
            filter.createdAt.$gte = new Date(startDate);
        if (endDate)
            filter.createdAt.$lte = new Date(endDate);
    }
    if (search) {
        const regex = new RegExp(search, 'i');
        const matchingUserIds = await User_1.default.find({
            $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
        }).distinct('_id');
        filter.$or = [
            { disputeNumber: regex },
            { orderNumber: regex },
            { user: { $in: matchingUserIds } },
            { vendor: { $in: matchingUserIds } },
        ];
    }
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const expiringSoonCutoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const [[disputes, total], globalStats, expiringSoon] = await Promise.all([
        Promise.all([
            Dispute_1.default.find(filter)
                .populate('user', 'firstName lastName email')
                .populate('vendor', 'firstName lastName email')
                .populate('order', 'orderNumber total status')
                .sort(sortObj)
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean(),
            Dispute_1.default.countDocuments(filter),
        ]),
        Dispute_1.default.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
                    vendor_responded: { $sum: { $cond: [{ $eq: ['$status', 'vendor_responded'] }, 1, 0] } },
                    under_review: { $sum: { $cond: [{ $eq: ['$status', 'under_review'] }, 1, 0] } },
                    resolved: {
                        $sum: {
                            $cond: [
                                { $in: ['$status', ['resolved_full_refund', 'resolved_partial_refund']] },
                                1, 0,
                            ],
                        },
                    },
                    rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
                    closed: { $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] } },
                    totalRefunded: { $sum: { $ifNull: ['$refundAmount', 0] } },
                },
            },
        ]),
        Dispute_1.default.countDocuments({
            status: { $in: ['open', 'vendor_responded', 'under_review'] },
            expiresAt: { $lte: expiringSoonCutoff, $gte: new Date() },
        }),
    ]);
    res.json({
        success: true,
        data: {
            disputes,
            stats: { ...(globalStats[0] || {}), expiringSoon },
        },
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * GET /admin/disputes/:id
 * Get full dispute details including vendor business name
 */
exports.getDisputeDetails = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const dispute = await Dispute_1.default.findById(id)
        .populate('user', 'firstName lastName email phone avatar')
        .populate('vendor', 'firstName lastName email phone')
        .populate('order', 'orderNumber total status paymentStatus createdAt items serviceCharge')
        .populate('messages.sender', 'firstName lastName role avatar')
        .populate('resolvedBy', 'firstName lastName')
        .lean();
    if (!dispute) {
        res.status(404).json({ success: false, message: 'Dispute not found' });
        return;
    }
    const vendorUserId = dispute.vendor?._id || dispute.vendor;
    const vendorProfile = vendorUserId
        ? await VendorProfile_1.default.findOne({ user: vendorUserId }).select('_id businessName').lean()
        : null;
    res.json({
        success: true,
        data: { ...dispute, vendorProfile },
    });
});
/**
 * PUT /admin/disputes/:id/review
 * Mark dispute as under review
 */
exports.markDisputeUnderReview = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const dispute = await Dispute_1.default.findById(id);
    if (!dispute) {
        res.status(404).json({ success: false, message: 'Dispute not found' });
        return;
    }
    dispute.status = 'under_review';
    await dispute.save();
    // Notify both parties
    const message = `Dispute #${dispute.disputeNumber} is now under admin review.`;
    await Promise.all([
        notification_service_1.notificationService.send({
            userId: dispute.user.toString(),
            type: types_1.NotificationType.ORDER,
            title: 'Dispute Under Review',
            message,
        }),
        notification_service_1.notificationService.send({
            userId: dispute.vendor.toString(),
            type: types_1.NotificationType.ORDER,
            title: 'Dispute Under Review',
            message,
        }),
    ]);
    res.json({
        success: true,
        message: 'Dispute marked as under review',
    });
});
/**
 * PUT /admin/disputes/:id/resolve
 * Resolve dispute with refund decision
 */
exports.resolveDispute = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { resolution, refundType, refundAmount, note } = req.body;
    if (!resolution || !refundType) {
        res.status(400).json({
            success: false,
            message: 'resolution and refundType are required',
        });
        return;
    }
    const dispute = await Dispute_1.default.findById(id);
    if (!dispute) {
        res.status(404).json({ success: false, message: 'Dispute not found' });
        return;
    }
    // Set resolution
    dispute.resolvedBy = new mongoose_1.default.Types.ObjectId(req.user.id);
    dispute.resolution = resolution;
    dispute.refundType = refundType;
    if (refundType === 'full') {
        const order = await Order_1.default.findById(dispute.order);
        dispute.refundAmount = order?.total || 0;
        dispute.status = 'resolved_full_refund';
    }
    else if (refundType === 'partial') {
        dispute.refundAmount = Number(refundAmount) || 0;
        dispute.status = 'resolved_partial_refund';
    }
    else {
        dispute.refundAmount = 0;
        dispute.status = 'rejected';
    }
    // Add admin message
    dispute.messages.push({
        sender: new mongoose_1.default.Types.ObjectId(req.user.id),
        senderRole: 'admin',
        message: `Resolution: ${resolution}${note ? ` | Note: ${note}` : ''}`,
        createdAt: new Date(),
    });
    await dispute.save();
    // Process refund to customer wallet if applicable
    if (dispute.refundAmount && dispute.refundAmount > 0) {
        const wallet = await Wallet_1.default.findOne({ user: dispute.user });
        if (wallet) {
            wallet.balance += dispute.refundAmount;
            wallet.totalEarned += dispute.refundAmount;
            wallet.transactions.push({
                type: types_1.TransactionType.CREDIT,
                amount: dispute.refundAmount,
                purpose: types_1.WalletPurpose.REFUND,
                reference: `DISPUTE-${dispute.disputeNumber}-${Date.now()}`,
                description: `Dispute refund for order #${dispute.orderNumber}`,
                relatedOrder: dispute.order,
                status: 'completed',
                timestamp: new Date(),
            });
            await wallet.save();
        }
    }
    // Notify both parties
    await notification_service_1.notificationService.disputeResolved(dispute.order.toString(), dispute.orderNumber, dispute.vendor.toString(), dispute.user.toString(), resolution, dispute._id.toString());
    res.json({
        success: true,
        message: 'Dispute resolved successfully',
        data: {
            disputeId: dispute._id,
            status: dispute.status,
            refundType: dispute.refundType,
            refundAmount: dispute.refundAmount,
        },
    });
});
/**
 * POST /admin/disputes/:id/message
 * Add admin message to dispute
 */
exports.addDisputeMessage = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;
    if (!message) {
        res.status(400).json({
            success: false,
            message: 'Message is required',
        });
        return;
    }
    const dispute = await Dispute_1.default.findById(id);
    if (!dispute) {
        res.status(404).json({ success: false, message: 'Dispute not found' });
        return;
    }
    dispute.messages.push({
        sender: new mongoose_1.default.Types.ObjectId(req.user.id),
        senderRole: 'admin',
        message,
        createdAt: new Date(),
    });
    await dispute.save();
    res.json({
        success: true,
        message: 'Admin message added to dispute',
    });
});
/**
 * PUT /admin/disputes/:id/close
 * Close a dispute (admin-initiated, no refund)
 */
exports.closeDispute = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { note } = req.body;
    const dispute = await Dispute_1.default.findById(id);
    if (!dispute) {
        res.status(404).json({ success: false, message: 'Dispute not found' });
        return;
    }
    if (['resolved_full_refund', 'resolved_partial_refund', 'closed'].includes(dispute.status)) {
        res.status(400).json({ success: false, message: 'Dispute is already closed or resolved' });
        return;
    }
    dispute.status = 'closed';
    if (note) {
        dispute.messages.push({
            sender: new mongoose_1.default.Types.ObjectId(req.user.id),
            senderRole: 'admin',
            message: note,
            createdAt: new Date(),
        });
    }
    await dispute.save();
    const msg = `Dispute #${dispute.disputeNumber} has been closed by admin.`;
    await Promise.all([
        notification_service_1.notificationService.send({ userId: dispute.user.toString(), type: types_1.NotificationType.ORDER, title: 'Dispute Closed', message: msg }),
        notification_service_1.notificationService.send({ userId: dispute.vendor.toString(), type: types_1.NotificationType.ORDER, title: 'Dispute Closed', message: msg }),
    ]);
    res.json({ success: true, message: 'Dispute closed' });
});
// ================================================================
// COUPON MANAGEMENT
// ================================================================
/**
 * GET /admin/coupons
 * List all coupons
 */
exports.getAllCoupons = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, active, search, validity, sort = 'createdAt', order = 'desc' } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const now = new Date();
    const filter = {};
    if (active === 'true')
        filter.isActive = true;
    if (active === 'false')
        filter.isActive = false;
    if (validity === 'valid') {
        filter.validFrom = { $lte: now };
        filter.validUntil = { $gte: now };
    }
    if (validity === 'expired')
        filter.validUntil = { $lt: now };
    if (validity === 'upcoming')
        filter.validFrom = { $gt: now };
    if (search) {
        const regex = new RegExp(search, 'i');
        filter.$or = [{ code: regex }, { description: regex }];
    }
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [[coupons, total], globalStats] = await Promise.all([
        Promise.all([
            Additional_1.Coupon.find(filter).sort(sortObj).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
            Additional_1.Coupon.countDocuments(filter),
        ]),
        Additional_1.Coupon.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: ['$isActive', 1, 0] } },
                    expired: { $sum: { $cond: [{ $lt: ['$validUntil', now] }, 1, 0] } },
                    upcoming: { $sum: { $cond: [{ $gt: ['$validFrom', now] }, 1, 0] } },
                    totalRedemptions: { $sum: '$usageCount' },
                    exhausted: { $sum: { $cond: [{ $and: [{ $gt: ['$usageLimit', 0] }, { $gte: ['$usageCount', '$usageLimit'] }] }, 1, 0] } },
                },
            },
        ]),
    ]);
    res.json({
        success: true,
        data: { coupons, stats: globalStats[0] || { total: 0, active: 0, expired: 0, upcoming: 0, totalRedemptions: 0, exhausted: 0 } },
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * POST /admin/coupons
 * Create a new coupon
 */
exports.createCoupon = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { code, description, discountType, discountValue, minPurchase, maxDiscount, usageLimit, validFrom, validUntil, applicableProducts, applicableCategories, excludedProducts, assignedTo, // array of email strings from admin UI
     } = req.body;
    if (!code || !discountType || !discountValue || !validFrom || !validUntil) {
        res.status(400).json({
            success: false,
            message: 'code, discountType, discountValue, validFrom, and validUntil are required',
        });
        return;
    }
    const existing = await Additional_1.Coupon.findOne({ code: code.toUpperCase() });
    if (existing) {
        res.status(409).json({
            success: false,
            message: 'Coupon code already exists',
        });
        return;
    }
    // Resolve emails → user ObjectIds
    let assignedToIds;
    if (assignedTo?.length) {
        const emails = Array.isArray(assignedTo) ? assignedTo : [assignedTo];
        const users = await User_1.default.find({ email: { $in: emails.map((e) => e.toLowerCase().trim()) } })
            .select('_id email')
            .lean();
        const foundEmails = users.map((u) => u.email);
        const missing = emails.filter((e) => !foundEmails.includes(e.toLowerCase().trim()));
        if (missing.length) {
            res.status(400).json({ success: false, message: `No account found for: ${missing.join(', ')}` });
            return;
        }
        assignedToIds = users.map((u) => u._id);
    }
    const coupon = await Additional_1.Coupon.create({
        code: code.toUpperCase(),
        description,
        discountType,
        discountValue,
        minPurchase,
        maxDiscount,
        usageLimit,
        validFrom,
        validUntil,
        applicableProducts,
        applicableCategories,
        excludedProducts,
        assignedTo: assignedToIds,
    });
    res.status(201).json({
        success: true,
        message: 'Coupon created successfully',
        data: coupon,
    });
});
/**
 * PUT /admin/coupons/:id
 * Update coupon
 */
exports.updateCoupon = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { assignedTo, ...rest } = req.body;
    // Resolve emails → ObjectIds if provided
    let resolvedAssignedTo;
    if (assignedTo !== undefined) {
        if (Array.isArray(assignedTo) && assignedTo.length > 0) {
            const emails = assignedTo.map((e) => e.toLowerCase().trim());
            const users = await User_1.default.find({ email: { $in: emails } }).select('_id email').lean();
            const foundEmails = users.map((u) => u.email);
            const missing = emails.filter((e) => !foundEmails.includes(e));
            if (missing.length) {
                res.status(400).json({ success: false, message: `No account found for: ${missing.join(', ')}` });
                return;
            }
            resolvedAssignedTo = users.map((u) => u._id);
        }
        else {
            resolvedAssignedTo = []; // empty array = make public
        }
    }
    const updatePayload = { ...rest };
    if (resolvedAssignedTo !== undefined)
        updatePayload.assignedTo = resolvedAssignedTo;
    const coupon = await Additional_1.Coupon.findByIdAndUpdate(id, updatePayload, {
        new: true,
        runValidators: true,
    });
    if (!coupon) {
        res.status(404).json({ success: false, message: 'Coupon not found' });
        return;
    }
    res.json({
        success: true,
        message: 'Coupon updated successfully',
        data: coupon,
    });
});
/**
 * DELETE /admin/coupons/:id
 * Delete coupon
 */
exports.deleteCoupon = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const coupon = await Additional_1.Coupon.findByIdAndDelete(id);
    if (!coupon) {
        res.status(404).json({ success: false, message: 'Coupon not found' });
        return;
    }
    res.json({
        success: true,
        message: 'Coupon deleted successfully',
    });
});
/**
 * GET /admin/coupons/:id/usage
 * List users who have redeemed this coupon
 */
exports.getCouponUsage = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const coupon = await Additional_1.Coupon.findById(id)
        .populate('usedBy', 'firstName lastName email avatar createdAt')
        .populate('assignedTo', 'firstName lastName email')
        .lean();
    if (!coupon) {
        res.status(404).json({ success: false, message: 'Coupon not found' });
        return;
    }
    res.json({
        success: true,
        data: {
            code: coupon.code,
            usageCount: coupon.usageCount,
            usageLimit: coupon.usageLimit,
            usedBy: coupon.usedBy || [],
            assignedTo: coupon.assignedTo || [],
        },
    });
});
/**
 * PUT /admin/coupons/:id/toggle
 * Toggle coupon active/inactive
 */
exports.toggleCouponActive = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const coupon = await Additional_1.Coupon.findById(id);
    if (!coupon) {
        res.status(404).json({ success: false, message: 'Coupon not found' });
        return;
    }
    coupon.isActive = !coupon.isActive;
    await coupon.save();
    res.json({
        success: true,
        message: `Coupon ${coupon.isActive ? 'activated' : 'deactivated'}`,
        data: { isActive: coupon.isActive },
    });
});
// ================================================================
// CATEGORY MANAGEMENT
// ================================================================
/**
 * GET /admin/categories
 * List all categories with search, status, level filters + global stats
 */
exports.getAllCategories = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { search, status, level } = req.query;
    const filter = {};
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
        ];
    }
    if (status === 'active')
        filter.isActive = true;
    else if (status === 'inactive')
        filter.isActive = false;
    if (level === 'top')
        filter.level = 0;
    else if (level === 'sub')
        filter.level = { $gt: 0 };
    const [categories, statsAgg] = await Promise.all([
        Category_1.default.find(filter)
            .populate('parent', 'name slug')
            .sort({ level: 1, order: 1, name: 1 })
            .lean(),
        Category_1.default.aggregate([
            {
                $facet: {
                    total: [{ $count: 'n' }],
                    active: [{ $match: { isActive: true } }, { $count: 'n' }],
                    inactive: [{ $match: { isActive: false } }, { $count: 'n' }],
                    topLevel: [{ $match: { level: 0 } }, { $count: 'n' }],
                    subcategories: [{ $match: { level: { $gt: 0 } } }, { $count: 'n' }],
                    totalProducts: [{ $group: { _id: null, sum: { $sum: '$productCount' } } }],
                },
            },
        ]),
    ]);
    // Build subcategory count per parent from the full unfiltered set
    const allCats = await Category_1.default.find({}, '_id parent').lean();
    const subCountMap = {};
    for (const c of allCats) {
        if (c.parent) {
            const parentId = c.parent.toString();
            subCountMap[parentId] = (subCountMap[parentId] || 0) + 1;
        }
    }
    const s = statsAgg[0];
    const stats = {
        total: s.total[0]?.n || 0,
        active: s.active[0]?.n || 0,
        inactive: s.inactive[0]?.n || 0,
        topLevel: s.topLevel[0]?.n || 0,
        subcategories: s.subcategories[0]?.n || 0,
        totalProducts: s.totalProducts[0]?.sum || 0,
    };
    const categoriesWithSub = categories.map((c) => ({
        ...c,
        subcategoryCount: subCountMap[c._id.toString()] || 0,
    }));
    res.json({
        success: true,
        data: { categories: categoriesWithSub, stats },
        meta: { total: categories.length },
    });
});
/**
 * POST /admin/categories
 * Create a new category
 */
exports.createCategory = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { name, description, image, icon, parent, order: catOrder } = req.body;
    if (!name) {
        res.status(400).json({
            success: false,
            message: 'Category name is required',
        });
        return;
    }
    const slug = (0, helpers_1.generateSlug)(name);
    const existingSlug = await Category_1.default.findOne({ slug });
    if (existingSlug) {
        res.status(409).json({
            success: false,
            message: 'Category with similar name already exists',
        });
        return;
    }
    let level = 0;
    if (parent) {
        const parentCat = await Category_1.default.findById(parent);
        if (parentCat)
            level = parentCat.level + 1;
    }
    const category = await Category_1.default.create({
        name,
        slug,
        description,
        image,
        icon,
        parent,
        level,
        order: catOrder || 0,
    });
    res.status(201).json({
        success: true,
        message: 'Category created successfully',
        data: category,
    });
});
/**
 * PUT /admin/categories/:id
 * Update category
 */
exports.updateCategory = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    if (updates.name) {
        updates.slug = (0, helpers_1.generateSlug)(updates.name);
    }
    if (updates.parent) {
        const parentCat = await Category_1.default.findById(updates.parent);
        if (parentCat)
            updates.level = parentCat.level + 1;
    }
    const category = await Category_1.default.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true,
    });
    if (!category) {
        res.status(404).json({ success: false, message: 'Category not found' });
        return;
    }
    res.json({
        success: true,
        message: 'Category updated successfully',
        data: category,
    });
});
/**
 * DELETE /admin/categories/:id
 * Delete category
 */
exports.deleteCategory = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    // Check for products in this category
    const productCount = await Product_1.default.countDocuments({ category: id });
    if (productCount > 0) {
        res.status(400).json({
            success: false,
            message: `Cannot delete category with ${productCount} product(s). Reassign products first.`,
        });
        return;
    }
    // Check for subcategories
    const childCount = await Category_1.default.countDocuments({ parent: id });
    if (childCount > 0) {
        res.status(400).json({
            success: false,
            message: `Cannot delete category with ${childCount} subcategory/ies. Delete subcategories first.`,
        });
        return;
    }
    const category = await Category_1.default.findByIdAndDelete(id);
    if (!category) {
        res.status(404).json({ success: false, message: 'Category not found' });
        return;
    }
    res.json({
        success: true,
        message: 'Category deleted successfully',
    });
});
/**
 * PUT /admin/categories/:id/toggle
 * Toggle category active status
 */
exports.toggleCategoryStatus = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const category = await Category_1.default.findById(id);
    if (!category) {
        res.status(404).json({ success: false, message: 'Category not found' });
        return;
    }
    category.isActive = !category.isActive;
    await category.save();
    res.json({
        success: true,
        message: `Category ${category.isActive ? 'activated' : 'deactivated'}`,
        data: { isActive: category.isActive },
    });
});
// ================================================================
// NOTIFICATION MANAGEMENT
// ================================================================
/**
 * POST /admin/notifications/broadcast
 * Broadcast notification to all users or a segment
 */
exports.broadcastNotification = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    // Accept both `segment` and `targetAudience` (frontend compat)
    const rawSegment = req.body.segment || req.body.targetAudience || 'all';
    const rawType = req.body.type;
    const { title, message, link } = req.body;
    // channels: which delivery methods to use (defaults to inapp + push for backwards compat)
    const channels = Array.isArray(req.body.channels) && req.body.channels.length > 0
        ? req.body.channels
        : ['inapp', 'push'];
    // Map to a valid NotificationType (fall back to SYSTEM for unrecognised values)
    const validTypes = Object.values(types_1.NotificationType);
    const type = validTypes.includes(rawType)
        ? rawType
        : types_1.NotificationType.SYSTEM;
    if (!title || !message) {
        res.status(400).json({ success: false, message: 'title and message are required' });
        return;
    }
    // Build user filter based on segment
    const userFilter = { status: types_1.UserStatus.ACTIVE };
    if (rawSegment === 'customers')
        userFilter.role = types_1.UserRole.CUSTOMER;
    else if (rawSegment === 'vendors')
        userFilter.role = types_1.UserRole.VENDOR;
    else if (rawSegment === 'affiliates')
        userFilter.isAffiliate = true;
    // Fetch all fields we might need across channels
    const users = await User_1.default.find(userFilter)
        .select('_id email firstName lastName fcmTokens')
        .lean();
    if (users.length === 0) {
        res.status(400).json({ success: false, message: 'No users match the selected segment' });
        return;
    }
    const userIds = users.map((u) => u._id.toString());
    const recipientCount = users.length;
    // Respond immediately — all channel sends are fire-and-forget
    res.json({
        success: true,
        message: `Notification broadcast queued for ${recipientCount} user(s)`,
        data: { recipientCount, segment: rawSegment, type, channels },
    });
    // ── IN-APP channel (DB insert + socket emit) ──
    if (channels.includes('inapp')) {
        notification_service_1.notificationService
            .sendToMany({ userIds, type, title, message, link, skipPush: true })
            .catch((err) => logger_1.logger.error('Broadcast in-app failed:', err?.message));
    }
    // ── PUSH channel (Expo push tokens) ──
    if (channels.includes('push')) {
        const allTokens = users
            .flatMap((u) => u.fcmTokens || [])
            .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
        if (allTokens.length > 0) {
            const pushData = {
                type,
                ...(link ? { link } : {}),
            };
            (0, firebase_1.sendPushNotification)(allTokens, title, message, pushData)
                .catch((err) => logger_1.logger.error('Broadcast push failed:', err?.message));
        }
        else {
            logger_1.logger.info('Broadcast push: no valid Expo tokens found');
        }
    }
    // ── EMAIL channel (Resend) ──
    if (channels.includes('email')) {
        const html = buildBroadcastEmailHtml(title, message, link);
        // Send concurrently in batches of 20 to avoid flooding Resend
        const batchSize = 20;
        const sendEmailBatch = async () => {
            for (let i = 0; i < users.length; i += batchSize) {
                const batch = users.slice(i, i + batchSize);
                await Promise.allSettled(batch.map((u) => (0, email_1.sendEmail)({ to: u.email, subject: title, html }).catch((err) => logger_1.logger.warn(`Broadcast email failed for ${u.email}:`, err?.message))));
            }
            logger_1.logger.info(`Broadcast email: sent to ${users.length} users`);
        };
        sendEmailBatch().catch((err) => logger_1.logger.error('Broadcast email batch failed:', err?.message));
    }
});
function buildBroadcastEmailHtml(title, message, link) {
    const year = new Date().getFullYear();
    const ctaButton = link
        ? `<div style="text-align:center;margin:28px 0;">
        <a href="${link}" style="display:inline-block;padding:12px 28px;background:#ff6600;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          View Details
        </a>
       </div>`
        : '';
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:#ff6600;padding:24px 32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">VendorSpot</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;">
            <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:22px;font-weight:700;">${title}</h2>
            <p style="margin:0 0 24px;color:#555555;font-size:16px;line-height:1.7;">${message.replace(/\n/g, '<br>')}</p>
            ${ctaButton}
            <hr style="border:none;border-top:1px solid #eeeeee;margin:24px 0;">
            <p style="margin:0;color:#999999;font-size:13px;line-height:1.6;">
              You received this message because you are a VendorSpot user.<br>
              © ${year} VendorSpot. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
/**
 * GET /admin/notifications
 * Get notification send history (latest system-level notifications)
 */
exports.getNotificationHistory = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, type, read, search } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (type)
        filter.type = type;
    if (read === 'true')
        filter.read = true;
    if (read === 'false')
        filter.read = false;
    if (search) {
        filter.$or = [
            { title: { $regex: search, $options: 'i' } },
            { message: { $regex: search, $options: 'i' } },
        ];
    }
    const [notifications, total, statsAgg] = await Promise.all([
        Additional_1.Notification.find(filter)
            .populate('user', 'firstName lastName email avatar')
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .lean(),
        Additional_1.Notification.countDocuments(filter),
        Additional_1.Notification.aggregate([
            {
                $facet: {
                    total: [{ $count: 'n' }],
                    unread: [{ $match: { read: false } }, { $count: 'n' }],
                    byType: [{ $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
                },
            },
        ]),
    ]);
    const s = statsAgg[0];
    const stats = {
        total: s.total[0]?.n || 0,
        unread: s.unread[0]?.n || 0,
        byType: s.byType,
    };
    res.json({
        success: true,
        data: { notifications, stats },
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
// ================================================================
// ACCOUNT DELETION MANAGEMENT
// ================================================================
/**
 * GET /admin/account-deletions
 * List all account deletion requests
 */
exports.getAccountDeletionRequests = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (status)
        filter.status = status;
    const [requests, total] = await Promise.all([
        AccountDeletionRequest_1.default.find(filter)
            .populate('user', 'firstName lastName email role status')
            .populate('processedBy', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        AccountDeletionRequest_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: requests,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * POST /admin/account-deletions/:id/approve
 * Approve account deletion request
 */
exports.approveAccountDeletion = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const request = await AccountDeletionRequest_1.default.findById(id).populate('user');
    if (!request) {
        res.status(404).json({ success: false, message: 'Request not found' });
        return;
    }
    if (request.status !== 'pending') {
        res.status(400).json({ success: false, message: `Request is already ${request.status}` });
        return;
    }
    const user = request.user;
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    // Block deletion if vendor still has active orders
    if (user.role === 'vendor') {
        const pendingOrders = await Order_1.default.countDocuments({
            'items.vendor': user._id,
            status: { $in: ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'] },
        });
        if (pendingOrders > 0) {
            res.status(400).json({
                success: false,
                message: `Cannot delete account — ${pendingOrders} active order(s) must be completed or cancelled first.`,
            });
            return;
        }
    }
    // 1. Notify + force-logout the user BEFORE deleting so the socket can still deliver
    try {
        await notification_service_1.notificationService.send({
            userId: user._id.toString(),
            type: types_1.NotificationType.ACCOUNT,
            title: 'Account Permanently Deleted',
            message: 'Your account deletion request has been approved. Your account and all associated data have been permanently removed. Thank you for using VendorSpot.',
        });
    }
    catch (_) {
        // Non-critical — don't block the deletion
    }
    // Kick the user off the app via socket
    try {
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${user._id}`).emit('force_logout', { reason: 'account_deleted' });
        }
    }
    catch (_) { }
    // 2. Vendor-specific cleanup
    if (user.role === 'vendor') {
        await Product_1.default.updateMany({ vendor: user._id }, { status: 'inactive' });
        await VendorProfile_1.default.findOneAndDelete({ user: user._id });
    }
    // 3. Anonymize completed orders (preserve records, strip personal info)
    await Order_1.default.updateMany({ user: user._id }, {
        $set: {
            'shippingAddress.fullName': 'Deleted User',
            'shippingAddress.phone': 'N/A',
        },
    });
    // 4. Hard-delete the user — frees the email for re-registration
    await User_1.default.findByIdAndDelete(user._id);
    // 5. Mark request as approved
    request.status = 'approved';
    request.processedBy = new mongoose_1.default.Types.ObjectId(req.user.id);
    request.processedAt = new Date();
    await request.save();
    res.json({
        success: true,
        message: 'Account permanently deleted',
    });
});
/**
 * POST /admin/account-deletions/:id/reject
 * Reject account deletion request
 */
exports.rejectAccountDeletion = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const request = await AccountDeletionRequest_1.default.findById(id);
    if (!request) {
        res.status(404).json({ success: false, message: 'Request not found' });
        return;
    }
    if (request.status !== 'pending') {
        res.status(400).json({
            success: false,
            message: `Request is already ${request.status}`,
        });
        return;
    }
    request.status = 'rejected';
    request.processedBy = new mongoose_1.default.Types.ObjectId(req.user.id);
    request.processedAt = new Date();
    request.rejectionReason = reason || 'Rejected by admin';
    await request.save();
    // Notify user
    await notification_service_1.notificationService.send({
        userId: request.user.toString(),
        type: types_1.NotificationType.ACCOUNT,
        title: 'Account Deletion Request Rejected',
        message: `Your account deletion request has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
    });
    res.json({
        success: true,
        message: 'Account deletion request rejected',
    });
});
/**
 * POST /admin/account-deletions
 * Admin creates a deletion request on behalf of a user
 */
exports.adminCreateDeletionRequest = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { userId, reason } = req.body;
    if (!userId) {
        res.status(400).json({ success: false, message: 'userId is required' });
        return;
    }
    if (!reason || !String(reason).trim()) {
        res.status(400).json({ success: false, message: 'Reason is required' });
        return;
    }
    const user = await User_1.default.findById(userId);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    const existing = await AccountDeletionRequest_1.default.findOne({ user: userId, status: 'pending' });
    if (existing) {
        res.status(400).json({ success: false, message: 'This user already has a pending deletion request' });
        return;
    }
    const deletionRequest = await AccountDeletionRequest_1.default.create({
        user: userId,
        userEmail: user.email,
        userFullName: `${user.firstName} ${user.lastName}`,
        reason: String(reason).trim(),
        userRole: user.role,
    });
    if (user.role === 'vendor') {
        const pendingOrders = await Order_1.default.countDocuments({
            'items.vendor': userId,
            status: { $in: ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'] },
        });
        if (pendingOrders > 0) {
            deletionRequest.hasPendingOrders = true;
            deletionRequest.pendingOrdersCount = pendingOrders;
            await deletionRequest.save();
        }
    }
    res.status(201).json({
        success: true,
        message: 'Deletion request submitted successfully. A super admin must approve before the account is removed.',
        data: {
            deletionRequest: {
                id: deletionRequest._id,
                status: deletionRequest.status,
                reason: deletionRequest.reason,
                createdAt: deletionRequest.createdAt,
            },
        },
    });
});
// ================================================================
// AFFILIATE MANAGEMENT
// ================================================================
/**
 * GET /admin/affiliates
 * List all affiliates with search, status filter, and global stats
 */
exports.getAllAffiliates = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, sort = 'totalEarned', order = 'desc', search, status } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    // Pre-query users for search / status filters
    const userFilter = {};
    if (search) {
        userFilter.$or = [
            { firstName: { $regex: search, $options: 'i' } },
            { lastName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
        ];
    }
    if (status === 'active')
        userFilter.isAffiliate = true;
    else if (status === 'inactive')
        userFilter.isAffiliate = false;
    let matchingUserIds;
    if (search || status) {
        matchingUserIds = await User_1.default.find(userFilter).distinct('_id');
    }
    const linkMatch = {};
    if (matchingUserIds)
        linkMatch.user = { $in: matchingUserIds };
    const pipeline = [
        ...(Object.keys(linkMatch).length ? [{ $match: linkMatch }] : []),
        {
            $group: {
                _id: '$user',
                totalLinks: { $sum: 1 },
                totalClicks: { $sum: '$clicks' },
                totalConversions: { $sum: '$conversions' },
                totalEarned: { $sum: '$totalEarned' },
                activeLinks: { $sum: { $cond: ['$isActive', 1, 0] } },
            },
        },
        { $sort: sortObj },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user',
            },
        },
        { $unwind: '$user' },
        {
            $project: {
                userId: '$_id',
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                email: '$user.email',
                avatar: '$user.avatar',
                affiliateCode: '$user.affiliateCode',
                status: '$user.status',
                isAffiliate: '$user.isAffiliate',
                totalLinks: 1,
                totalClicks: 1,
                totalConversions: 1,
                totalEarned: 1,
                activeLinks: 1,
            },
        },
    ];
    // Count total (run pipeline without skip/limit)
    const countPipeline = [...pipeline, { $count: 'n' }];
    const [affiliatesFull, countResult, statsAgg, totalAffiliates] = await Promise.all([
        Additional_1.AffiliateLink.aggregate([...pipeline, { $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }]),
        Additional_1.AffiliateLink.aggregate(countPipeline),
        Additional_1.AffiliateLink.aggregate([
            {
                $group: {
                    _id: null,
                    totalClicks: { $sum: '$clicks' },
                    totalConversions: { $sum: '$conversions' },
                    totalEarned: { $sum: '$totalEarned' },
                },
            },
        ]),
        User_1.default.countDocuments({ isAffiliate: true }),
    ]);
    const filteredTotal = countResult[0]?.n || 0;
    const s = statsAgg[0] || {};
    const stats = {
        totalAffiliates,
        totalClicks: s.totalClicks || 0,
        totalConversions: s.totalConversions || 0,
        totalEarned: s.totalEarned || 0,
        avgConversionRate: s.totalClicks > 0
            ? +((s.totalConversions / s.totalClicks) * 100).toFixed(1)
            : 0,
    };
    res.json({
        success: true,
        data: { affiliates: affiliatesFull, stats },
        meta: (0, helpers_1.getPaginationMeta)(filteredTotal, pageNum, limitNum),
    });
});
/**
 * GET /admin/affiliates/:userId/links
 * Get all affiliate links for a specific user
 */
exports.getAffiliateLinks = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { userId } = req.params;
    const [user, links] = await Promise.all([
        User_1.default.findById(userId).select('firstName lastName email avatar affiliateCode isAffiliate status').lean(),
        Additional_1.AffiliateLink.find({ user: userId })
            .populate('product', 'name images price slug')
            .sort({ createdAt: -1 })
            .lean(),
    ]);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    res.json({
        success: true,
        data: { user, links },
    });
});
/**
 * PUT /admin/affiliates/:userId/status
 * Toggle affiliate status
 */
exports.toggleAffiliateStatus = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { userId } = req.params;
    const { isActive } = req.body;
    const user = await User_1.default.findById(userId);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    if (typeof isActive === 'boolean') {
        user.isAffiliate = isActive;
    }
    else {
        user.isAffiliate = !user.isAffiliate;
    }
    await user.save();
    // Deactivate/activate all their links
    await Additional_1.AffiliateLink.updateMany({ user: userId }, { isActive: user.isAffiliate });
    res.json({
        success: true,
        message: `Affiliate ${user.isAffiliate ? 'activated' : 'deactivated'}`,
        data: { isAffiliate: user.isAffiliate },
    });
});
// ================================================================
// CHALLENGE MANAGEMENT
// ================================================================
/**
 * GET /admin/challenges
 * List all challenges
 */
exports.getAllChallenges = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, active } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (active === 'true')
        filter.isActive = true;
    if (active === 'false')
        filter.isActive = false;
    const [challenges, total] = await Promise.all([
        Additional_1.Challenge.find(filter)
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        Additional_1.Challenge.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: challenges,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * POST /admin/challenges
 * Create a new challenge
 */
exports.createChallenge = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { title, description, type, startDate, endDate, targetType, targetValue, rewardType, rewardValue, isRecurring, recurringPeriod, } = req.body;
    if (!title || !description || !type || !startDate || !endDate || !targetType || !targetValue || !rewardType || !rewardValue) {
        res.status(400).json({
            success: false,
            message: 'All challenge fields are required',
        });
        return;
    }
    const challenge = await Additional_1.Challenge.create({
        title,
        description,
        type,
        startDate,
        endDate,
        targetType,
        targetValue,
        rewardType,
        rewardValue,
        isRecurring: isRecurring || false,
        recurringPeriod,
    });
    res.status(201).json({
        success: true,
        message: 'Challenge created successfully',
        data: challenge,
    });
});
/**
 * PUT /admin/challenges/:id
 * Update challenge
 */
exports.updateChallenge = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const challenge = await Additional_1.Challenge.findByIdAndUpdate(id, req.body, {
        new: true,
        runValidators: true,
    });
    if (!challenge) {
        res.status(404).json({ success: false, message: 'Challenge not found' });
        return;
    }
    res.json({
        success: true,
        message: 'Challenge updated successfully',
        data: challenge,
    });
});
/**
 * DELETE /admin/challenges/:id
 * Delete challenge
 */
exports.deleteChallenge = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const challenge = await Additional_1.Challenge.findByIdAndDelete(id);
    if (!challenge) {
        res.status(404).json({ success: false, message: 'Challenge not found' });
        return;
    }
    res.json({
        success: true,
        message: 'Challenge deleted successfully',
    });
});
// ================================================================
// REPORTS
// ================================================================
/**
 * GET /admin/reports/sales
 * Sales report — supports period (days), custom startDate/endDate, groupBy
 */
exports.getSalesReport = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { period = '30', startDate, endDate, groupBy = 'day' } = req.query;
    const endDateVal = endDate ? new Date(endDate) : new Date();
    const startDateVal = startDate
        ? new Date(startDate)
        : new Date(endDateVal.getTime() - Number(period) * 24 * 60 * 60 * 1000);
    const periodMs = endDateVal.getTime() - startDateVal.getTime();
    const prevStartDate = new Date(startDateVal.getTime() - periodMs);
    const dateFormat = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%G-W%V' : '%Y-%m-%d';
    const completedFilter = {
        paymentStatus: types_1.PaymentStatus.COMPLETED,
        createdAt: { $gte: startDateVal, $lte: endDateVal },
    };
    const prevCompletedFilter = {
        paymentStatus: types_1.PaymentStatus.COMPLETED,
        createdAt: { $gte: prevStartDate, $lte: startDateVal },
    };
    const allOrdersFilter = { createdAt: { $gte: startDateVal, $lte: endDateVal } };
    const [currentSummary, prevSummary, dailyRevenue, topProducts, salesByCategory, revenueByPaymentMethod, orderStatusBreakdown, refundStats, newCustomers,] = await Promise.all([
        Order_1.default.aggregate([
            { $match: completedFilter },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$total' },
                    totalOrders: { $sum: 1 },
                    avgOrderValue: { $avg: '$total' },
                    totalServiceCharge: { $sum: { $ifNull: ['$serviceCharge', 0] } },
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: prevCompletedFilter },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$total' },
                    totalOrders: { $sum: 1 },
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: completedFilter },
            {
                $group: {
                    _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
                    revenue: { $sum: '$total' },
                    orders: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        Order_1.default.aggregate([
            { $match: completedFilter },
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.product',
                    productName: { $first: '$items.productName' },
                    totalSold: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                },
            },
            { $sort: { totalRevenue: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'vendorprofiles',
                    let: { productId: '$_id' },
                    pipeline: [
                        {
                            $lookup: {
                                from: 'products',
                                localField: 'user',
                                foreignField: 'vendor',
                                as: 'vp',
                            },
                        },
                        { $unwind: '$vp' },
                        { $match: { $expr: { $eq: ['$vp._id', '$$productId'] } } },
                        { $project: { _id: 1, businessName: 1 } },
                    ],
                    as: 'vendor',
                },
            },
            {
                $project: {
                    productId: '$_id',
                    productName: 1,
                    totalSold: 1,
                    totalRevenue: 1,
                    vendorId: { $arrayElemAt: ['$vendor._id', 0] },
                    businessName: { $arrayElemAt: ['$vendor.businessName', 0] },
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: completedFilter },
            { $unwind: '$items' },
            {
                $lookup: {
                    from: 'products',
                    localField: 'items.product',
                    foreignField: '_id',
                    as: 'productInfo',
                },
            },
            { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'productInfo.category',
                    foreignField: '_id',
                    as: 'categoryInfo',
                },
            },
            { $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: '$categoryInfo._id',
                    categoryName: { $first: { $ifNull: ['$categoryInfo.name', 'Uncategorized'] } },
                    revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                    itemsSold: { $sum: '$items.quantity' },
                    orders: { $sum: 1 },
                },
            },
            { $sort: { revenue: -1 } },
        ]),
        Order_1.default.aggregate([
            { $match: completedFilter },
            {
                $group: {
                    _id: '$paymentMethod',
                    revenue: { $sum: '$total' },
                    count: { $sum: 1 },
                },
            },
            { $sort: { revenue: -1 } },
        ]),
        Order_1.default.aggregate([
            { $match: allOrdersFilter },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]),
        Order_1.default.aggregate([
            { $match: { ...allOrdersFilter, status: types_1.OrderStatus.REFUNDED } },
            {
                $group: {
                    _id: null,
                    totalRefunds: { $sum: '$total' },
                    refundCount: { $sum: 1 },
                },
            },
        ]),
        User_1.default.countDocuments({
            role: 'customer',
            createdAt: { $gte: startDateVal, $lte: endDateVal },
        }),
    ]);
    const curr = currentSummary[0] || { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0, totalServiceCharge: 0 };
    const prev = prevSummary[0] || { totalRevenue: 0, totalOrders: 0 };
    const pctRevenue = prev.totalRevenue > 0
        ? Number((((curr.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100).toFixed(1))
        : null;
    const pctOrders = prev.totalOrders > 0
        ? Number((((curr.totalOrders - prev.totalOrders) / prev.totalOrders) * 100).toFixed(1))
        : null;
    res.json({
        success: true,
        data: {
            summary: {
                totalRevenue: curr.totalRevenue,
                totalOrders: curr.totalOrders,
                averageOrderValue: curr.avgOrderValue || 0,
                totalServiceCharge: curr.totalServiceCharge,
                totalRefunds: refundStats[0]?.totalRefunds || 0,
                refundCount: refundStats[0]?.refundCount || 0,
                newCustomers,
                vsLastPeriod: { revenue: pctRevenue, orders: pctOrders },
            },
            dailyRevenue,
            topProducts,
            salesByCategory,
            revenueByPaymentMethod,
            orderStatusBreakdown,
        },
    });
});
/**
 * GET /admin/reports/vendors
 * Vendor performance report — supports period (days), custom date range
 */
exports.getVendorReport = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { period = '30', startDate, endDate, limit: reportLimit = 20 } = req.query;
    const endDateVal = endDate ? new Date(endDate) : new Date();
    const startDateVal = startDate
        ? new Date(startDate)
        : new Date(endDateVal.getTime() - Number(period) * 24 * 60 * 60 * 1000);
    const completedFilter = {
        paymentStatus: types_1.PaymentStatus.COMPLETED,
        createdAt: { $gte: startDateVal, $lte: endDateVal },
    };
    const [topVendors, platformSummary, newVendors, verificationBreakdown] = await Promise.all([
        Order_1.default.aggregate([
            { $match: completedFilter },
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.vendor',
                    totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                    uniqueOrders: { $addToSet: '$_id' },
                    totalItemsSold: { $sum: '$items.quantity' },
                },
            },
            { $addFields: { totalOrders: { $size: '$uniqueOrders' } } },
            { $sort: { totalRevenue: -1 } },
            { $limit: Number(reportLimit) },
            {
                $lookup: {
                    from: 'vendorprofiles',
                    localField: '_id',
                    foreignField: 'user',
                    as: 'profile',
                },
            },
            { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    vendorId: '$profile._id',
                    userId: '$_id',
                    businessName: '$profile.businessName',
                    verificationStatus: '$profile.verificationStatus',
                    commissionRate: '$profile.commissionRate',
                    averageRating: '$profile.averageRating',
                    totalRevenue: 1,
                    totalOrders: 1,
                    totalItemsSold: 1,
                },
            },
        ]),
        VendorProfile_1.default.aggregate([
            {
                $group: {
                    _id: null,
                    totalVendors: { $sum: 1 },
                    verifiedVendors: {
                        $sum: { $cond: [{ $eq: ['$verificationStatus', types_1.VendorVerificationStatus.VERIFIED] }, 1, 0] },
                    },
                    pendingVendors: {
                        $sum: { $cond: [{ $eq: ['$verificationStatus', types_1.VendorVerificationStatus.PENDING] }, 1, 0] },
                    },
                },
            },
        ]),
        VendorProfile_1.default.countDocuments({
            createdAt: { $gte: startDateVal, $lte: endDateVal },
        }),
        VendorProfile_1.default.aggregate([
            { $group: { _id: '$verificationStatus', count: { $sum: 1 } } },
        ]),
    ]);
    const plat = platformSummary[0] || { totalVendors: 0, verifiedVendors: 0, pendingVendors: 0 };
    const totalRevenue = topVendors.reduce((sum, v) => sum + (v.totalRevenue || 0), 0);
    res.json({
        success: true,
        data: {
            summary: {
                totalVendors: plat.totalVendors,
                verifiedVendors: plat.verifiedVendors,
                pendingVendors: plat.pendingVendors,
                newVendors,
                totalRevenue,
            },
            topVendors,
            verificationBreakdown,
        },
    });
});
/**
 * GET /admin/reports/products
 * Product performance report — supports period (days), custom date range, category, sort
 */
exports.getProductReport = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { period = '30', startDate, endDate, category, sort = 'revenue', limit: reportLimit = 20 } = req.query;
    const endDateVal = endDate ? new Date(endDate) : new Date();
    const startDateVal = startDate
        ? new Date(startDate)
        : new Date(endDateVal.getTime() - Number(period) * 24 * 60 * 60 * 1000);
    const completedFilter = {
        paymentStatus: types_1.PaymentStatus.COMPLETED,
        createdAt: { $gte: startDateVal, $lte: endDateVal },
    };
    const productFilter = {};
    if (category)
        productFilter.category = new mongoose_1.default.Types.ObjectId(category);
    const sortStage = sort === 'units' ? { $sort: { totalSold: -1 } } : { $sort: { totalRevenue: -1 } };
    const [topProducts, productSummary, categoryBreakdown, lowStockProducts] = await Promise.all([
        Order_1.default.aggregate([
            { $match: completedFilter },
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.product',
                    productName: { $first: '$items.productName' },
                    totalSold: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                },
            },
            sortStage,
            { $limit: Number(reportLimit) },
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'product',
                },
            },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
            ...(category
                ? [{ $match: { 'product.category': new mongoose_1.default.Types.ObjectId(category) } }]
                : []),
            {
                $lookup: {
                    from: 'categories',
                    localField: 'product.category',
                    foreignField: '_id',
                    as: 'category',
                },
            },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'vendorprofiles',
                    localField: 'product.vendor',
                    foreignField: 'user',
                    as: 'vendorProfile',
                },
            },
            { $unwind: { path: '$vendorProfile', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    productId: '$_id',
                    productName: 1,
                    totalSold: 1,
                    totalRevenue: 1,
                    price: '$product.price',
                    views: { $ifNull: ['$product.views', 0] },
                    averageRating: { $ifNull: ['$product.averageRating', 0] },
                    stock: { $ifNull: ['$product.quantity', 0] },
                    categoryName: '$category.name',
                    categoryId: '$category._id',
                    vendorId: '$vendorProfile._id',
                    businessName: '$vendorProfile.businessName',
                    image: { $arrayElemAt: ['$product.images', 0] },
                },
            },
        ]),
        Product_1.default.aggregate([
            { $match: productFilter },
            {
                $group: {
                    _id: null,
                    totalProducts: { $sum: 1 },
                    activeProducts: {
                        $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
                    },
                    outOfStock: {
                        $sum: { $cond: [{ $lte: ['$quantity', 0] }, 1, 0] },
                    },
                    lowStock: {
                        $sum: { $cond: [{ $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', 5] }] }, 1, 0] },
                    },
                    totalViews: { $sum: { $ifNull: ['$views', 0] } },
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: completedFilter },
            { $unwind: '$items' },
            {
                $lookup: {
                    from: 'products',
                    localField: 'items.product',
                    foreignField: '_id',
                    as: 'productInfo',
                },
            },
            { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'productInfo.category',
                    foreignField: '_id',
                    as: 'categoryInfo',
                },
            },
            { $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: '$categoryInfo._id',
                    categoryName: { $first: { $ifNull: ['$categoryInfo.name', 'Uncategorized'] } },
                    revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                    itemsSold: { $sum: '$items.quantity' },
                    orderCount: { $sum: 1 },
                },
            },
            { $sort: { revenue: -1 } },
        ]),
        Product_1.default.find({ ...productFilter, status: 'active', quantity: { $lte: 5 } })
            .populate('category', 'name')
            .populate({ path: 'vendor', model: 'User', select: 'firstName lastName' })
            .sort({ quantity: 1 })
            .limit(10)
            .select('name price quantity averageRating vendor category images'),
    ]);
    const summary = productSummary[0] || { totalProducts: 0, activeProducts: 0, outOfStock: 0, lowStock: 0, totalViews: 0 };
    const totalRevenue = topProducts.reduce((sum, p) => sum + (p.totalRevenue || 0), 0);
    const totalUnitsSold = topProducts.reduce((sum, p) => sum + (p.totalSold || 0), 0);
    res.json({
        success: true,
        data: {
            summary: { ...summary, totalRevenue, totalUnitsSold },
            topProducts,
            categoryBreakdown,
            lowStockProducts,
        },
    });
});
// ================================================================
// PLATFORM SETTINGS & MISC
// ================================================================
/**
 * GET /admin/activity-log
 * Get recent platform activity
 */
exports.getActivityLog = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 30 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    // Aggregate recent activities from multiple collections
    const [recentOrders, recentSignups, recentDisputes, recentReviews] = await Promise.all([
        Order_1.default.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .select('orderNumber status total createdAt')
            .populate('user', 'firstName lastName'),
        User_1.default.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .select('firstName lastName email role createdAt'),
        Dispute_1.default.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select('disputeNumber status createdAt')
            .populate('user', 'firstName lastName'),
        Review_1.default.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select('rating status createdAt')
            .populate('user', 'firstName lastName')
            .populate('product', 'name'),
    ]);
    // Combine and sort by createdAt
    const activities = [
        ...recentOrders.map((o) => ({
            type: 'order',
            description: `Order #${o.orderNumber} - ${o.status} (₦${o.total?.toLocaleString()})`,
            user: o.user ? `${o.user.firstName} ${o.user.lastName}` : 'Unknown',
            createdAt: o.createdAt,
        })),
        ...recentSignups.map((u) => ({
            type: 'signup',
            description: `New ${u.role} registered: ${u.firstName} ${u.lastName}`,
            user: `${u.firstName} ${u.lastName}`,
            createdAt: u.createdAt,
        })),
        ...recentDisputes.map((d) => ({
            type: 'dispute',
            description: `Dispute #${d.disputeNumber} - ${d.status}`,
            user: d.user ? `${d.user.firstName} ${d.user.lastName}` : 'Unknown',
            createdAt: d.createdAt,
        })),
        ...recentReviews.map((r) => ({
            type: 'review',
            description: `${r.rating}-star review on "${r.product?.name || 'Product'}" - ${r.status}`,
            user: r.user ? `${r.user.firstName} ${r.user.lastName}` : 'Unknown',
            createdAt: r.createdAt,
        })),
    ]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limitNum);
    res.json({
        success: true,
        data: activities,
    });
});
/**
 * GET /admin/search
 * Global admin search across users, products, orders, vendors
 */
exports.globalSearch = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) {
        res.status(400).json({
            success: false,
            message: 'Search query must be at least 2 characters',
        });
        return;
    }
    const searchRegex = { $regex: q, $options: 'i' };
    const [users, products, orders, vendors] = await Promise.all([
        User_1.default.find({
            $or: [
                { firstName: searchRegex },
                { lastName: searchRegex },
                { email: searchRegex },
            ],
        })
            .select('firstName lastName email role status')
            .limit(5),
        Product_1.default.find({
            $or: [{ name: searchRegex }, { sku: searchRegex }],
        })
            .select('name slug price status images')
            .limit(5),
        Order_1.default.find({
            $or: [
                { orderNumber: searchRegex },
                { paymentReference: searchRegex },
            ],
        })
            .select('orderNumber status total createdAt')
            .populate('user', 'firstName lastName')
            .limit(5),
        VendorProfile_1.default.find({
            $or: [
                { businessName: searchRegex },
                { businessEmail: searchRegex },
            ],
        })
            .select('businessName businessEmail verificationStatus isActive')
            .populate('user', 'firstName lastName')
            .limit(5),
    ]);
    res.json({
        success: true,
        data: { users, products, orders, vendors },
    });
});
// ================================================================
// APP VERSION MANAGEMENT
// ================================================================
const DEFAULT_VERSION = {
    latestVersion: '2.1.0',
    minVersion: '2.0.0',
    iosStoreUrl: 'https://apps.apple.com/app/vendorspot/id6744490538',
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.vendorspot.app',
    updateMessage: 'A new version of VendorSpot is available. Please update to continue.',
    isForceUpdate: false,
};
exports.getAppVersionConfig = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    let config = await AppVersion_1.default.findOne().sort({ updatedAt: -1 });
    if (!config) {
        config = await AppVersion_1.default.create(DEFAULT_VERSION);
    }
    res.json({ success: true, data: config });
});
exports.updateAppVersionConfig = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { latestVersion, minVersion, iosStoreUrl, androidStoreUrl, updateMessage, isForceUpdate } = req.body;
    if (!latestVersion || !minVersion) {
        res.status(400).json({ success: false, message: 'latestVersion and minVersion are required' });
        return;
    }
    let config = await AppVersion_1.default.findOne().sort({ updatedAt: -1 });
    if (config) {
        config.latestVersion = latestVersion;
        config.minVersion = minVersion;
        config.iosStoreUrl = iosStoreUrl ?? config.iosStoreUrl;
        config.androidStoreUrl = androidStoreUrl ?? config.androidStoreUrl;
        config.updateMessage = updateMessage ?? config.updateMessage;
        config.isForceUpdate = isForceUpdate ?? config.isForceUpdate;
        await config.save();
    }
    else {
        config = await AppVersion_1.default.create({ latestVersion, minVersion, iosStoreUrl, androidStoreUrl, updateMessage, isForceUpdate });
    }
    res.json({ success: true, data: config, message: 'App version config updated successfully' });
});
// ================================================================
// REWARDS & POINTS MANAGEMENT
// ================================================================
/**
 * GET /admin/rewards/overview
 * Platform-wide rewards stats: total points, tier breakdown, VCredits, expiring points
 */
exports.getRewardsOverview = (0, ayncHandler_1.asyncHandler)(async (_req, res) => {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const TIER_THRESHOLDS = { BRONZE: 0, SILVER: 500, GOLD: 2000, PLATINUM: 5000, DIAMOND: 10000 };
    const [totalPointsResult, expiringIn7, expiringIn30, usersWithPoints, vCreditsResult, vCreditsExpiringIn7, recentTransactions, activityBreakdown,] = await Promise.all([
        PointsTransaction_1.default.aggregate([
            { $match: { type: 'earn', status: 'active' } },
            { $group: { _id: null, total: { $sum: '$points' } } },
        ]),
        PointsTransaction_1.default.countDocuments({
            type: 'earn',
            status: 'active',
            expiresAt: { $gte: now, $lte: in7Days },
        }),
        PointsTransaction_1.default.countDocuments({
            type: 'earn',
            status: 'active',
            expiresAt: { $gte: now, $lte: in30Days },
        }),
        User_1.default.countDocuments({ points: { $gt: 0 } }),
        Wallet_1.default.aggregate([
            { $match: { vCredits: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: '$vCredits' }, count: { $sum: 1 } } },
        ]),
        Wallet_1.default.countDocuments({
            vCredits: { $gt: 0 },
            vCreditsExpiresAt: { $gte: now, $lte: in7Days },
        }),
        PointsTransaction_1.default.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .populate('user', 'firstName lastName email')
            .lean(),
        PointsTransaction_1.default.aggregate([
            { $match: { type: 'earn', status: 'active' } },
            { $group: { _id: '$activity', total: { $sum: '$points' }, count: { $sum: 1 } } },
            { $sort: { total: -1 } },
        ]),
    ]);
    // Tier breakdown from User.points
    const [bronze, silver, gold, platinum, diamond] = await Promise.all([
        User_1.default.countDocuments({ points: { $gte: TIER_THRESHOLDS.BRONZE, $lt: TIER_THRESHOLDS.SILVER } }),
        User_1.default.countDocuments({ points: { $gte: TIER_THRESHOLDS.SILVER, $lt: TIER_THRESHOLDS.GOLD } }),
        User_1.default.countDocuments({ points: { $gte: TIER_THRESHOLDS.GOLD, $lt: TIER_THRESHOLDS.PLATINUM } }),
        User_1.default.countDocuments({ points: { $gte: TIER_THRESHOLDS.PLATINUM, $lt: TIER_THRESHOLDS.DIAMOND } }),
        User_1.default.countDocuments({ points: { $gte: TIER_THRESHOLDS.DIAMOND } }),
    ]);
    res.json({
        success: true,
        data: {
            totalPointsInCirculation: totalPointsResult[0]?.total ?? 0,
            usersWithPoints,
            expiringIn7Days: expiringIn7,
            expiringIn30Days: expiringIn30,
            vCredits: {
                totalBalance: vCreditsResult[0]?.total ?? 0,
                usersWithVCredits: vCreditsResult[0]?.count ?? 0,
                expiringIn7Days: vCreditsExpiringIn7,
            },
            tierBreakdown: { bronze, silver, gold, platinum, diamond },
            activityBreakdown,
            recentTransactions,
        },
    });
});
/**
 * GET /admin/rewards/users
 * Paginated list of users with their points balance and tier
 */
exports.getRewardsUsers = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search;
    const tier = req.query.tier;
    const TIER_RANGES = {
        bronze: { min: 0, max: 499 },
        silver: { min: 500, max: 1999 },
        gold: { min: 2000, max: 4999 },
        platinum: { min: 5000, max: 9999 },
        diamond: { min: 10000 },
    };
    const filter = { role: types_1.UserRole.CUSTOMER };
    if (search) {
        const re = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ firstName: re }, { lastName: re }, { email: re }];
    }
    if (tier && TIER_RANGES[tier.toLowerCase()]) {
        const range = TIER_RANGES[tier.toLowerCase()];
        filter.points = { $gte: range.min };
        if (range.max !== undefined)
            filter.points.$lte = range.max;
    }
    const [users, total] = await Promise.all([
        User_1.default.find(filter)
            .select('firstName lastName email avatar points badges loginStreak createdAt')
            .sort({ points: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        User_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: users,
        meta: (0, helpers_1.getPaginationMeta)(total, page, limit),
    });
});
/**
 * POST /admin/rewards/users/:userId/adjust
 * Manually add or deduct points from a user
 */
exports.adjustUserPoints = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { userId } = req.params;
    const { points, type, reason } = req.body;
    if (!points || typeof points !== 'number' || points <= 0) {
        res.status(400).json({ success: false, message: 'points must be a positive number' });
        return;
    }
    if (!['add', 'deduct'].includes(type)) {
        res.status(400).json({ success: false, message: 'type must be "add" or "deduct"' });
        return;
    }
    if (!reason?.trim()) {
        res.status(400).json({ success: false, message: 'reason is required' });
        return;
    }
    const user = await User_1.default.findById(userId);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    const adjustedPoints = type === 'add' ? points : -points;
    const newBalance = (user.points ?? 0) + adjustedPoints;
    if (newBalance < 0) {
        res.status(400).json({ success: false, message: 'Cannot deduct more points than user has' });
        return;
    }
    user.points = newBalance;
    await user.save();
    // Record the transaction
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    await PointsTransaction_1.default.create({
        user: userId,
        type: type === 'add' ? 'earn' : 'spend',
        activity: 'bonus',
        points: Math.abs(points),
        description: `Admin adjustment: ${reason}`,
        status: 'active',
        expiresAt: type === 'add' ? expiresAt : undefined,
    });
    res.json({
        success: true,
        message: `Successfully ${type === 'add' ? 'added' : 'deducted'} ${points} points`,
        data: { userId, newBalance, adjusted: adjustedPoints },
    });
});
/**
 * GET /admin/rewards/transactions
 * All points transactions across all users (paginated)
 */
exports.getPointsTransactions = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type;
    const activity = req.query.activity;
    const status = req.query.status;
    const search = req.query.search;
    const filter = {};
    if (type)
        filter.type = type;
    if (activity)
        filter.activity = activity;
    if (status)
        filter.status = status;
    // If search, find matching users first then filter transactions
    if (search) {
        const re = new RegExp(escapeRegex(search), 'i');
        const userIds = await User_1.default.find({ $or: [{ firstName: re }, { lastName: re }, { email: re }] })
            .select('_id')
            .lean();
        filter.user = { $in: userIds.map((u) => u._id) };
    }
    const [transactions, total] = await Promise.all([
        PointsTransaction_1.default.find(filter)
            .populate('user', 'firstName lastName email avatar')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        PointsTransaction_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: transactions,
        meta: (0, helpers_1.getPaginationMeta)(total, page, limit),
    });
});
// ================================================================
// CHALLENGE LEADERBOARD
// ================================================================
/**
 * GET /admin/challenges/:id/leaderboard
 * Top participants for a specific challenge
 */
exports.getChallengeLeaderboard = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const challenge = await Additional_1.Challenge.findById(req.params.id).lean();
    if (!challenge) {
        res.status(404).json({ success: false, message: 'Challenge not found' });
        return;
    }
    const sorted = [...challenge.participants].sort((a, b) => {
        if (b.completed !== a.completed)
            return b.completed ? 1 : -1;
        return b.progress - a.progress;
    });
    const top = sorted.slice(0, 50);
    const userIds = top.map((p) => p.user);
    const users = await User_1.default.find({ _id: { $in: userIds } })
        .select('firstName lastName email avatar')
        .lean();
    const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));
    const leaderboard = top.map((p, idx) => ({
        rank: idx + 1,
        user: userMap[p.user.toString()] ?? { _id: p.user, firstName: 'Unknown', lastName: '' },
        progress: p.progress,
        completed: p.completed,
        completedAt: p.completedAt,
        rewardClaimed: p.rewardClaimed,
        progressPercent: Math.min(100, Math.round((p.progress / challenge.targetValue) * 100)),
    }));
    res.json({
        success: true,
        data: {
            challenge: {
                _id: challenge._id,
                title: challenge.title,
                targetValue: challenge.targetValue,
                targetType: challenge.targetType,
                rewardType: challenge.rewardType,
                rewardValue: challenge.rewardValue,
                totalParticipants: challenge.participants.length,
                completedCount: challenge.participants.filter((p) => p.completed).length,
            },
            leaderboard,
        },
    });
});
//# sourceMappingURL=admin.controller.js.map