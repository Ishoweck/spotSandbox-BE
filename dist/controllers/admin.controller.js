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
exports.broadcastNotification = exports.deleteCategory = exports.updateCategory = exports.createCategory = exports.getAllCategories = exports.deleteCoupon = exports.updateCoupon = exports.createCoupon = exports.getAllCoupons = exports.addDisputeMessage = exports.resolveDispute = exports.markDisputeUnderReview = exports.getDisputeDetails = exports.getAllDisputes = exports.deleteReview = exports.updateReviewStatus = exports.getAllReviews = exports.processWithdrawal = exports.getPendingWithdrawals = exports.getAllTransactions = exports.getFinancialOverview = exports.processRefund = exports.updateOrderStatus = exports.getOrderDetails = exports.getAllOrders = exports.deleteProduct = exports.toggleProductFeatured = exports.updateProductStatus = exports.getProductDetails = exports.getAllProducts = exports.updateVendorCommission = exports.toggleVendorPremium = exports.toggleVendorStatus = exports.verifyVendor = exports.getVendorDetails = exports.fixLegacyCommissionRates = exports.getAllVendors = exports.deleteUser = exports.updateUserRole = exports.updateUserStatus = exports.getUserDetails = exports.getAllUsers = exports.removeAdmin = exports.updateAdminRole = exports.getAllAdmins = exports.createAdmin = exports.getOrderAnalytics = exports.getUserAnalytics = exports.getRevenueAnalytics = exports.getDashboard = void 0;
exports.updateAppVersionConfig = exports.getAppVersionConfig = exports.globalSearch = exports.getActivityLog = exports.getProductReport = exports.getVendorReport = exports.getSalesReport = exports.deleteChallenge = exports.updateChallenge = exports.createChallenge = exports.getAllChallenges = exports.toggleAffiliateStatus = exports.getAllAffiliates = exports.rejectAccountDeletion = exports.approveAccountDeletion = exports.getAccountDeletionRequests = exports.getNotificationHistory = void 0;
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
const helpers_1 = require("../utils/helpers");
const ayncHandler_1 = require("../utils/ayncHandler");
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
    const validAdminRoles = [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN];
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
            $in: [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN],
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
    const validAdminRoles = [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN];
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
    const currentAdminRoles = [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN];
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
    const adminRoles = [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN];
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
    const [user, wallet, orderStats, vendorProfile, pointsBalance] = await Promise.all([
        User_1.default.findById(id).select('-password -otp -resetPasswordToken -resetPasswordExpires'),
        Wallet_1.default.findOne({ user: id }),
        Order_1.default.aggregate([
            { $match: { user: new mongoose_1.default.Types.ObjectId(id) } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalSpent: { $sum: '$total' },
                    completedOrders: {
                        $sum: { $cond: [{ $eq: ['$status', types_1.OrderStatus.DELIVERED] }, 1, 0] },
                    },
                },
            },
        ]),
        VendorProfile_1.default.findOne({ user: id }),
        PointsTransaction_1.default.aggregate([
            { $match: { user: new mongoose_1.default.Types.ObjectId(id) } },
            { $group: { _id: null, totalEarned: { $sum: '$points' } } },
        ]),
    ]);
    if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
    }
    res.json({
        success: true,
        data: {
            user,
            wallet: wallet
                ? {
                    balance: wallet.balance,
                    totalEarned: wallet.totalEarned,
                    totalSpent: wallet.totalSpent,
                    totalWithdrawn: wallet.totalWithdrawn,
                    pendingBalance: wallet.pendingBalance,
                }
                : null,
            orderStats: orderStats[0] || { totalOrders: 0, totalSpent: 0, completedOrders: 0 },
            vendorProfile,
            pointsBalance: pointsBalance[0]?.totalEarned || 0,
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
    const [productStats, orderStats, recentOrders, wallet] = await Promise.all([
        Product_1.default.aggregate([
            { $match: { vendor: vendor.user._id } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: { 'items.vendor': vendor.user._id } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalRevenue: { $sum: '$total' },
                },
            },
        ]),
        Order_1.default.find({ 'items.vendor': vendor.user._id })
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('user', 'firstName lastName'),
        Wallet_1.default.findOne({ user: vendor.user._id }),
    ]);
    res.json({
        success: true,
        data: {
            vendor,
            productStats: productStats.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
            orderStats: orderStats[0] || { totalOrders: 0, totalRevenue: 0 },
            recentOrders,
            wallet: wallet
                ? {
                    balance: wallet.balance,
                    totalEarned: wallet.totalEarned,
                    pendingBalance: wallet.pendingBalance,
                }
                : null,
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
    }
    await vendor.save();
    // Send notification
    if (status === 'verified') {
        await notification_service_1.notificationService.vendorVerified(vendor.user.toString());
    }
    else {
        await notification_service_1.notificationService.vendorRejected(vendor.user.toString(), rejectionReason);
    }
    res.json({
        success: true,
        message: `Vendor ${status === 'verified' ? 'verified' : 'rejected'} successfully`,
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
    vendor.isActive = typeof isActive === 'boolean' ? isActive : !vendor.isActive;
    await vendor.save();
    // Notify vendor
    await notification_service_1.notificationService.send({
        userId: vendor.user.toString(),
        type: types_1.NotificationType.ACCOUNT,
        title: vendor.isActive ? 'Store Activated' : 'Store Deactivated',
        message: vendor.isActive
            ? 'Your vendor store has been activated by admin.'
            : 'Your vendor store has been deactivated by admin. Contact support for more info.',
    });
    res.json({
        success: true,
        message: `Vendor ${vendor.isActive ? 'activated' : 'deactivated'} successfully`,
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
    const { page = 1, limit = 20, status, paymentStatus, paymentMethod, search, startDate, endDate, sort = 'createdAt', order = 'desc', } = req.query;
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
    res.json({
        success: true,
        data: order,
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
    const [totalRevenue, totalCommissions, totalWithdrawals, pendingWithdrawals, walletBalances, monthlyRevenue,] = await Promise.all([
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED } },
            { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        Wallet_1.default.aggregate([
            { $unwind: '$transactions' },
            {
                $match: {
                    'transactions.purpose': types_1.WalletPurpose.COMMISSION,
                    'transactions.status': 'completed',
                },
            },
            { $group: { _id: null, total: { $sum: '$transactions.amount' } } },
        ]),
        Wallet_1.default.aggregate([
            { $unwind: '$transactions' },
            {
                $match: {
                    'transactions.purpose': types_1.WalletPurpose.WITHDRAWAL,
                    'transactions.status': 'completed',
                },
            },
            { $group: { _id: null, total: { $sum: '$transactions.amount' } } },
        ]),
        Wallet_1.default.aggregate([
            { $unwind: '$transactions' },
            {
                $match: {
                    'transactions.purpose': types_1.WalletPurpose.WITHDRAWAL,
                    'transactions.status': 'pending',
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$transactions.amount' },
                    count: { $sum: 1 },
                },
            },
        ]),
        Wallet_1.default.aggregate([
            {
                $group: {
                    _id: null,
                    totalBalance: { $sum: '$balance' },
                    totalPending: { $sum: '$pendingBalance' },
                },
            },
        ]),
        Order_1.default.aggregate([
            { $match: { paymentStatus: types_1.PaymentStatus.COMPLETED } },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                    },
                    revenue: { $sum: '$total' },
                    orders: { $sum: 1 },
                },
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 },
        ]),
    ]);
    res.json({
        success: true,
        data: {
            totalRevenue: totalRevenue[0]?.total || 0,
            totalCommissions: totalCommissions[0]?.total || 0,
            totalWithdrawals: totalWithdrawals[0]?.total || 0,
            pendingWithdrawals: {
                amount: pendingWithdrawals[0]?.total || 0,
                count: pendingWithdrawals[0]?.count || 0,
            },
            walletBalances: {
                totalBalance: walletBalances[0]?.totalBalance || 0,
                totalPending: walletBalances[0]?.totalPending || 0,
            },
            monthlyRevenue,
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
 * GET /admin/finance/withdrawals
 * Pending withdrawal requests
 */
exports.getPendingWithdrawals = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const pipeline = [
        { $unwind: '$transactions' },
        {
            $match: {
                'transactions.purpose': types_1.WalletPurpose.WITHDRAWAL,
                'transactions.status': status,
            },
        },
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
                        $lookup: {
                            from: 'vendorprofiles',
                            localField: 'user',
                            foreignField: 'user',
                            as: 'vendorProfile',
                        },
                    },
                    {
                        $unwind: { path: '$vendorProfile', preserveNullAndEmptyArrays: true },
                    },
                    {
                        $project: {
                            walletId: '$_id',
                            userId: '$user',
                            userName: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
                            userEmail: '$userInfo.email',
                            transaction: '$transactions',
                            payoutDetails: '$vendorProfile.payoutDetails',
                            walletBalance: '$balance',
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
// ================================================================
// REVIEW MANAGEMENT
// ================================================================
/**
 * GET /admin/reviews
 * List all reviews with filtering
 */
exports.getAllReviews = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, status, reported, rating, sort = 'createdAt', order = 'desc', } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (status)
        filter.status = status;
    if (reported === 'true')
        filter.reported = true;
    if (rating)
        filter.rating = Number(rating);
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [reviews, total] = await Promise.all([
        Review_1.default.find(filter)
            .populate('user', 'firstName lastName email')
            .populate('product', 'name images slug')
            .sort(sortObj)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        Review_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: reviews,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * PUT /admin/reviews/:id/status
 * Approve or reject a review
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
    const review = await Review_1.default.findByIdAndUpdate(id, { status, reported: false }, { new: true });
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
    res.json({
        success: true,
        message: `Review ${status}`,
        data: review,
    });
});
/**
 * DELETE /admin/reviews/:id
 * Delete a review
 */
exports.deleteReview = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const review = await Review_1.default.findByIdAndDelete(id);
    if (!review) {
        res.status(404).json({ success: false, message: 'Review not found' });
        return;
    }
    // Update product rating
    const reviews = await Review_1.default.find({ product: review.product, status: 'approved' });
    const avgRating = reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;
    await Product_1.default.findByIdAndUpdate(review.product, {
        averageRating: Math.round(avgRating * 10) / 10,
        totalReviews: reviews.length,
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
    const { page = 1, limit = 20, status, sort = 'createdAt', order = 'desc', } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (status)
        filter.status = status;
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [disputes, total] = await Promise.all([
        Dispute_1.default.find(filter)
            .populate('user', 'firstName lastName email')
            .populate('vendor', 'firstName lastName email')
            .populate('order', 'orderNumber total')
            .sort(sortObj)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        Dispute_1.default.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: disputes,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * GET /admin/disputes/:id
 * Get dispute details
 */
exports.getDisputeDetails = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const dispute = await Dispute_1.default.findById(id)
        .populate('user', 'firstName lastName email phone')
        .populate('vendor', 'firstName lastName email phone')
        .populate('order')
        .populate('messages.sender', 'firstName lastName role')
        .populate('resolvedBy', 'firstName lastName');
    if (!dispute) {
        res.status(404).json({ success: false, message: 'Dispute not found' });
        return;
    }
    res.json({
        success: true,
        data: dispute,
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
// ================================================================
// COUPON MANAGEMENT
// ================================================================
/**
 * GET /admin/coupons
 * List all coupons
 */
exports.getAllCoupons = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, active } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (active === 'true')
        filter.isActive = true;
    if (active === 'false')
        filter.isActive = false;
    const [coupons, total] = await Promise.all([
        Additional_1.Coupon.find(filter)
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        Additional_1.Coupon.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: coupons,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
    });
});
/**
 * POST /admin/coupons
 * Create a new coupon
 */
exports.createCoupon = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { code, description, discountType, discountValue, minPurchase, maxDiscount, usageLimit, validFrom, validUntil, applicableProducts, applicableCategories, excludedProducts, } = req.body;
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
    const coupon = await Additional_1.Coupon.findByIdAndUpdate(id, req.body, {
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
// ================================================================
// CATEGORY MANAGEMENT
// ================================================================
/**
 * GET /admin/categories
 * List all categories (including inactive)
 */
exports.getAllCategories = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const categories = await Category_1.default.find()
        .populate('parent', 'name slug')
        .sort({ order: 1, name: 1 });
    res.json({
        success: true,
        data: categories,
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
// ================================================================
// NOTIFICATION MANAGEMENT
// ================================================================
/**
 * POST /admin/notifications/broadcast
 * Broadcast notification to all users or a segment
 */
exports.broadcastNotification = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { title, message, type = types_1.NotificationType.SYSTEM, segment, link } = req.body;
    if (!title || !message) {
        res.status(400).json({
            success: false,
            message: 'title and message are required',
        });
        return;
    }
    // Build user filter based on segment
    const userFilter = { status: types_1.UserStatus.ACTIVE };
    if (segment === 'customers')
        userFilter.role = types_1.UserRole.CUSTOMER;
    else if (segment === 'vendors')
        userFilter.role = types_1.UserRole.VENDOR;
    else if (segment === 'affiliates')
        userFilter.isAffiliate = true;
    const users = await User_1.default.find(userFilter).select('_id');
    const userIds = users.map((u) => u._id.toString());
    if (userIds.length === 0) {
        res.status(400).json({
            success: false,
            message: 'No users match the selected segment',
        });
        return;
    }
    await notification_service_1.notificationService.sendToMany({
        userIds,
        type,
        title,
        message,
        link,
    });
    res.json({
        success: true,
        message: `Notification broadcast to ${userIds.length} user(s)`,
        data: { recipientCount: userIds.length },
    });
});
/**
 * GET /admin/notifications
 * Get notification send history (latest system-level notifications)
 */
exports.getNotificationHistory = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, type } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const filter = {};
    if (type)
        filter.type = type;
    const [notifications, total] = await Promise.all([
        Additional_1.Notification.find(filter)
            .populate('user', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum),
        Additional_1.Notification.countDocuments(filter),
    ]);
    res.json({
        success: true,
        data: notifications,
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
// ================================================================
// AFFILIATE MANAGEMENT
// ================================================================
/**
 * GET /admin/affiliates
 * List all affiliates with stats
 */
exports.getAllAffiliates = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { page = 1, limit = 20, sort = 'totalEarned', order = 'desc' } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };
    const [affiliates, total] = await Promise.all([
        Additional_1.AffiliateLink.aggregate([
            {
                $group: {
                    _id: '$user',
                    totalLinks: { $sum: 1 },
                    totalClicks: { $sum: '$clicks' },
                    totalConversions: { $sum: '$conversions' },
                    totalEarned: { $sum: '$totalEarned' },
                    activeLinks: {
                        $sum: { $cond: ['$isActive', 1, 0] },
                    },
                },
            },
            { $sort: sortObj },
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
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
                    affiliateCode: '$user.affiliateCode',
                    status: '$user.status',
                    totalLinks: 1,
                    totalClicks: 1,
                    totalConversions: 1,
                    totalEarned: 1,
                    activeLinks: 1,
                },
            },
        ]),
        User_1.default.countDocuments({ isAffiliate: true }),
    ]);
    res.json({
        success: true,
        data: affiliates,
        meta: (0, helpers_1.getPaginationMeta)(total, pageNum, limitNum),
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
 * Sales report with filters
 */
exports.getSalesReport = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    const dateFilter = { paymentStatus: types_1.PaymentStatus.COMPLETED };
    if (startDate)
        dateFilter.createdAt = { $gte: new Date(startDate) };
    if (endDate) {
        dateFilter.createdAt = dateFilter.createdAt || {};
        dateFilter.createdAt.$lte = new Date(endDate);
    }
    const dateFormat = groupBy === 'month'
        ? '%Y-%m'
        : groupBy === 'week'
            ? '%Y-W%V'
            : '%Y-%m-%d';
    const [salesData, topProducts, salesByCategory] = await Promise.all([
        Order_1.default.aggregate([
            { $match: dateFilter },
            {
                $group: {
                    _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
                    totalSales: { $sum: '$total' },
                    orderCount: { $sum: 1 },
                    avgOrderValue: { $avg: '$total' },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        Order_1.default.aggregate([
            { $match: dateFilter },
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
            { $limit: 20 },
        ]),
        Order_1.default.aggregate([
            { $match: dateFilter },
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
                    categoryName: { $first: '$categoryInfo.name' },
                    totalSales: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                    itemsSold: { $sum: '$items.quantity' },
                },
            },
            { $sort: { totalSales: -1 } },
        ]),
    ]);
    res.json({
        success: true,
        data: {
            salesData,
            topProducts,
            salesByCategory,
        },
    });
});
/**
 * GET /admin/reports/vendors
 * Vendor performance report
 */
exports.getVendorReport = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { startDate, endDate, limit: reportLimit = 20 } = req.query;
    const dateFilter = {};
    if (startDate || endDate) {
        dateFilter.createdAt = {};
        if (startDate)
            dateFilter.createdAt.$gte = new Date(startDate);
        if (endDate)
            dateFilter.createdAt.$lte = new Date(endDate);
    }
    const vendorPerformance = await Order_1.default.aggregate([
        {
            $match: {
                paymentStatus: types_1.PaymentStatus.COMPLETED,
                ...dateFilter,
            },
        },
        { $unwind: '$items' },
        {
            $group: {
                _id: '$items.vendor',
                totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                totalOrders: { $sum: 1 },
                totalItemsSold: { $sum: '$items.quantity' },
            },
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: Number(reportLimit) },
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
                vendorId: '$_id',
                firstName: '$user.firstName',
                lastName: '$user.lastName',
                email: '$user.email',
                businessName: '$profile.businessName',
                verificationStatus: '$profile.verificationStatus',
                commissionRate: '$profile.commissionRate',
                averageRating: '$profile.averageRating',
                totalRevenue: 1,
                totalOrders: 1,
                totalItemsSold: 1,
            },
        },
    ]);
    res.json({
        success: true,
        data: vendorPerformance,
    });
});
/**
 * GET /admin/reports/products
 * Product performance report
 */
exports.getProductReport = (0, ayncHandler_1.asyncHandler)(async (req, res) => {
    const { category, sort = 'totalSales', limit: reportLimit = 20 } = req.query;
    const filter = {};
    if (category)
        filter.category = new mongoose_1.default.Types.ObjectId(category);
    const sortField = sort === 'views' ? 'views' : sort === 'rating' ? 'averageRating' : 'totalSales';
    const products = await Product_1.default.find(filter)
        .populate('vendor', 'firstName lastName email')
        .populate('category', 'name')
        .sort({ [sortField]: -1 })
        .limit(Number(reportLimit))
        .select('name slug price status totalSales totalReviews averageRating views quantity isFeatured vendor category');
    res.json({
        success: true,
        data: products,
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
//# sourceMappingURL=admin.controller.js.map