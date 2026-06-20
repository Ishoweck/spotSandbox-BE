"use strict";
// ============================================================
// COMPLETE VENDOR CONTROLLER
// File: controllers/vendor.controller.ts
// Replace your entire vendor.controller.ts with this file
// ============================================================
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
exports.setVendorReferrer = exports.vendorController = exports.VendorController = void 0;
const mongoose_1 = require("mongoose");
const axios_1 = __importDefault(require("axios"));
const types_1 = require("../types");
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const Product_1 = __importDefault(require("../models/Product"));
const Order_1 = __importDefault(require("../models/Order"));
const User_1 = __importDefault(require("../models/User"));
const Dispute_1 = __importDefault(require("../models/Dispute"));
const Additional_1 = require("../models/Additional");
const error_1 = require("../middleware/error");
const notification_service_1 = require("../services/notification.service");
const statement_service_1 = require("../services/statement.service");
const email_1 = require("../utils/email");
const LOGO_URL = `${process.env.BACKEND_URL || 'https://vapp-be.onrender.com'}/logo.png`;
const logger_1 = require("../utils/logger");
const STATS_CACHE_HOURS = 24;
const FAST_REPLY_HOURS = 24;
async function computeVendorResponseStats(vendorUserId) {
    // All unique conversations where the vendor received at least one message
    const conversations = await Additional_1.ChatMessage.distinct('conversationId', {
        receiver: vendorUserId,
        deleted: false,
    });
    if (conversations.length === 0) {
        return { responseRate: 100, responseSpeed: 100 };
    }
    let replied = 0;
    let repliedFast = 0;
    await Promise.all(conversations.map(async (convoId) => {
        // First inbound message the vendor received in this conversation
        const firstInbound = await Additional_1.ChatMessage.findOne({
            conversationId: convoId,
            receiver: vendorUserId,
            deleted: false,
        }).sort({ createdAt: 1 });
        if (!firstInbound)
            return;
        // Vendor's first reply AFTER that inbound message
        const vendorReply = await Additional_1.ChatMessage.findOne({
            conversationId: convoId,
            sender: vendorUserId,
            createdAt: { $gt: firstInbound.createdAt },
            deleted: false,
        }).sort({ createdAt: 1 });
        if (vendorReply) {
            replied++;
            const replyMs = vendorReply.createdAt.getTime() - firstInbound.createdAt.getTime();
            if (replyMs <= FAST_REPLY_HOURS * 60 * 60 * 1000) {
                repliedFast++;
            }
        }
    }));
    const responseRate = Math.round((replied / conversations.length) * 100);
    const responseSpeed = replied > 0 ? Math.round((repliedFast / replied) * 100) : 0;
    return { responseRate, responseSpeed };
}
class VendorController {
    /**
     * Get top vendors (Public - for home screen)
     */
    async getTopVendors(req, res) {
        const q = (req.query.q || '').trim();
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || (q ? 50 : 10)));
        const skip = (page - 1) * limit;
        const sortBy = req.query.sortBy || 'rating';
        let sortCriteria = {};
        switch (sortBy) {
            case 'sales':
                sortCriteria = { totalSales: -1 };
                break;
            case 'products':
                sortCriteria = { productCount: -1 };
                break;
            case 'rating':
            default:
                sortCriteria = { averageRating: -1, totalReviews: -1 };
        }
        const baseFilter = { isActive: true };
        if (q) {
            baseFilter.$or = [
                { businessName: { $regex: q, $options: 'i' } },
                { businessDescription: { $regex: q, $options: 'i' } },
            ];
        }
        else {
            baseFilter.verificationStatus = types_1.VendorVerificationStatus.VERIFIED;
        }
        const [vendors, total] = await Promise.all([
            VendorProfile_1.default.find(baseFilter)
                .populate('user', 'firstName lastName avatar')
                .sort(sortCriteria)
                .skip(skip)
                .limit(limit)
                .select('user businessName businessDescription businessLogo businessBanner businessAddress averageRating totalReviews totalSales followers verificationStatus isPremium'),
            VendorProfile_1.default.countDocuments(baseFilter),
        ]);
        const vendorsWithDetails = await Promise.all(vendors.map(async (vendor) => {
            const vendorUser = vendor.user;
            const productCount = await Product_1.default.countDocuments({
                vendor: vendorUser._id,
                status: 'active',
            });
            let isFollowing = false;
            if (req.user?.id) {
                isFollowing = vendor.followers?.some(id => id.toString() === req.user?.id) || false;
            }
            const addr = vendor.businessAddress;
            const location = addr ? [addr.city, addr.state].filter(Boolean).join(', ') : undefined;
            return {
                id: vendorUser._id,
                name: vendor.businessName,
                description: vendor.businessDescription,
                image: vendor.businessLogo || '',
                coverImage: vendor.businessBanner || '',
                userAvatar: vendorUser.avatar || '',
                firstName: vendorUser.firstName || '',
                lastName: vendorUser.lastName || '',
                location,
                rating: vendor.averageRating || 0,
                reviews: vendor.totalReviews || 0,
                totalSales: vendor.totalSales || 0,
                productCount,
                verified: vendor.verificationStatus === types_1.VendorVerificationStatus.VERIFIED,
                isPremium: vendor.isPremium || false,
                followers: vendor.followers?.length || 0,
                isFollowing,
            };
        }));
        res.json({
            success: true,
            message: 'Top vendors fetched successfully',
            data: {
                vendors: vendorsWithDetails,
                total,
            },
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNextPage: page < Math.ceil(total / limit),
                hasPrevPage: page > 1,
            },
        });
    }
    /**
     * Follow a vendor
     */
    async followVendor(req, res) {
        const { vendorId } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            throw new error_1.AppError('Authentication required', 401);
        }
        const vendorProfile = await VendorProfile_1.default.findOne({
            user: vendorId,
            isActive: true,
        });
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor not found', 404);
        }
        if (vendorId === userId) {
            throw new error_1.AppError('You cannot follow yourself', 400);
        }
        const alreadyFollowing = vendorProfile.followers?.some(id => id.toString() === userId);
        if (alreadyFollowing) {
            throw new error_1.AppError('You are already following this vendor', 400);
        }
        if (!vendorProfile.followers) {
            vendorProfile.followers = [];
        }
        vendorProfile.followers.push(userId);
        await vendorProfile.save();
        logger_1.logger.info(`User ${userId} followed vendor ${vendorId}`);
        // Send notification to vendor about new follower
        try {
            const followerUser = await User_1.default.findById(userId).select('firstName lastName');
            const followerName = followerUser
                ? `${followerUser.firstName} ${followerUser.lastName}`.trim()
                : 'Someone';
            await notification_service_1.notificationService.send({
                userId: vendorId,
                type: types_1.NotificationType.SYSTEM,
                title: 'New Follower',
                message: `${followerName} started following your store!`,
                data: { followerId: userId, followersCount: vendorProfile.followers.length },
                link: '/vendor/profile',
            });
        }
        catch (error) {
            logger_1.logger.error('Error sending follow notification:', error);
        }
        res.json({
            success: true,
            message: 'Vendor followed successfully',
            data: {
                followersCount: vendorProfile.followers.length,
                isFollowing: true,
            },
        });
    }
    /**
     * Unfollow a vendor
     */
    async unfollowVendor(req, res) {
        const { vendorId } = req.params;
        const userId = req.user?.id;
        if (!userId) {
            throw new error_1.AppError('Authentication required', 401);
        }
        const vendorProfile = await VendorProfile_1.default.findOne({
            user: vendorId,
            isActive: true,
        });
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor not found', 404);
        }
        if (!vendorProfile.followers || !vendorProfile.followers.some(id => id.toString() === userId)) {
            throw new error_1.AppError('You are not following this vendor', 400);
        }
        vendorProfile.followers = vendorProfile.followers.filter((followerId) => followerId.toString() !== userId);
        await vendorProfile.save();
        logger_1.logger.info(`User ${userId} unfollowed vendor ${vendorId}`);
        res.json({
            success: true,
            message: 'Vendor unfollowed successfully',
            data: {
                followersCount: vendorProfile.followers.length,
                isFollowing: false,
            },
        });
    }
    /**
     * Get user's followed vendors
     */
    async getFollowedVendors(req, res) {
        const userId = req.user?.id;
        if (!userId) {
            throw new error_1.AppError('Authentication required', 401);
        }
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const vendors = await VendorProfile_1.default.find({
            followers: userId,
            isActive: true,
        })
            .populate('user', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('user businessName businessDescription businessLogo averageRating totalReviews totalSales followers verificationStatus');
        const total = await VendorProfile_1.default.countDocuments({
            followers: userId,
            isActive: true,
        });
        const vendorsWithDetails = await Promise.all(vendors.map(async (vendor) => {
            const vendorUser = vendor.user; // Populated user object
            const productCount = await Product_1.default.countDocuments({
                vendor: vendorUser._id,
                status: 'active',
            });
            return {
                id: vendorUser._id,
                name: vendor.businessName,
                description: vendor.businessDescription,
                image: vendor.businessLogo || '',
                rating: vendor.averageRating || 0,
                reviews: vendor.totalReviews || 0,
                totalSales: vendor.totalSales || 0,
                productCount,
                verified: vendor.verificationStatus === types_1.VendorVerificationStatus.VERIFIED,
                followers: vendor.followers?.length || 0,
                isFollowing: true,
            };
        }));
        res.json({
            success: true,
            message: 'Followed vendors fetched successfully',
            data: {
                vendors: vendorsWithDetails,
            },
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    /**
     * Create vendor profile
     */
    async createVendorProfile(req, res) {
        const { businessName, businessDescription, businessAddress, businessPhone, businessEmail, businessWebsite, } = req.body;
        const existingProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
        if (existingProfile) {
            throw new error_1.AppError('Vendor profile already exists', 400);
        }
        const vendorProfile = await VendorProfile_1.default.create({
            user: req.user?.id,
            businessName,
            businessDescription,
            businessAddress,
            businessPhone,
            businessEmail,
            businessWebsite,
            followers: [],
        });
        await User_1.default.findByIdAndUpdate(req.user?.id, {
            role: types_1.UserRole.VENDOR,
        });
        // Sync business address into the vendor's saved user addresses
        if (businessAddress?.street && businessAddress?.city && businessAddress?.state) {
            await User_1.default.findByIdAndUpdate(req.user?.id, {
                $push: {
                    addresses: {
                        street: businessAddress.street,
                        city: businessAddress.city,
                        state: businessAddress.state,
                        country: businessAddress.country || 'Nigeria',
                        label: 'Business Address',
                        fullName: businessName || '',
                        phone: businessPhone || '',
                        isDefault: false,
                    },
                },
            });
        }
        logger_1.logger.info(`Vendor profile created: ${req.user?.id}`);
        res.status(201).json({
            success: true,
            message: 'Vendor profile created successfully',
            data: { vendorProfile },
        });
    }
    /**
     * Get vendor profile
     */
    async getVendorProfile(req, res) {
        const userId = req.user?.id;
        const vendorProfile = await VendorProfile_1.default.findOne({ user: userId }).populate('user', 'firstName lastName email');
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor profile not found', 404);
        }
        const products = await Product_1.default.find({ vendor: userId, status: 'active' }).select('averageRating totalReviews');
        const totalWeightedRating = products.reduce((sum, p) => sum + ((p.averageRating || 0) * (p.totalReviews || 0)), 0);
        const totalProductReviews = products.reduce((sum, p) => sum + (p.totalReviews || 0), 0);
        const computedAverageRating = totalProductReviews > 0
            ? Math.round((totalWeightedRating / totalProductReviews) * 10) / 10
            : (vendorProfile.averageRating || 0);
        res.json({
            success: true,
            data: {
                vendorProfile: {
                    ...vendorProfile.toObject(),
                    averageRating: computedAverageRating,
                    totalReviews: totalProductReviews || vendorProfile.totalReviews || 0,
                },
            },
        });
    }
    /**
     * Update vendor profile
     */
    async updateVendorProfile(req, res) {
        const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor profile not found', 404);
        }
        const allowedUpdates = [
            'businessName',
            'businessDescription',
            'businessLogo',
            'businessBanner',
            'businessAddress',
            'businessPhone',
            'businessEmail',
            'businessWebsite',
            'storefront',
            'socialMedia',
        ];
        Object.keys(req.body).forEach((key) => {
            if (allowedUpdates.includes(key)) {
                if (key === 'businessAddress') {
                    // Strip stale ShipBubble address code so it gets re-validated on next order
                    const { shipBubble, ...freshAddress } = req.body.businessAddress;
                    vendorProfile.businessAddress = freshAddress;
                }
                else {
                    vendorProfile[key] = req.body[key];
                }
            }
        });
        await vendorProfile.save();
        // Keep business address in sync with user's saved addresses
        if (req.body.businessAddress) {
            const ba = req.body.businessAddress;
            if (ba.street && ba.city && ba.state) {
                const user = await User_1.default.findById(req.user?.id);
                if (user) {
                    const existingIdx = user.addresses.findIndex((a) => a.label === 'Business Address');
                    if (existingIdx >= 0) {
                        user.addresses[existingIdx].street = ba.street;
                        user.addresses[existingIdx].city = ba.city;
                        user.addresses[existingIdx].state = ba.state;
                        user.addresses[existingIdx].country = ba.country || 'Nigeria';
                        if (req.body.businessName)
                            user.addresses[existingIdx].fullName = req.body.businessName;
                        if (req.body.businessPhone)
                            user.addresses[existingIdx].phone = req.body.businessPhone;
                        await user.save();
                    }
                    else {
                        await User_1.default.findByIdAndUpdate(req.user?.id, {
                            $push: {
                                addresses: {
                                    street: ba.street,
                                    city: ba.city,
                                    state: ba.state,
                                    country: ba.country || 'Nigeria',
                                    label: 'Business Address',
                                    fullName: vendorProfile.businessName || '',
                                    phone: vendorProfile.businessPhone || '',
                                    isDefault: false,
                                },
                            },
                        });
                    }
                }
            }
        }
        res.json({
            success: true,
            message: 'Vendor profile updated successfully',
            data: { vendorProfile },
        });
    }
    /**
     * Upload KYC documents
     */
    async uploadKYCDocuments(req, res) {
        const { documents } = req.body;
        const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor profile not found', 404);
        }
        documents.forEach((doc) => {
            const existingIdx = vendorProfile.kycDocuments.findIndex((d) => d.type === doc.type);
            if (existingIdx >= 0) {
                // Replace existing doc of same type — reset to pending so admin re-reviews it
                vendorProfile.kycDocuments[existingIdx].documentUrl = doc.documentUrl;
                vendorProfile.kycDocuments[existingIdx].verificationStatus = 'pending';
                vendorProfile.kycDocuments[existingIdx].verifiedAt = undefined;
                vendorProfile.kycDocuments[existingIdx].rejectionReason = undefined;
            }
            else {
                vendorProfile.kycDocuments.push({
                    type: doc.type,
                    documentUrl: doc.documentUrl,
                    verificationStatus: 'pending',
                });
            }
        });
        if (vendorProfile.verificationStatus === types_1.VendorVerificationStatus.PENDING) {
            vendorProfile.verificationStatus = types_1.VendorVerificationStatus.PENDING;
        }
        await vendorProfile.save();
        logger_1.logger.info(`KYC documents uploaded: ${req.user?.id}`);
        res.json({
            success: true,
            message: 'KYC documents uploaded successfully',
            data: { vendorProfile },
        });
    }
    /**
     * Update payout details
     */
    async updatePayoutDetails(req, res) {
        const { bankName, accountNumber, accountName, bankCode } = req.body;
        const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor profile not found', 404);
        }
        vendorProfile.payoutDetails = {
            bankName,
            accountNumber,
            accountName,
            bankCode,
        };
        await vendorProfile.save();
        res.json({
            success: true,
            message: 'Payout details updated successfully',
            data: { vendorProfile },
        });
    }
    /**
     * ============================================================
     * ⭐ ENHANCED VENDOR DASHBOARD
     * Works with User.points system (your existing rewards)
     * ============================================================
     */
    async getVendorDashboard(req, res) {
        const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
        if (!vendorProfile)
            throw new error_1.AppError('Vendor profile not found', 404);
        const vendorId = new mongoose_1.Types.ObjectId(req.user?.id);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const lastMonth = new Date(today);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        // Run all 9 independent queries in parallel — down from 23+ sequential round trips
        const [productStats, orderCounts, revenueStats, chartRaw, topProducts, recentOrders, lowStockProducts, outOfStockProducts, userDoc,] = await Promise.all([
            // 1. Product totals + views in one aggregation
            Product_1.default.aggregate([
                { $match: { vendor: vendorId } },
                { $group: {
                        _id: null,
                        total: { $sum: 1 },
                        active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
                        views: { $sum: { $ifNull: ['$views', 0] } },
                    } },
            ]),
            // 2. All order counts in one $facet — replaces 6 countDocuments calls
            Order_1.default.aggregate([
                { $match: { 'items.vendor': vendorId } },
                { $facet: {
                        total: [{ $count: 'n' }],
                        thisMonth: [{ $match: { createdAt: { $gte: thirtyDaysAgo } } }, { $count: 'n' }],
                        lastMonth: [{ $match: { createdAt: { $gte: lastMonth, $lt: thirtyDaysAgo } } }, { $count: 'n' }],
                        thisWeek: [{ $match: { createdAt: { $gte: sevenDaysAgo } } }, { $count: 'n' }],
                        today: [{ $match: { createdAt: { $gte: today } } }, { $count: 'n' }],
                        yesterday: [{ $match: { createdAt: { $gte: yesterday, $lt: today } } }, { $count: 'n' }],
                    } },
            ]),
            // 3. Revenue across all periods in one aggregation — replaces fetching all orders into memory
            Order_1.default.aggregate([
                { $match: { 'items.vendor': vendorId, paymentStatus: 'completed' } },
                { $unwind: '$items' },
                { $match: { 'items.vendor': vendorId } },
                { $group: {
                        _id: null,
                        total: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                        thisMonth: { $sum: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, { $multiply: ['$items.price', '$items.quantity'] }, 0] } },
                        lastMonth: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', lastMonth] }, { $lt: ['$createdAt', thirtyDaysAgo] }] }, { $multiply: ['$items.price', '$items.quantity'] }, 0] } },
                        thisWeek: { $sum: { $cond: [{ $gte: ['$createdAt', sevenDaysAgo] }, { $multiply: ['$items.price', '$items.quantity'] }, 0] } },
                        today: { $sum: { $cond: [{ $gte: ['$createdAt', today] }, { $multiply: ['$items.price', '$items.quantity'] }, 0] } },
                        yesterday: { $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', yesterday] }, { $lt: ['$createdAt', today] }] }, { $multiply: ['$items.price', '$items.quantity'] }, 0] } },
                    } },
            ]),
            // 4. 7-day sales chart in one aggregation — replaces 7 separate Order.find() calls
            Order_1.default.aggregate([
                { $match: { 'items.vendor': vendorId, paymentStatus: 'completed', createdAt: { $gte: sevenDaysAgo } } },
                { $unwind: '$items' },
                { $match: { 'items.vendor': vendorId } },
                { $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        sales: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                        orders: { $addToSet: '$_id' },
                    } },
                { $project: { _id: 1, sales: 1, orders: { $size: '$orders' } } },
                { $sort: { _id: 1 } },
            ]),
            // 5. Top 5 products by sales
            Product_1.default.find({ vendor: vendorId })
                .sort({ totalSales: -1 })
                .limit(5)
                .select('name slug totalSales price images averageRating')
                .lean(),
            // 6. Recent 10 orders
            Order_1.default.find({ 'items.vendor': vendorId })
                .sort({ createdAt: -1 })
                .limit(10)
                .populate('user', 'firstName lastName email')
                .select('orderNumber status total createdAt items')
                .lean(),
            // 7. Low stock products
            Product_1.default.find({ vendor: vendorId, quantity: { $lte: 10, $gt: 0 }, status: 'active' })
                .select('name slug quantity lowStockThreshold images')
                .lean(),
            // 8. Out of stock products
            Product_1.default.find({ vendor: vendorId, quantity: 0 })
                .select('name slug images')
                .lean(),
            // 9. User points for rewards tier
            User_1.default.findById(req.user?.id).select('points badges').lean(),
        ]);
        // ── Process results ─────────────────────────────────────────────────────
        const ps = productStats[0] || { total: 0, active: 0, views: 0 };
        const oc = orderCounts[0] || {};
        const rv = revenueStats[0] || { total: 0, thisMonth: 0, lastMonth: 0, thisWeek: 0, today: 0, yesterday: 0 };
        const totalOrders = oc.total?.[0]?.n || 0;
        const ordersThisMonth = oc.thisMonth?.[0]?.n || 0;
        const ordersLastMonth = oc.lastMonth?.[0]?.n || 0;
        const ordersThisWeek = oc.thisWeek?.[0]?.n || 0;
        const ordersToday = oc.today?.[0]?.n || 0;
        const totalRevenue = rv.total || 0;
        const revenueThisMonth = rv.thisMonth || 0;
        const revenueLastMonth = rv.lastMonth || 0;
        const revenueThisWeek = rv.thisWeek || 0;
        const revenueToday = rv.today || 0;
        const revenueYesterday = rv.yesterday || 0;
        const platformFee = (vendorProfile.commissionRate / 100) * totalRevenue;
        const netRevenue = totalRevenue - platformFee;
        const pct = (cur, prev) => prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
        const todaySalesChange = pct(revenueToday, revenueYesterday);
        const ordersChange = pct(ordersThisMonth, ordersLastMonth);
        const revenueChange = pct(revenueThisMonth, revenueLastMonth);
        // Build 7-day chart, filling missing days with zeros
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const chartMap = new Map(chartRaw.map(d => [d._id, d]));
        const salesByDate = Array.from({ length: 7 }, (_, i) => {
            const date = new Date(today);
            date.setDate(date.getDate() - (6 - i));
            const key = date.toISOString().split('T')[0];
            const entry = chartMap.get(key);
            return { date: key, day: dayNames[date.getDay()], sales: entry?.sales || 0, orders: entry?.orders || 0 };
        });
        // Setup progress — each step reflects what the vendor actually did, not admin decisions
        const kycDocs = vendorProfile.kycDocuments || [];
        const setupSteps = {
            storefront: {
                completed: !!(vendorProfile.storefront?.theme ||
                    vendorProfile.storefront?.bannerImages?.length ||
                    vendorProfile.storefront?.customMessage ||
                    vendorProfile.businessBanner),
            },
            verification: {
                // Completed = vendor uploaded at least one doc (admin approval is a separate status)
                completed: kycDocs.length > 0,
                status: vendorProfile.verificationStatus,
                docsUploaded: kycDocs.length,
                docsApproved: kycDocs.filter((d) => d.verificationStatus === 'verified' || d.status === 'approved').length,
            },
            bankAccount: {
                completed: !!(vendorProfile.payoutDetails?.accountNumber),
            },
        };
        const completedSteps = [setupSteps.storefront.completed, setupSteps.verification.completed, setupSteps.bankAccount.completed].filter(Boolean).length;
        const verificationProgress = Math.round((completedSteps / 3) * 100);
        // Rewards tier
        let rewardsTier = null;
        if (userDoc && userDoc.points !== undefined) {
            const points = userDoc.points;
            const tier = points >= 10000 ? 'Diamond' : points >= 5000 ? 'Platinum' : points >= 2000 ? 'Gold' : points >= 500 ? 'Silver' : 'Bronze';
            const nextThreshold = { Bronze: 500, Silver: 2000, Gold: 5000, Platinum: 10000, Diamond: null };
            rewardsTier = { tier, points, pointsToNextTier: nextThreshold[tier] ? nextThreshold[tier] - points : 0, badges: userDoc.badges || [] };
        }
        // Filter recent orders to only this vendor's items
        const filteredRecentOrders = recentOrders.map(order => ({
            ...order,
            items: order.items.filter((item) => item.vendor.toString() === req.user?.id),
        }));
        res.json({
            success: true,
            data: {
                overview: {
                    todaySales: revenueToday, todaySalesChange, todayOrders: ordersToday,
                    totalProducts: ps.total, activeProducts: ps.active,
                    totalOrders, ordersThisMonth, ordersThisWeek, ordersChange,
                    totalViews: ps.views,
                    totalRevenue, revenueThisMonth, revenueThisWeek, revenueChange,
                    netRevenue, platformFee,
                    commissionRate: vendorProfile.commissionRate,
                    averageRating: vendorProfile.averageRating,
                    totalReviews: vendorProfile.totalReviews,
                    followersCount: vendorProfile.followers?.length || 0,
                },
                salesChart: {
                    daily: salesByDate,
                    totalWeeklySales: salesByDate.reduce((s, d) => s + d.sales, 0),
                    totalWeeklyOrders: salesByDate.reduce((s, d) => s + d.orders, 0),
                    highestDay: salesByDate.reduce((max, d) => d.sales > max.sales ? d : max, salesByDate[0]),
                },
                topProducts: topProducts.map(p => ({
                    id: p._id, name: p.name, slug: p.slug, image: p.images[0],
                    totalSales: p.totalSales, price: p.price, rating: p.averageRating,
                })),
                recentOrders: filteredRecentOrders.map(order => {
                    const u = order.user;
                    return {
                        id: order._id, orderNumber: order.orderNumber, status: order.status,
                        total: order.total, createdAt: order.createdAt,
                        customer: u ? { name: `${u.firstName} ${u.lastName}`, email: u.email } : null,
                        itemsCount: order.items.length,
                    };
                }),
                inventory: {
                    lowStockProducts: lowStockProducts.map(p => ({
                        id: p._id, name: p.name, slug: p.slug, image: p.images[0],
                        quantity: p.quantity, threshold: p.lowStockThreshold,
                    })),
                    outOfStockProducts: outOfStockProducts.map(p => ({
                        id: p._id, name: p.name, slug: p.slug, image: p.images[0],
                    })),
                    lowStockCount: lowStockProducts.length,
                    outOfStockCount: outOfStockProducts.length,
                },
                profile: {
                    verificationStatus: vendorProfile.verificationStatus,
                    rejectionReason: vendorProfile.rejectionReason || null,
                    verificationProgress,
                    setupSteps,
                    setupCompleted: completedSteps,
                    setupTotal: 3,
                    isActive: vendorProfile.isActive,
                    hasPayoutDetails: !!vendorProfile.payoutDetails,
                    businessName: vendorProfile.businessName,
                    businessLogo: vendorProfile.businessLogo,
                    isPremium: vendorProfile.isPremium || false,
                },
                rewardsTier,
            },
        });
    }
    /**
     * Get sales analytics
     */
    async getSalesAnalytics(req, res) {
        const { period = '30days' } = req.query;
        let startDate;
        const endDate = new Date();
        switch (period) {
            case '7days':
                startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30days':
                startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '90days':
                startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case '1year':
                startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        const orders = await Order_1.default.find({
            'items.vendor': req.user?.id,
            paymentStatus: 'completed',
            createdAt: { $gte: startDate, $lte: endDate },
        }).sort({ createdAt: 1 });
        const salesByDate = {};
        orders.forEach((order) => {
            const orderDate = order.createdAt;
            const date = orderDate.toISOString().split('T')[0];
            const vendorItems = order.items.filter((item) => item.vendor.toString() === req.user?.id);
            const revenue = vendorItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
            if (!salesByDate[date]) {
                salesByDate[date] = { orders: 0, revenue: 0 };
            }
            salesByDate[date].orders += 1;
            salesByDate[date].revenue += revenue;
        });
        const salesData = Object.keys(salesByDate).map((date) => ({
            date,
            orders: salesByDate[date].orders,
            revenue: salesByDate[date].revenue,
        }));
        const totalOrders = salesData.reduce((sum, day) => sum + day.orders, 0);
        const totalRevenue = salesData.reduce((sum, day) => sum + day.revenue, 0);
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const productSales = {};
        orders.forEach((order) => {
            order.items
                .filter((item) => item.vendor.toString() === req.user?.id)
                .forEach((item) => {
                const productId = item.product.toString();
                if (!productSales[productId]) {
                    productSales[productId] = {
                        name: item.productName,
                        quantity: 0,
                        revenue: 0,
                    };
                }
                productSales[productId].quantity += item.quantity;
                productSales[productId].revenue += item.price * item.quantity;
            });
        });
        const topSellingProducts = Object.keys(productSales)
            .map((productId) => ({
            productId,
            ...productSales[productId],
        }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10);
        res.json({
            success: true,
            data: {
                period,
                summary: {
                    totalOrders,
                    totalRevenue,
                    averageOrderValue,
                },
                salesByDate: salesData,
                topSellingProducts,
            },
        });
    }
    /**
     * Get all vendors (Admin only)
     */
    async getAllVendors(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const filter = {};
        if (req.query.verificationStatus) {
            filter.verificationStatus = req.query.verificationStatus;
        }
        if (req.query.isActive !== undefined) {
            filter.isActive = req.query.isActive === 'true';
        }
        const vendors = await VendorProfile_1.default.find(filter)
            .populate('user', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const total = await VendorProfile_1.default.countDocuments(filter);
        res.json({
            success: true,
            data: { vendors },
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    /**
     * Verify vendor KYC (Admin only)
     */
    async verifyVendorKYC(req, res) {
        const { vendorId } = req.params;
        const { status, rejectionReason } = req.body;
        const vendorProfile = await VendorProfile_1.default.findById(vendorId);
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor not found', 404);
        }
        if (status === 'verified') {
            vendorProfile.verificationStatus = types_1.VendorVerificationStatus.VERIFIED;
            vendorProfile.verifiedAt = new Date();
            vendorProfile.kycDocuments.forEach((doc) => {
                if (doc.verificationStatus === 'pending') {
                    doc.verificationStatus = 'verified';
                    doc.verifiedAt = new Date();
                }
            });
        }
        else if (status === 'rejected') {
            vendorProfile.verificationStatus = types_1.VendorVerificationStatus.REJECTED;
            vendorProfile.kycDocuments.forEach((doc) => {
                if (doc.verificationStatus === 'pending') {
                    doc.verificationStatus = 'rejected';
                    doc.rejectionReason = rejectionReason;
                }
            });
        }
        await vendorProfile.save();
        // Notify vendor about verification status
        try {
            const vendorUserId = vendorProfile.user.toString();
            if (status === 'verified') {
                await notification_service_1.notificationService.vendorVerified(vendorUserId);
            }
            else if (status === 'rejected') {
                await notification_service_1.notificationService.vendorRejected(vendorUserId, rejectionReason);
            }
        }
        catch (error) {
            logger_1.logger.error('Error sending vendor KYC notification:', error);
        }
        logger_1.logger.info(`Vendor KYC ${status}: ${vendorId}`);
        res.json({
            success: true,
            message: `Vendor ${status} successfully`,
            data: { vendorProfile },
        });
    }
    /**
     * Toggle vendor active status (Admin only)
     */
    async toggleVendorStatus(req, res) {
        const { vendorId } = req.params;
        const vendorProfile = await VendorProfile_1.default.findById(vendorId);
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor not found', 404);
        }
        vendorProfile.isActive = !vendorProfile.isActive;
        await vendorProfile.save();
        // Cascade: hide all vendor products when deactivated, restore when reactivated
        const Product = require('../models/Product').default;
        if (vendorProfile.isActive) {
            // Restore products that were suspended by deactivation
            await Product.updateMany({ vendor: vendorProfile.user, status: 'vendor_suspended' }, { $set: { status: 'active' } });
        }
        else {
            // Suspend only currently active products; leave drafts/inactive untouched
            await Product.updateMany({ vendor: vendorProfile.user, status: 'active' }, { $set: { status: 'vendor_suspended' } });
        }
        res.json({
            success: true,
            message: `Vendor ${vendorProfile.isActive ? 'activated' : 'deactivated'} successfully`,
            data: { vendorProfile },
        });
    }
    async toggleMyStoreStatus(req, res) {
        const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor profile not found', 404);
        }
        // Rejected vendors cannot reopen their store
        if (!vendorProfile.isActive && vendorProfile.verificationStatus !== types_1.VendorVerificationStatus.VERIFIED) {
            throw new error_1.AppError('Your store cannot be opened. Please contact support.', 403);
        }
        const wasActive = vendorProfile.isActive;
        vendorProfile.isActive = !vendorProfile.isActive;
        const nowActive = vendorProfile.isActive;
        const Product = require('../models/Product').default;
        if (!nowActive && wasActive) {
            // Closing: suspend active products + notify cart customers
            const activeProdIds = await Product.find({ vendor: vendorProfile.user, status: 'active' }).select('_id').lean();
            await Product.updateMany({ vendor: vendorProfile.user, status: 'active' }, { $set: { status: 'vendor_suspended' } });
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
                    console.error('Error notifying cart customers on store close:', err.message);
                }
            }
        }
        else if (nowActive && !wasActive) {
            // Opening: restore suspended products
            await Product.updateMany({ vendor: vendorProfile.user, status: 'vendor_suspended' }, { $set: { status: 'active' } });
        }
        // Audit trail
        vendorProfile.statusHistory.push({
            action: nowActive ? 'self_opened' : 'self_closed',
            changedBy: req.user?.id,
            at: new Date(),
        });
        await vendorProfile.save();
        res.json({
            success: true,
            message: `Store ${nowActive ? 'opened' : 'closed'} successfully`,
            data: { isActive: vendorProfile.isActive },
        });
    }
    /**
     * Get public vendor profile
     */
    async getPublicVendorProfile(req, res) {
        const { vendorId } = req.params;
        const userId = req.user?.id;
        const vendorProfile = await VendorProfile_1.default.findOne({
            user: vendorId,
            isActive: true,
        }).populate('user', 'firstName lastName');
        if (!vendorProfile) {
            throw new error_1.AppError('Vendor not found', 404);
        }
        let isFollowing = false;
        if (userId) {
            isFollowing = vendorProfile.followers?.some(id => id.toString() === userId) || false;
        }
        const [products, productCount, disputeCount, allProductSales] = await Promise.all([
            Product_1.default.find({ vendor: vendorId, status: 'active' })
                .select('name slug price images averageRating totalReviews'),
            Product_1.default.countDocuments({ vendor: vendorId, status: 'active' }),
            Dispute_1.default.countDocuments({ vendor: vendorId }),
            Product_1.default.find({ vendor: vendorId }).select('totalSales'),
        ]);
        const computedTotalSales = allProductSales.reduce((sum, p) => sum + (p.totalSales || 0), 0);
        // Compute rating from individual product reviews (VendorProfile.averageRating is not
        // updated when reviews are posted, so derive it on-the-fly from the fetched products)
        const totalWeightedRating = products.reduce((sum, p) => sum + ((p.averageRating || 0) * (p.totalReviews || 0)), 0);
        const totalProductReviews = products.reduce((sum, p) => sum + (p.totalReviews || 0), 0);
        const computedAverageRating = totalProductReviews > 0
            ? Math.round((totalWeightedRating / totalProductReviews) * 10) / 10
            : (vendorProfile.averageRating || 0);
        // Recompute response stats if cache is older than STATS_CACHE_HOURS
        const cacheExpiry = new Date(Date.now() - STATS_CACHE_HOURS * 60 * 60 * 1000);
        const statsStale = !vendorProfile.statsComputedAt || vendorProfile.statsComputedAt < cacheExpiry;
        if (statsStale) {
            try {
                const stats = await computeVendorResponseStats(vendorId);
                vendorProfile.responseRate = stats.responseRate;
                vendorProfile.responseSpeed = stats.responseSpeed;
                vendorProfile.statsComputedAt = new Date();
                await vendorProfile.save();
            }
            catch (err) {
                logger_1.logger.error('Failed to compute vendor response stats:', err);
            }
        }
        const vendorUser = vendorProfile.user;
        res.json({
            success: true,
            data: {
                vendor: {
                    id: vendorUser._id,
                    businessName: vendorProfile.businessName,
                    businessDescription: vendorProfile.businessDescription,
                    businessLogo: vendorProfile.businessLogo,
                    businessBanner: vendorProfile.businessBanner,
                    businessAddress: vendorProfile.businessAddress,
                    averageRating: computedAverageRating,
                    totalReviews: totalProductReviews || vendorProfile.totalReviews || 0,
                    totalSales: computedTotalSales,
                    totalOrders: vendorProfile.totalOrders,
                    productCount,
                    disputeCount,
                    responseRate: vendorProfile.responseRate,
                    responseSpeed: vendorProfile.responseSpeed,
                    storefront: vendorProfile.storefront,
                    socialMedia: vendorProfile.socialMedia,
                    verificationStatus: vendorProfile.verificationStatus,
                    isPremium: vendorProfile.isPremium || false,
                    isActive: vendorProfile.isActive,
                    followersCount: vendorProfile.followers?.length || 0,
                    isFollowing,
                },
                products,
            },
        });
    }
    /**
     * GET /api/v1/vendor/banks
     * Get Nigerian banks list from Paystack API
     */
    async getBanks(req, res) {
        const staticBanks = [
            { name: 'Access Bank', code: '044' },
            { name: 'Citibank Nigeria', code: '023' },
            { name: 'Ecobank Nigeria', code: '050' },
            { name: 'Fidelity Bank', code: '070' },
            { name: 'First Bank of Nigeria', code: '011' },
            { name: 'First City Monument Bank', code: '214' },
            { name: 'Globus Bank', code: '00103' },
            { name: 'Guaranty Trust Bank', code: '058' },
            { name: 'Heritage Bank', code: '030' },
            { name: 'Jaiz Bank', code: '301' },
            { name: 'Keystone Bank', code: '082' },
            { name: 'Kuda Bank', code: '50211' },
            { name: 'Moniepoint MFB', code: '50515' },
            { name: 'OPay', code: '999992' },
            { name: 'PalmPay', code: '999991' },
            { name: 'Parallex Bank', code: '526' },
            { name: 'Polaris Bank', code: '076' },
            { name: 'Providus Bank', code: '101' },
            { name: 'Stanbic IBTC Bank', code: '221' },
            { name: 'Standard Chartered Bank', code: '068' },
            { name: 'Sterling Bank', code: '232' },
            { name: 'SunTrust Bank', code: '100' },
            { name: 'TAJBank', code: '302' },
            { name: 'Titan Trust Bank', code: '102' },
            { name: 'Union Bank of Nigeria', code: '032' },
            { name: 'United Bank for Africa', code: '033' },
            { name: 'Unity Bank', code: '215' },
            { name: 'VFD Microfinance Bank', code: '566' },
            { name: 'Wema Bank', code: '035' },
            { name: 'Zenith Bank', code: '057' },
        ];
        try {
            const paystackSecret = process.env.PAYSTACK_SECRET_KEY || process.env.NEXT_PUBLIC_PAYSTACK_TEST;
            if (paystackSecret) {
                const response = await axios_1.default.get('https://api.paystack.co/bank', {
                    headers: { Authorization: `Bearer ${paystackSecret}` },
                    params: { country: 'nigeria', perPage: 100 },
                    timeout: 10000,
                });
                if (response.data?.status && response.data?.data) {
                    const banks = response.data.data
                        .filter((bank) => bank.active)
                        .map((bank) => ({ name: bank.name, code: bank.code }))
                        .sort((a, b) => a.name.localeCompare(b.name));
                    res.json({ success: true, data: { banks } });
                    return;
                }
            }
        }
        catch (error) {
            logger_1.logger.warn('Paystack banks API unavailable, using static list');
        }
        res.json({ success: true, data: { banks: staticBanks } });
    }
    /**
     * POST /vendor/statement
     * Generate and email an account statement PDF for the given date range
     */
    async requestStatement(req, res) {
        const vendorId = req.user.id;
        const { startDate, endDate } = req.body;
        if (!startDate || !endDate) {
            res.status(400).json({ success: false, message: 'startDate and endDate are required' });
            return;
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            res.status(400).json({ success: false, message: 'Invalid date format' });
            return;
        }
        if (start > end) {
            res.status(400).json({ success: false, message: 'startDate must be before endDate' });
            return;
        }
        // Max range: 1 year
        const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 366) {
            res.status(400).json({ success: false, message: 'Date range cannot exceed 1 year' });
            return;
        }
        const user = await User_1.default.findById(vendorId).select('email firstName').lean();
        if (!user?.email) {
            res.status(404).json({ success: false, message: 'Vendor account not found' });
            return;
        }
        // Respond immediately — PDF generation runs after
        res.json({
            success: true,
            message: `Your statement is being prepared and will be sent to ${user.email} shortly.`,
        });
        // Generate + email asynchronously (don't await — response already sent)
        (async () => {
            try {
                const data = await (0, statement_service_1.gatherStatementData)(vendorId, start, end);
                const pdfBuf = await (0, statement_service_1.generateStatementPDF)(data);
                const startLabel = start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const endLabel = end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const filename = `Vendorspot_Statement_${startLabel.replace(/ /g, '-')}_to_${endLabel.replace(/ /g, '-')}.pdf`;
                await (0, email_1.sendEmail)({
                    to: user.email,
                    subject: `Your Vendorspot Account Statement (${startLabel} – ${endLabel})`,
                    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;" cellspacing="0" cellpadding="0" border="0">

          <!-- Logo -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <img src="${LOGO_URL}" alt="Vendorspot" width="38" height="38" style="display:block;width:38px;height:38px;" />
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:22px;font-weight:800;color:#111111;letter-spacing:-0.5px;">endorspot</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#111111;line-height:1.3;">Your Account Statement is Ready</h1>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;">Hi ${user.firstName || 'there'},</p>
              <p style="margin:0 0 14px 0;font-size:15px;color:#374151;line-height:1.6;">
                Your account statement for <strong>${startLabel} – ${endLabel}</strong> is attached to this email as a PDF.
              </p>
            </td>
          </tr>

          <!-- What's inside box -->
          <tr>
            <td style="padding:16px 32px 0 32px;">
              <div style="background:#fff0f5;border-radius:8px;padding:16px 20px;">
                <p style="margin:0 0 10px 0;font-size:12px;font-weight:700;color:#CC3366;letter-spacing:0.5px;text-transform:uppercase;">What's inside the PDF</p>
                ${[
                        ['&#128722;', '<strong>All orders</strong> from your store in the period — every status (pending, processing, delivered, cancelled)'],
                        ['&#128200;', '<strong>Revenue breakdown</strong> — gross sales from all orders + earned revenue from delivered orders only'],
                        ['&#128179;', '<strong>Wallet summary</strong> — current balance, pending balance, and every credit & debit transaction'],
                        ['&#9878;&#65039;', '<strong>Disputes</strong> — all disputes raised against your store and their resolutions'],
                    ].map(([icon, text]) => `
                <p style="margin:0 0 8px 0;font-size:13px;color:#7b3555;line-height:1.5;">
                  <span style="margin-right:8px;">${icon}</span>${text}
                </p>`).join('')}
              </div>
            </td>
          </tr>

          <!-- Note -->
          <tr>
            <td style="padding:20px 32px 0 32px;">
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                If you didn't request this statement or have questions about the data, contact us at
                <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- Support footer -->
          <tr>
            <td style="padding:20px 32px;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">
                Need help? <a href="mailto:support@vendorspotng.com" style="color:#CC3366;text-decoration:none;">support@vendorspotng.com</a>
              </p>
              <p style="margin:0;font-size:13px;color:#374151;">
                <strong>Vendorspot</strong> — Confidence in every click.
              </p>
            </td>
          </tr>

          <!-- Legal footer -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
                You're receiving this email because you requested an account statement on Vendorspot.<br />
                &copy; ${new Date().getFullYear()} Vendorspot (TheSpot) Ltd. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
          `,
                    attachments: [{ filename, content: pdfBuf }],
                });
                logger_1.logger.info(`Account statement emailed to ${user.email} for ${startLabel} – ${endLabel}`);
            }
            catch (err) {
                logger_1.logger.error('Failed to generate/send vendor statement:', err);
            }
        })();
    }
}
exports.VendorController = VendorController;
exports.vendorController = new VendorController();
/**
 * POST /vendor/profile/set-referrer
 * Vendor records who referred them (one-time, before first sale)
 */
const setVendorReferrer = async (req, res) => {
    const { referrerId, affiliateCode } = req.body;
    if (!referrerId && !affiliateCode) {
        res.status(400).json({ success: false, message: 'referrerId or affiliateCode is required' });
        return;
    }
    const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
    if (!vendorProfile) {
        res.status(404).json({ success: false, message: 'Vendor profile not found' });
        return;
    }
    if (vendorProfile.referredBy) {
        res.status(400).json({ success: false, message: 'Referrer already set' });
        return;
    }
    // Resolve referrer by affiliate code if referrerId not provided
    let resolvedReferrerId = referrerId;
    if (!resolvedReferrerId && affiliateCode) {
        const referrerByCode = await User_1.default.findOne({ affiliateCode: affiliateCode.toUpperCase() });
        if (!referrerByCode) {
            res.status(404).json({ success: false, message: 'Invalid affiliate code' });
            return;
        }
        resolvedReferrerId = referrerByCode._id.toString();
    }
    if (resolvedReferrerId === req.user?.id) {
        res.status(400).json({ success: false, message: 'You cannot refer yourself' });
        return;
    }
    const referrer = await User_1.default.findById(resolvedReferrerId);
    if (!referrer) {
        res.status(404).json({ success: false, message: 'Referrer not found' });
        return;
    }
    const referrerId_final = resolvedReferrerId;
    vendorProfile.referredBy = referrerId_final;
    await vendorProfile.save();
    const { rewardController } = await Promise.resolve().then(() => __importStar(require('./reward.controller')));
    await rewardController.awardVendorReferralPoints(referrerId_final, req.user.id);
    res.json({
        success: true,
        message: 'Referrer recorded. They will receive 500 points when you make your first sale.',
    });
};
exports.setVendorReferrer = setVendorReferrer;
//# sourceMappingURL=vendor.controller.js.map