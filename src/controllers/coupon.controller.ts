import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest, ApiResponse } from '../types';
import { Coupon } from '../models/Additional';
import User from '../models/User';
import { AppError } from '../middleware/error';
import { getPaginationMeta } from '../utils/helpers';

export class CouponController {
  /**
   * Create coupon
   */
  async createCoupon(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const {
      code,
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
      assignedTo,
    } = req.body;

    // Check if code exists
    const existing = await Coupon.findOne({ code: code.toUpperCase() });
    if (existing) {
      throw new AppError('Coupon code already exists', 400);
    }

    // Resolve email strings → ObjectIds so getMyCoupons can query by user ID
    let assignedToIds: mongoose.Types.ObjectId[] | undefined;
    if (assignedTo?.length) {
      const emails: string[] = (Array.isArray(assignedTo) ? assignedTo : [assignedTo])
        .map((e: string) => e.toLowerCase().trim())
        .filter(Boolean);
      if (emails.length) {
        const users = await User.find({ email: { $in: emails } }).select('_id email').lean();
        const foundEmails = users.map((u) => u.email);
        const missing = emails.filter((e) => !foundEmails.includes(e));
        if (missing.length) {
          throw new AppError(`No account found for: ${missing.join(', ')}`, 400);
        }
        assignedToIds = users.map((u) => u._id as mongoose.Types.ObjectId);
      }
    }

    const coupon = await Coupon.create({
      code: code.toUpperCase(),
      description,
      discountType,
      discountValue,
      minPurchase,
      maxDiscount,
      usageLimit,
      validFrom: new Date(validFrom),
      validUntil: new Date(validUntil),
      applicableProducts,
      applicableCategories,
      excludedProducts,
      assignedTo: assignedToIds,
    });

    res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      data: { coupon },
    });
  }

  /**
   * Get all coupons
   */
  async getCoupons(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const coupons = await Coupon.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('applicableProducts', 'name slug')
      .populate('applicableCategories', 'name slug');

    const total = await Coupon.countDocuments(filter);
    const meta = getPaginationMeta(total, page, limit);

    res.json({
      success: true,
      data: { coupons },
      meta,
    });
  }

  /**
   * Get single coupon
   */
  async getCoupon(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const coupon = await Coupon.findById(req.params.id)
      .populate('applicableProducts', 'name slug price')
      .populate('applicableCategories', 'name slug');

    if (!coupon) {
      throw new AppError('Coupon not found', 404);
    }

    res.json({
      success: true,
      data: { coupon },
    });
  }

  /**
   * Validate coupon (public)
   */
  async validateCoupon(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { code } = req.params;

    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() },
    });

    if (!coupon) {
      res.json({
        success: false,
        message: 'Invalid or expired coupon code',
        data: { valid: false },
      });
      return;
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      res.json({
        success: false,
        message: 'Coupon usage limit reached',
        data: { valid: false },
      });
      return;
    }

    // Check if coupon is restricted to specific users
    if (coupon.assignedTo && coupon.assignedTo.length > 0) {
      if (!req.user) {
        res.json({
          success: false,
          message: 'This coupon is for specific users only. Please log in.',
          data: { valid: false },
        });
        return;
      }
      const isAssigned = coupon.assignedTo.some(
        (id) => id.toString() === req.user!.id
      );
      if (!isAssigned) {
        res.json({
          success: false,
          message: 'This coupon is not available for your account',
          data: { valid: false },
        });
        return;
      }
    }

    // Check if user has already used
    if (req.user && coupon.usedBy.includes(req.user.id as any)) {
      res.json({
        success: false,
        message: 'You have already used this coupon',
        data: { valid: false },
      });
      return;
    }

    res.json({
      success: true,
      message: 'Coupon is valid',
      data: {
        valid: true,
        coupon: {
          code: coupon.code,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          minPurchase: coupon.minPurchase,
          maxDiscount: coupon.maxDiscount,
        },
      },
    });
  }

  /**
   * Update coupon
   */
  async updateCoupon(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      throw new AppError('Coupon not found', 404);
    }

    const allowedUpdates = [
      'description', 'discountType', 'discountValue', 'minPurchase', 'maxDiscount',
      'usageLimit', 'validFrom', 'validUntil', 'isActive',
      'applicableProducts', 'applicableCategories', 'excludedProducts',
    ];

    Object.keys(req.body).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        (coupon as any)[key] = req.body[key];
      }
    });

    // Resolve assignedTo emails → ObjectIds if provided
    if (req.body.assignedTo !== undefined) {
      const raw: string[] = Array.isArray(req.body.assignedTo) ? req.body.assignedTo : [req.body.assignedTo];
      const emails = raw.map((e: string) => e.toLowerCase().trim()).filter(Boolean);
      if (emails.length) {
        const users = await User.find({ email: { $in: emails } }).select('_id email').lean();
        const foundEmails = users.map((u) => u.email);
        const missing = emails.filter((e) => !foundEmails.includes(e));
        if (missing.length) throw new AppError(`No account found for: ${missing.join(', ')}`, 400);
        coupon.assignedTo = users.map((u) => u._id as mongoose.Types.ObjectId);
      } else {
        coupon.assignedTo = [];
      }
    }

    await coupon.save();

    res.json({
      success: true,
      message: 'Coupon updated successfully',
      data: { coupon },
    });
  }

  /**
   * Delete coupon
   */
  async deleteCoupon(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      throw new AppError('Coupon not found', 404);
    }

    await coupon.deleteOne();

    res.json({
      success: true,
      message: 'Coupon deleted successfully',
    });
  }

  /**
   * Get coupons assigned to the logged-in user that they haven't used yet
   * GET /api/v1/coupons/my
   */
  async getMyCoupons(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const userId = req.user!.id;
    const now = new Date();

    const coupons = await Coupon.find({
      assignedTo: userId,
      usedBy: { $ne: userId },
      isActive: true,
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    })
      .select('code description discountType discountValue minPurchase maxDiscount validUntil')
      .sort({ validUntil: 1 })
      .lean();

    res.json({
      success: true,
      data: {
        coupons,
        count: coupons.length,
      },
    });
  }

  /**
   * Get coupon usage statistics
   */
  async getCouponStats(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      throw new AppError('Coupon not found', 404);
    }

    const stats = {
      code: coupon.code,
      usageCount: coupon.usageCount,
      usageLimit: coupon.usageLimit,
      remainingUses: coupon.usageLimit ? coupon.usageLimit - coupon.usageCount : 'unlimited',
      totalUsers: coupon.usedBy.length,
      isActive: coupon.isActive,
      validFrom: coupon.validFrom,
      validUntil: coupon.validUntil,
      daysRemaining: Math.ceil(
        (coupon.validUntil.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      ),
    };

    res.json({
      success: true,
      data: { stats },
    });
  }
}

export const couponController = new CouponController();
