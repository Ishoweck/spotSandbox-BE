import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import { AffiliateLink } from '../models/Additional';
import Product from '../models/Product';
import Order from '../models/Order';
import User from '../models/User';
import VendorProfile from '../models/VendorProfile';
import { Wallet } from '../models/Additional';
import { AppError } from '../middleware/error';
import { generateAffiliateCode } from '../utils/helpers';
import { logger } from '../utils/logger';

export class AffiliateController {
  /**
   * Activate affiliate account
   */
  async activateAffiliate(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const user = await User.findById(req.user?.id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (user.isAffiliate) {
      throw new AppError('Affiliate account already activated', 400);
    }

    // Generate unique affiliate code
    let affiliateCode = generateAffiliateCode(user.email);
    
    // Ensure uniqueness
    while (await User.findOne({ affiliateCode })) {
      affiliateCode = generateAffiliateCode(user.email + Date.now());
    }

    user.isAffiliate = true;
    user.affiliateCode = affiliateCode;
    await user.save();

    // Create or get wallet
    let wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) {
      wallet = await Wallet.create({ user: user._id });
    }

    logger.info(`Affiliate activated: ${user.email}`);

    res.json({
      success: true,
      message: 'Affiliate account activated successfully',
      data: {
        affiliateCode,
        wallet: {
          balance: wallet.balance,
        },
      },
    });
  }

  /**
   * Generate affiliate link for product
   */
  async generateAffiliateLink(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.body;

    const user = await User.findById(req.user?.id);
    if (!user || !user.isAffiliate) {
      throw new AppError('Affiliate account not activated', 403);
    }

    // Verify product exists and is active
    const product = await Product.findOne({ _id: productId, status: 'active' });
    if (!product) {
      throw new AppError('Product not found or not available', 404);
    }

    if (!product.isAffiliate) {
      throw new AppError('This product does not support affiliate marketing', 400);
    }

    if (product.vendor.toString() === req.user?.id) {
      throw new AppError('You cannot create an affiliate link for your own products', 403);
    }

    // Check if link already exists
    let affiliateLink = await AffiliateLink.findOne({
      user: req.user?.id,
      product: productId,
    });

    if (!affiliateLink) {
      // Generate unique code
      const code = `${user.affiliateCode}-${product.slug.substring(0, 10)}`.toUpperCase();
      
      affiliateLink = await AffiliateLink.create({
        user: req.user?.id,
        product: productId,
        code,
      });
    }

    const affiliateUrl = `https://vendorspotng.com/products/${product.slug}?ref=${affiliateLink.code}`;

    res.json({
      success: true,
      message: 'Affiliate link generated successfully',
      data: {
        affiliateLink: {
          id: affiliateLink._id,
          code: affiliateLink.code,
          url: affiliateUrl,
          product: {
            id: product._id,
            name: product.name,
            price: product.price,
            commission: product.affiliateCommission,
          },
          clicks: affiliateLink.clicks,
          conversions: affiliateLink.conversions,
          totalEarned: affiliateLink.totalEarned,
        },
      },
    });
  }

  /**
   * Generate general affiliate link
   */
  async generateGeneralLink(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const user = await User.findById(req.user?.id);
    if (!user || !user.isAffiliate) {
      throw new AppError('Affiliate account not activated', 403);
    }

    // Check if general link exists
    let affiliateLink = await AffiliateLink.findOne({
      user: req.user?.id,
      product: null,
    });

    if (!affiliateLink) {
      affiliateLink = await AffiliateLink.create({
        user: req.user?.id,
        code: user.affiliateCode!,
      });
    }

    const affiliateUrl = `https://vendorspotng.com/affiliate/${user.affiliateCode}`;

    res.json({
      success: true,
      message: 'General affiliate link generated',
      data: {
        affiliateLink: {
          id: affiliateLink._id,
          code: user.affiliateCode,
          url: affiliateUrl,
          clicks: affiliateLink.clicks,
          conversions: affiliateLink.conversions,
          totalEarned: affiliateLink.totalEarned,
        },
      },
    });
  }

  /**
   * Track affiliate click
   */
  async trackClick(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { code } = req.params;

    const affiliateLink = await AffiliateLink.findOne({ code: code.toUpperCase() });
    if (!affiliateLink) {
      res.json({
        success: false,
        message: 'Invalid affiliate code',
      });
      return;
    }

    // Increment clicks
    affiliateLink.clicks += 1;
    await affiliateLink.save();

    res.json({
      success: true,
      message: 'Click tracked',
    });
  }

  /**
   * Get affiliate dashboard
   */
  /**
 * Get affiliate dashboard
 */
async getAffiliateDashboard(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
  const user = await User.findById(req.user?.id);
  if (!user || !user.isAffiliate) {
    throw new AppError('Affiliate account not activated', 403);
  }

  // Get all affiliate links
  const affiliateLinks = await AffiliateLink.find({ user: req.user?.id }).populate(
    'product',
    'name slug price images'
  );

  // Calculate totals from affiliate links
  const totalClicks = affiliateLinks.reduce((sum, link) => sum + link.clicks, 0);
  const totalConversions = affiliateLinks.reduce((sum, link) => sum + link.conversions, 0);
  const totalEarnings = affiliateLinks.reduce((sum, link) => sum + link.totalEarned, 0);
  const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;

  // Get all affiliate orders (completed payment)
  const allAffiliateOrders = await Order.find({
    affiliateUser: req.user?.id,
    paymentStatus: 'completed',
  }).select('affiliateCommission status createdAt');

  // Only cleared (delivered/completed) orders release commission — paid orders can still be cancelled
  const clearedCommission = allAffiliateOrders
    .filter((order) => ['delivered', 'completed'].includes(order.status))
    .reduce((sum, order) => sum + (order.affiliateCommission || 0), 0);

  // Pending = paid but not yet delivered (could still be cancelled)
  const pendingCommission = allAffiliateOrders
    .filter((order) => !['delivered', 'completed'].includes(order.status))
    .reduce((sum, order) => sum + (order.affiliateCommission || 0), 0);

  // Get wallet for withdrawal info
  const wallet = await Wallet.findOne({ user: req.user?.id });
  const totalWithdrawn = wallet?.totalWithdrawn || 0;

  // Available = only cleared commission minus what's already been withdrawn
  const availableBalance = Math.max(clearedCommission - totalWithdrawn, 0);

  // Get recent conversions
  const recentConversions = await Order.find({
    affiliateUser: req.user?.id,
    paymentStatus: 'completed',
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('orderNumber total affiliateCommission status createdAt');

  // Top performing links
  const topLinks = affiliateLinks
    .sort((a, b) => b.totalEarned - a.totalEarned)
    .slice(0, 5);

  res.json({
    success: true,
    data: {
      summary: {
        affiliateCode: user.affiliateCode,
        totalClicks,
        totalConversions,
        totalEarnings,
        conversionRate: conversionRate.toFixed(2),
        availableBalance,
        pendingBalance: pendingCommission,
        totalWithdrawn,
      },
      links: affiliateLinks,
      topPerformingLinks: topLinks,
      recentConversions,
    },
  });
}
  /**
   * Get affiliate earnings
   */
  async getAffiliateEarnings(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { period = '30days' } = req.query;

    const user = await User.findById(req.user?.id);
    if (!user || !user.isAffiliate) {
      throw new AppError('Affiliate account not activated', 403);
    }

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
      case 'all':
        startDate = new Date(0);
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get orders with affiliate commission
    const orders = await Order.find({
      affiliateUser: req.user?.id,
      paymentStatus: 'completed',
      createdAt: { $gte: startDate, $lte: endDate },
    }).sort({ createdAt: 1 });

    // Group by date
    const earningsByDate: { [key: string]: { orders: number; earnings: number } } = {};

    orders.forEach((order) => {
      const date = (order as any).createdAt.toISOString().split('T')[0];
      if (!earningsByDate[date]) {
        earningsByDate[date] = { orders: 0, earnings: 0 };
      }
      earningsByDate[date].orders += 1;
      earningsByDate[date].earnings += order.affiliateCommission || 0;
    });

    const earningsData = Object.keys(earningsByDate).map((date) => ({
      date,
      orders: earningsByDate[date].orders,
      earnings: earningsByDate[date].earnings,
    }));

    const totalOrders = orders.length;
    const totalEarnings = orders.reduce((sum, order) => sum + (order.affiliateCommission || 0), 0);

    res.json({
      success: true,
      data: {
        period,
        summary: {
          totalOrders,
          totalEarnings,
          averageCommission: totalOrders > 0 ? totalEarnings / totalOrders : 0,
        },
        earningsByDate: earningsData,
      },
    });
  }

  /**
   * Get all affiliates (Admin only)
   */
  async getAllAffiliates(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const affiliates = await User.find({ isAffiliate: true })
      .select('firstName lastName email affiliateCode createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get stats for each affiliate
    const affiliateStats = await Promise.all(
      affiliates.map(async (affiliate) => {
        const links = await AffiliateLink.find({ user: affiliate._id });
        const totalClicks = links.reduce((sum, link) => sum + link.clicks, 0);
        const totalConversions = links.reduce((sum, link) => sum + link.conversions, 0);
        const totalEarnings = links.reduce((sum, link) => sum + link.totalEarned, 0);

        return {
          ...affiliate.toObject(),
          stats: {
            totalClicks,
            totalConversions,
            totalEarnings,
            conversionRate: totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0,
          },
        };
      })
    );

    const total = await User.countDocuments({ isAffiliate: true });

    res.json({
      success: true,
      data: { affiliates: affiliateStats },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  /**
   * Get affiliate leaderboard
   */
  async getAffiliateLeaderboard(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { period = '30days', metric = 'earnings' } = req.query;

    let startDate: Date;
    const endDate = new Date();

    switch (period) {
      case '7days':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30days':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        startDate = new Date(0);
        break;
      default:
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get all affiliates
    const affiliates = await User.find({ isAffiliate: true }).select(
      'firstName lastName affiliateCode'
    );

    // Calculate scores
    const leaderboard = await Promise.all(
      affiliates.map(async (affiliate) => {
        const links = await AffiliateLink.find({ user: affiliate._id });
        const orders = await Order.find({
          affiliateUser: affiliate._id,
          paymentStatus: 'completed',
          createdAt: { $gte: startDate, $lte: endDate },
        });

        const clicks = links.reduce((sum, link) => sum + link.clicks, 0);
        const conversions = orders.length;
        const earnings = orders.reduce((sum, order) => sum + (order.affiliateCommission || 0), 0);

        let score = 0;
        if (metric === 'earnings') {
          score = earnings;
        } else if (metric === 'conversions') {
          score = conversions;
        } else if (metric === 'clicks') {
          score = clicks;
        }

        return {
          affiliate: {
            id: affiliate._id,
            name: `${affiliate.firstName} ${affiliate.lastName}`,
            code: affiliate.affiliateCode,
          },
          stats: {
            clicks,
            conversions,
            earnings,
          },
          score,
        };
      })
    );

    // Sort by score
    leaderboard.sort((a, b) => b.score - a.score);

    // Add rank
    const rankedLeaderboard = leaderboard.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

    res.json({
      success: true,
      data: {
        period,
        metric,
        leaderboard: rankedLeaderboard.slice(0, 50), // Top 50
      },
    });
  }

  /**
   * Get vendors referred by the current affiliate user
   */
  async getReferredVendors(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const user = await User.findById(req.user?.id);
    if (!user || !user.isAffiliate) {
      throw new AppError('Affiliate account not activated', 403);
    }

    const referredVendorProfiles = await VendorProfile.find({ referredBy: req.user?.id })
      .populate('user', 'firstName lastName email createdAt')
      .select('businessName businessLogo verificationStatus referredBy referralRewarded totalSales createdAt user')
      .sort({ createdAt: -1 });

    const vendors = referredVendorProfiles.map((vp) => {
      const u = vp.user as any;
      return {
        vendorId: u?._id,
        businessName: vp.businessName || (u ? `${u.firstName} ${u.lastName}` : 'Unknown'),
        businessLogo: vp.businessLogo || null,
        verificationStatus: vp.verificationStatus,
        referralRewarded: vp.referralRewarded || false,
        hasMadeSale: (vp.totalSales || 0) > 0,
        joinedAt: (vp as any).createdAt,
      };
    });

    res.json({
      success: true,
      data: { vendors, total: vendors.length },
    });
  }
}

export const affiliateController = new AffiliateController();
