// ============================================================
// COMPLETE VENDOR CONTROLLER
// File: controllers/vendor.controller.ts
// Replace your entire vendor.controller.ts with this file
// ============================================================

import { Request, Response } from 'express';
import axios from 'axios';
import { AuthRequest, ApiResponse, VendorVerificationStatus, UserRole, NotificationType } from '../types';
import VendorProfile from '../models/VendorProfile';
import Product from '../models/Product';
import Order from '../models/Order';
import User from '../models/User';
import Dispute from '../models/Dispute';
import { ChatMessage } from '../models/Additional';
import { AppError } from '../middleware/error';
import { notificationService } from '../services/notification.service';
import { logger } from '../utils/logger';

const STATS_CACHE_HOURS = 24;
const FAST_REPLY_HOURS = 24;

async function computeVendorResponseStats(
  vendorUserId: string
): Promise<{ responseRate: number; responseSpeed: number }> {
  // All unique conversations where the vendor received at least one message
  const conversations = await ChatMessage.distinct('conversationId', {
    receiver: vendorUserId,
    deleted: false,
  });

  if (conversations.length === 0) {
    return { responseRate: 100, responseSpeed: 100 };
  }

  let replied = 0;
  let repliedFast = 0;

  await Promise.all(
    conversations.map(async (convoId) => {
      // First inbound message the vendor received in this conversation
      const firstInbound = await ChatMessage.findOne({
        conversationId: convoId,
        receiver: vendorUserId,
        deleted: false,
      }).sort({ createdAt: 1 });

      if (!firstInbound) return;

      // Vendor's first reply AFTER that inbound message
      const vendorReply = await ChatMessage.findOne({
        conversationId: convoId,
        sender: vendorUserId,
        createdAt: { $gt: (firstInbound as any).createdAt },
        deleted: false,
      }).sort({ createdAt: 1 });

      if (vendorReply) {
        replied++;
        const replyMs = (vendorReply as any).createdAt.getTime() - (firstInbound as any).createdAt.getTime();
        if (replyMs <= FAST_REPLY_HOURS * 60 * 60 * 1000) {
          repliedFast++;
        }
      }
    })
  );

  const responseRate = Math.round((replied / conversations.length) * 100);
  const responseSpeed = replied > 0 ? Math.round((repliedFast / replied) * 100) : 0;

  return { responseRate, responseSpeed };
}

export class VendorController {
  /**
   * Get top vendors (Public - for home screen)
   */
  async getTopVendors(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const q = (req.query.q as string || '').trim();
    const limit = parseInt(req.query.limit as string) || (q ? 50 : 10);
    const sortBy = (req.query.sortBy as string) || 'rating';

    let sortCriteria: any = {};

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

    const baseFilter: any = { isActive: true };
    if (q) {
      baseFilter.$or = [
        { businessName: { $regex: q, $options: 'i' } },
        { businessDescription: { $regex: q, $options: 'i' } },
      ];
    } else {
      baseFilter.verificationStatus = VendorVerificationStatus.VERIFIED;
    }

    const vendors = await VendorProfile.find(baseFilter)
      .populate('user', 'firstName lastName')
      .sort(sortCriteria)
      .limit(limit)
      .select('user businessName businessDescription businessLogo businessBanner businessAddress averageRating totalReviews totalSales followers verificationStatus isPremium');

    const vendorsWithDetails = await Promise.all(
      vendors.map(async (vendor) => {
        const vendorUser = vendor.user as any;
        const productCount = await Product.countDocuments({
          vendor: vendorUser._id,
          status: 'active',
        });

        let isFollowing = false;
        if (req.user?.id) {
          isFollowing = vendor.followers?.some(id => id.toString() === req.user?.id) || false;
        }

        const addr = vendor.businessAddress as any;
        const location = addr ? [addr.city, addr.state].filter(Boolean).join(', ') : undefined;

        return {
          id: vendorUser._id,
          name: vendor.businessName,
          description: vendor.businessDescription,
          image: vendor.businessLogo || '',
          coverImage: vendor.businessBanner || '',
          location,
          rating: vendor.averageRating || 0,
          reviews: vendor.totalReviews || 0,
          totalSales: vendor.totalSales || 0,
          productCount,
          verified: vendor.verificationStatus === VendorVerificationStatus.VERIFIED,
          isPremium: (vendor as any).isPremium || false,
          followers: vendor.followers?.length || 0,
          isFollowing,
        };
      })
    );

    res.json({
      success: true,
      message: 'Top vendors fetched successfully',
      data: {
        vendors: vendorsWithDetails,
        total: vendorsWithDetails.length,
      },
    });
  }

  /**
   * Follow a vendor
   */
  async followVendor(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { vendorId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const vendorProfile = await VendorProfile.findOne({
      user: vendorId,
      isActive: true,
    });

    if (!vendorProfile) {
      throw new AppError('Vendor not found', 404);
    }

    if (vendorId === userId) {
      throw new AppError('You cannot follow yourself', 400);
    }

    const alreadyFollowing = vendorProfile.followers?.some(id => id.toString() === userId);
    
    if (alreadyFollowing) {
      throw new AppError('You are already following this vendor', 400);
    }

    if (!vendorProfile.followers) {
      vendorProfile.followers = [];
    }
    vendorProfile.followers.push(userId as any);

    await vendorProfile.save();

    logger.info(`User ${userId} followed vendor ${vendorId}`);

    // Send notification to vendor about new follower
    try {
      const followerUser = await User.findById(userId).select('firstName lastName');
      const followerName = followerUser
        ? `${followerUser.firstName} ${followerUser.lastName}`.trim()
        : 'Someone';

      await notificationService.send({
        userId: vendorId,
        type: NotificationType.SYSTEM,
        title: 'New Follower',
        message: `${followerName} started following your store!`,
        data: { followerId: userId, followersCount: vendorProfile.followers.length },
        link: '/vendor/profile',
      });
    } catch (error) {
      logger.error('Error sending follow notification:', error);
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
  async unfollowVendor(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { vendorId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const vendorProfile = await VendorProfile.findOne({
      user: vendorId,
      isActive: true,
    });

    if (!vendorProfile) {
      throw new AppError('Vendor not found', 404);
    }

    if (!vendorProfile.followers || !vendorProfile.followers.some(id => id.toString() === userId)) {
      throw new AppError('You are not following this vendor', 400);
    }

    vendorProfile.followers = vendorProfile.followers.filter(
      (followerId) => followerId.toString() !== userId
    );

    await vendorProfile.save();

    logger.info(`User ${userId} unfollowed vendor ${vendorId}`);

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
  async getFollowedVendors(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const vendors = await VendorProfile.find({
      followers: userId,
      isActive: true,
    })
      .populate('user', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('user businessName businessDescription businessLogo averageRating totalReviews totalSales followers verificationStatus');

    const total = await VendorProfile.countDocuments({
      followers: userId,
      isActive: true,
    });

    const vendorsWithDetails = await Promise.all(
      vendors.map(async (vendor) => {
        const vendorUser = vendor.user as any; // Populated user object
        const productCount = await Product.countDocuments({
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
          verified: vendor.verificationStatus === VendorVerificationStatus.VERIFIED,
          followers: vendor.followers?.length || 0,
          isFollowing: true,
        };
      })
    );

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
  async createVendorProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const {
      businessName,
      businessDescription,
      businessAddress,
      businessPhone,
      businessEmail,
      businessWebsite,
    } = req.body;

    const existingProfile = await VendorProfile.findOne({ user: req.user?.id });
    if (existingProfile) {
      throw new AppError('Vendor profile already exists', 400);
    }

    const vendorProfile = await VendorProfile.create({
      user: req.user?.id,
      businessName,
      businessDescription,
      businessAddress,
      businessPhone,
      businessEmail,
      businessWebsite,
      followers: [],
    });

    await User.findByIdAndUpdate(req.user?.id, {
      role: UserRole.VENDOR,
    });

    logger.info(`Vendor profile created: ${req.user?.id}`);

    res.status(201).json({
      success: true,
      message: 'Vendor profile created successfully',
      data: { vendorProfile },
    });
  }

  /**
   * Get vendor profile
   */
  async getVendorProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const userId = req.user?.id;

    const vendorProfile = await VendorProfile.findOne({ user: userId }).populate(
      'user',
      'firstName lastName email'
    );

    if (!vendorProfile) {
      throw new AppError('Vendor profile not found', 404);
    }

    const products = await Product.find({ vendor: userId, status: 'active' }).select('averageRating totalReviews');
    const totalWeightedRating = products.reduce((sum: number, p: any) =>
      sum + ((p.averageRating || 0) * (p.totalReviews || 0)), 0);
    const totalProductReviews = products.reduce((sum: number, p: any) => sum + (p.totalReviews || 0), 0);
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
  async updateVendorProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const vendorProfile = await VendorProfile.findOne({ user: req.user?.id });

    if (!vendorProfile) {
      throw new AppError('Vendor profile not found', 404);
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
        (vendorProfile as any)[key] = req.body[key];
      }
    });

    await vendorProfile.save();

    res.json({
      success: true,
      message: 'Vendor profile updated successfully',
      data: { vendorProfile },
    });
  }

  /**
   * Upload KYC documents
   */
  async uploadKYCDocuments(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { documents } = req.body;

    const vendorProfile = await VendorProfile.findOne({ user: req.user?.id });
    if (!vendorProfile) {
      throw new AppError('Vendor profile not found', 404);
    }

    documents.forEach((doc: any) => {
      vendorProfile.kycDocuments.push({
        type: doc.type,
        documentUrl: doc.documentUrl,
        verificationStatus: 'pending',
      });
    });

    if (vendorProfile.verificationStatus === VendorVerificationStatus.PENDING) {
      vendorProfile.verificationStatus = VendorVerificationStatus.PENDING;
    }

    await vendorProfile.save();

    logger.info(`KYC documents uploaded: ${req.user?.id}`);

    res.json({
      success: true,
      message: 'KYC documents uploaded successfully',
      data: { vendorProfile },
    });
  }

  /**
   * Update payout details
   */
  async updatePayoutDetails(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { bankName, accountNumber, accountName, bankCode } = req.body;

    const vendorProfile = await VendorProfile.findOne({ user: req.user?.id });
    if (!vendorProfile) {
      throw new AppError('Vendor profile not found', 404);
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
  async getVendorDashboard(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const vendorProfile = await VendorProfile.findOne({ user: req.user?.id });
    if (!vendorProfile) {
      throw new AppError('Vendor profile not found', 404);
    }

    // Date ranges
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

    // Products statistics
    const totalProducts = await Product.countDocuments({ vendor: req.user?.id });
    const activeProducts = await Product.countDocuments({
      vendor: req.user?.id,
      status: 'active',
    });

    const allProducts = await Product.find({ vendor: req.user?.id });
    const totalViews = allProducts.reduce((sum, p) => sum + (p.views || 0), 0);

    // Orders statistics
    const totalOrders = await Order.countDocuments({
      'items.vendor': req.user?.id,
    });

    const ordersThisMonth = await Order.countDocuments({
      'items.vendor': req.user?.id,
      createdAt: { $gte: thirtyDaysAgo },
    });

    const ordersLastMonth = await Order.countDocuments({
      'items.vendor': req.user?.id,
      createdAt: { $gte: lastMonth, $lt: thirtyDaysAgo },
    });

    const ordersThisWeek = await Order.countDocuments({
      'items.vendor': req.user?.id,
      createdAt: { $gte: sevenDaysAgo },
    });

    const ordersToday = await Order.countDocuments({
      'items.vendor': req.user?.id,
      createdAt: { $gte: today },
    });

    const ordersYesterday = await Order.countDocuments({
      'items.vendor': req.user?.id,
      createdAt: { $gte: yesterday, $lt: today },
    });

    // Sales/Revenue statistics
    const allOrders = await Order.find({
      'items.vendor': req.user?.id,
      paymentStatus: 'completed',
    });

    let totalRevenue = 0;
    let revenueThisMonth = 0;
    let revenueLastMonth = 0;
    let revenueThisWeek = 0;
    let revenueToday = 0;
    let revenueYesterday = 0;

    allOrders.forEach((order) => {
      const vendorItems = order.items.filter(
        (item) => item.vendor.toString() === req.user?.id
      );
      const orderRevenue = vendorItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      totalRevenue += orderRevenue;

      const orderDate = (order as any).createdAt;
      if (orderDate >= thirtyDaysAgo) {
        revenueThisMonth += orderRevenue;
      }
      if (orderDate >= lastMonth && orderDate < thirtyDaysAgo) {
        revenueLastMonth += orderRevenue;
      }
      if (orderDate >= sevenDaysAgo) {
        revenueThisWeek += orderRevenue;
      }
      if (orderDate >= today) {
        revenueToday += orderRevenue;
      }
      if (orderDate >= yesterday && orderDate < today) {
        revenueYesterday += orderRevenue;
      }
    });

    const platformFee = (vendorProfile.commissionRate / 100) * totalRevenue;
    const netRevenue = totalRevenue - platformFee;

    // Percentage changes
    const calculatePercentageChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const todaySalesChange = calculatePercentageChange(revenueToday, revenueYesterday);
    const ordersChange = calculatePercentageChange(ordersThisMonth, ordersLastMonth);
    const revenueChange = calculatePercentageChange(revenueThisMonth, revenueLastMonth);

    // Sales by date (for chart - last 7 days)
    const salesByDate: Array<{
      date: string;
      day: string;
      sales: number;
      orders: number;
    }> = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayOrders = await Order.find({
        'items.vendor': req.user?.id,
        paymentStatus: 'completed',
        createdAt: { $gte: date, $lt: nextDate },
      });

      const daySales = dayOrders.reduce((sum, order) => {
        const vendorItems = order.items.filter(
          (item) => item.vendor.toString() === req.user?.id
        );
        return sum + vendorItems.reduce((s, item) => s + item.price * item.quantity, 0);
      }, 0);

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      salesByDate.push({
        date: date.toISOString().split('T')[0],
        day: dayNames[date.getDay()],
        sales: daySales,
        orders: dayOrders.length,
      });
    }

    // Top products
    const topProducts = await Product.find({ vendor: req.user?.id })
      .sort({ totalSales: -1 })
      .limit(5)
      .select('name slug totalSales price images averageRating');

    // Recent orders
    const recentOrders = await Order.find({
      'items.vendor': req.user?.id,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'firstName lastName email')
      .select('orderNumber status total createdAt items');

    const filteredRecentOrders = recentOrders.map((order) => {
      const orderObj = order.toObject();
      return {
        ...orderObj,
        items: orderObj.items.filter((item: any) => item.vendor.toString() === req.user?.id),
      };
    });

    // Inventory alerts
    const lowStockProducts = await Product.find({
      vendor: req.user?.id,
      quantity: { $lte: 10, $gt: 0 },
      status: 'active',
    }).select('name slug quantity lowStockThreshold images');

    const outOfStockProducts = await Product.find({
      vendor: req.user?.id,
      quantity: 0,
    }).select('name slug images');

    // Verification progress (matches Store Setup screen: storefront, verification, bank account)
    let verificationProgress = 0;
    const totalSteps = 3;
    let completedSteps = 0;

    // 1. Storefront: theme, banner, or custom message
    const hasStorefront = !!(
      vendorProfile.storefront?.theme ||
      vendorProfile.storefront?.bannerImages?.length ||
      vendorProfile.storefront?.customMessage ||
      vendorProfile.businessBanner
    );
    if (hasStorefront) completedSteps++;

    // 2. Verification: KYC documents uploaded or verified status
    const hasVerification =
      vendorProfile.verificationStatus === 'verified' ||
      (vendorProfile.kycDocuments?.length > 0);
    if (hasVerification) completedSteps++;

    // 3. Bank account: payout details set up
    const hasBankAccount = !!(
      vendorProfile.payoutDetails?.accountNumber
    );
    if (hasBankAccount) completedSteps++;

    verificationProgress = Math.round((completedSteps / totalSteps) * 100);

    // ⭐ REWARDS TIER - Using User.points
    let rewardsTier = null;
    try {
      const user = await User.findById(req.user?.id);
      if (user && user.points !== undefined) {
        // Calculate tier based on points
        let tier = 'Bronze';
        if (user.points >= 10000) {
          tier = 'Diamond';
        } else if (user.points >= 5000) {
          tier = 'Platinum';
        } else if (user.points >= 2000) {
          tier = 'Gold';
        } else if (user.points >= 500) {
          tier = 'Silver';
        }

        // Calculate points to next tier
        const tierThresholds: { [key: string]: { min: number; next: number | null } } = {
          Bronze: { min: 0, next: 500 },
          Silver: { min: 500, next: 2000 },
          Gold: { min: 2000, next: 5000 },
          Platinum: { min: 5000, next: 10000 },
          Diamond: { min: 10000, next: null },
        };

        const currentTier = tierThresholds[tier];
        const pointsToNext = currentTier.next ? currentTier.next - user.points : 0;

        rewardsTier = {
          tier,
          points: user.points,
          pointsToNextTier: pointsToNext,
          badges: user.badges || [],
        };
      }
    } catch (error) {
      logger.warn('Error fetching user points:', error);
    }

    // Response
    res.json({
      success: true,
      data: {
        overview: {
          todaySales: revenueToday,
          todaySalesChange,
          todayOrders: ordersToday,
          totalProducts,
          activeProducts,
          totalOrders,
          ordersThisMonth,
          ordersThisWeek,
          ordersChange,
          totalViews,
          totalRevenue,
          revenueThisMonth,
          revenueThisWeek,
          revenueChange,
          netRevenue,
          platformFee,
          commissionRate: vendorProfile.commissionRate,
          averageRating: vendorProfile.averageRating,
          totalReviews: vendorProfile.totalReviews,
          followersCount: vendorProfile.followers?.length || 0,
        },
        
        salesChart: {
          daily: salesByDate,
          totalWeeklySales: salesByDate.reduce((sum, day) => sum + day.sales, 0),
          totalWeeklyOrders: salesByDate.reduce((sum, day) => sum + day.orders, 0),
          highestDay: salesByDate.reduce((max, day) => 
            day.sales > max.sales ? day : max, salesByDate[0]
          ),
        },
        
        topProducts: topProducts.map(product => ({
          id: product._id,
          name: product.name,
          slug: product.slug,
          image: product.images[0],
          totalSales: product.totalSales,
          price: product.price,
          rating: product.averageRating,
        })),
        
        recentOrders: filteredRecentOrders.map(order => {
          const user = order.user as any; // Populated user object
          return {
            id: order._id,
            orderNumber: order.orderNumber,
            status: order.status,
            total: order.total,
            createdAt: order.createdAt,
            customer: user ? {
              name: `${user.firstName} ${user.lastName}`,
              email: user.email,
            } : null,
            itemsCount: order.items.length,
          };
        }),
        
        inventory: {
          lowStockProducts: lowStockProducts.map(p => ({
            id: p._id,
            name: p.name,
            slug: p.slug,
            image: p.images[0],
            quantity: p.quantity,
            threshold: p.lowStockThreshold,
          })),
          outOfStockProducts: outOfStockProducts.map(p => ({
            id: p._id,
            name: p.name,
            slug: p.slug,
            image: p.images[0],
          })),
          lowStockCount: lowStockProducts.length,
          outOfStockCount: outOfStockProducts.length,
        },
        
        profile: {
          verificationStatus: vendorProfile.verificationStatus,
          rejectionReason: vendorProfile.rejectionReason || null,
          verificationProgress,
          isActive: vendorProfile.isActive,
          hasPayoutDetails: !!vendorProfile.payoutDetails,
          businessName: vendorProfile.businessName,
          businessLogo: vendorProfile.businessLogo,
        },
        
        rewardsTier,
      },
    });
  }

  /**
   * Get sales analytics
   */
  async getSalesAnalytics(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { period = '30days' } = req.query;

    let startDate: Date;
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

    const orders = await Order.find({
      'items.vendor': req.user?.id,
      paymentStatus: 'completed',
      createdAt: { $gte: startDate, $lte: endDate },
    }).sort({ createdAt: 1 });

    const salesByDate: { [key: string]: { orders: number; revenue: number } } = {};

    orders.forEach((order) => {
      const orderDate = (order as any).createdAt;
      const date = orderDate.toISOString().split('T')[0];
      const vendorItems = order.items.filter(
        (item) => item.vendor.toString() === req.user?.id
      );
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

    const productSales: { [key: string]: { name: string; quantity: number; revenue: number } } = {};

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
  async getAllVendors(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (req.query.verificationStatus) {
      filter.verificationStatus = req.query.verificationStatus;
    }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const vendors = await VendorProfile.find(filter)
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await VendorProfile.countDocuments(filter);

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
  async verifyVendorKYC(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { vendorId } = req.params;
    const { status, rejectionReason } = req.body;

    const vendorProfile = await VendorProfile.findById(vendorId);
    if (!vendorProfile) {
      throw new AppError('Vendor not found', 404);
    }

    if (status === 'verified') {
      vendorProfile.verificationStatus = VendorVerificationStatus.VERIFIED;
      vendorProfile.verifiedAt = new Date();
      vendorProfile.kycDocuments.forEach((doc) => {
        if (doc.verificationStatus === 'pending') {
          doc.verificationStatus = 'verified';
          doc.verifiedAt = new Date();
        }
      });
    } else if (status === 'rejected') {
      vendorProfile.verificationStatus = VendorVerificationStatus.REJECTED;
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
        await notificationService.vendorVerified(vendorUserId);
      } else if (status === 'rejected') {
        await notificationService.vendorRejected(vendorUserId, rejectionReason);
      }
    } catch (error) {
      logger.error('Error sending vendor KYC notification:', error);
    }

    logger.info(`Vendor KYC ${status}: ${vendorId}`);

    res.json({
      success: true,
      message: `Vendor ${status} successfully`,
      data: { vendorProfile },
    });
  }

  /**
   * Toggle vendor active status (Admin only)
   */
  async toggleVendorStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { vendorId } = req.params;

    const vendorProfile = await VendorProfile.findById(vendorId);
    if (!vendorProfile) {
      throw new AppError('Vendor not found', 404);
    }

    vendorProfile.isActive = !vendorProfile.isActive;
    await vendorProfile.save();

    res.json({
      success: true,
      message: `Vendor ${vendorProfile.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { vendorProfile },
    });
  }

  async toggleMyStoreStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const vendorProfile = await VendorProfile.findOne({ user: req.user?.id });
    if (!vendorProfile) {
      throw new AppError('Vendor profile not found', 404);
    }

    vendorProfile.isActive = !vendorProfile.isActive;
    await vendorProfile.save();

    res.json({
      success: true,
      message: `Store ${vendorProfile.isActive ? 'opened' : 'closed'} successfully`,
      data: { isActive: vendorProfile.isActive },
    });
  }

  /**
   * Get public vendor profile
   */
  async getPublicVendorProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { vendorId } = req.params;
    const userId = req.user?.id;

    const vendorProfile = await VendorProfile.findOne({
      user: vendorId,
      isActive: true,
    }).populate('user', 'firstName lastName');

    if (!vendorProfile) {
      throw new AppError('Vendor not found', 404);
    }

    let isFollowing = false;
    if (userId) {
      isFollowing = vendorProfile.followers?.some(id => id.toString() === userId) || false;
    }

    const [products, productCount, disputeCount, allProductSales] = await Promise.all([
      Product.find({ vendor: vendorId, status: 'active' })
        .select('name slug price images averageRating totalReviews'),
      Product.countDocuments({ vendor: vendorId, status: 'active' }),
      Dispute.countDocuments({ vendor: vendorId }),
      Product.find({ vendor: vendorId }).select('totalSales'),
    ]);

    const computedTotalSales = allProductSales.reduce((sum: number, p: any) => sum + (p.totalSales || 0), 0);

    // Compute rating from individual product reviews (VendorProfile.averageRating is not
    // updated when reviews are posted, so derive it on-the-fly from the fetched products)
    const totalWeightedRating = products.reduce((sum: number, p: any) =>
      sum + ((p.averageRating || 0) * (p.totalReviews || 0)), 0);
    const totalProductReviews = products.reduce((sum: number, p: any) => sum + (p.totalReviews || 0), 0);
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
      } catch (err) {
        logger.error('Failed to compute vendor response stats:', err);
      }
    }

    const vendorUser = vendorProfile.user as any;

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
  async getBanks(req: Request, res: Response<ApiResponse>): Promise<void> {
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
        const response = await axios.get('https://api.paystack.co/bank', {
          headers: { Authorization: `Bearer ${paystackSecret}` },
          params: { country: 'nigeria', perPage: 100 },
          timeout: 10000,
        });

        if (response.data?.status && response.data?.data) {
          const banks = response.data.data
            .filter((bank: any) => bank.active)
            .map((bank: any) => ({ name: bank.name, code: bank.code }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name));

          res.json({ success: true, data: { banks } });
          return;
        }
      }
    } catch (error) {
      logger.warn('Paystack banks API unavailable, using static list');
    }

    res.json({ success: true, data: { banks: staticBanks } });
  }
}



export const vendorController = new VendorController();

/**
 * POST /vendor/profile/set-referrer
 * Vendor records who referred them (one-time, before first sale)
 */
export const setVendorReferrer = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const { referrerId, affiliateCode } = req.body;

  if (!referrerId && !affiliateCode) {
    res.status(400).json({ success: false, message: 'referrerId or affiliateCode is required' });
    return;
  }

  const vendorProfile = await VendorProfile.findOne({ user: req.user?.id });
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
    const referrerByCode = await User.findOne({ affiliateCode: affiliateCode.toUpperCase() });
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

  const referrer = await User.findById(resolvedReferrerId);
  if (!referrer) {
    res.status(404).json({ success: false, message: 'Referrer not found' });
    return;
  }
  const referrerId_final = resolvedReferrerId;

  vendorProfile.referredBy = referrerId_final;
  await vendorProfile.save();

  const { rewardController } = await import('./reward.controller');
  await rewardController.awardVendorReferralPoints(referrerId_final, req.user!.id);

  res.json({
    success: true,
    message: 'Referrer recorded. They will receive 500 points when you make your first sale.',
  });
};