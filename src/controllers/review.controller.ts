import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest, ApiResponse } from '../types';
import Review from '../models/Review';
import Product from '../models/Product';
import Order from '../models/Order';
import User from '../models/User';
import Wallet from '../models/Wallet';
import VendorProfile from '../models/VendorProfile';
import { AppError } from '../middleware/error';
import { notificationService } from '../services/notification.service';
import { logger } from '../utils/logger';
import { rewardController } from './reward.controller';

const VERIFIED_BUYER_THRESHOLD = 5000; // ₦5,000 minimum spend for verified buyer badge

export class ReviewController {
  /**
   * Create review
   */
  async createReview(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId, orderId, rating, comment, images } = req.body;

    // Check if user has purchased this product in this order
    const hasPurchased = await Order.findOne({
      _id: orderId,
      user: req.user?.id,
      'items.product': productId,
      paymentStatus: 'completed',
    });

    if (!hasPurchased) {
      throw new AppError('You can only review products you have purchased', 400);
    }

    // Check if user has already reviewed this product for this order
    const existingReview = await Review.findOne({
      user: req.user?.id,
      product: productId,
      order: orderId,
    });

    if (existingReview) {
      throw new AppError('You have already reviewed this product', 400);
    }

    // Check if user qualifies as a verified buyer (spent >= ₦5,000 on the platform)
    let isVerifiedBuyer = false;
    try {
      const wallet = await Wallet.findOne({ user: req.user?.id });
      if (wallet && wallet.totalSpent >= VERIFIED_BUYER_THRESHOLD) {
        isVerifiedBuyer = true;
      } else {
        // Fallback: sum completed orders if wallet doesn't track totalSpent
        const completedOrders = await Order.aggregate([
          { $match: { user: new mongoose.Types.ObjectId(req.user?.id), paymentStatus: 'completed', total: { $gte: 0 } } },
          { $group: { _id: null, totalSpent: { $sum: '$total' } } },
        ]);
        if (completedOrders.length > 0 && completedOrders[0].totalSpent >= VERIFIED_BUYER_THRESHOLD) {
          isVerifiedBuyer = true;
        }
      }
    } catch (error) {
      logger.error('Error checking verified buyer status:', error);
    }

    // Create review
    const review = await Review.create({
      user: req.user?.id,
      product: productId,
      order: orderId,
      rating,
      comment,
      images: images || [],
      verified: isVerifiedBuyer,
    });

    // Update product rating
    await this.updateProductRating(productId);

    // Notify vendor about new review
    try {
      const product = await Product.findById(productId).select('vendor name');
      const reviewer = await User.findById(req.user?.id).select('firstName lastName');
      if (product && reviewer) {
        await notificationService.newReviewOnProduct(
          product.vendor.toString(),
          product.name,
          rating,
          `${reviewer.firstName} ${reviewer.lastName}`
        );
      }
    } catch (error) {
      logger.error('Error sending review notification:', error);
    }

    // Check for review-related badges (non-blocking)
    rewardController.checkBadges(req.user!.id).catch(() => {});

    logger.info(`Review created: ${review._id} for product ${productId} on order ${orderId}`);

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: { review },
    });
  }

  /**
   * Get product reviews
   */
  async getProductReviews(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const allowedSortFields = ['createdAt', 'rating', 'helpful'];
    const sortBy = allowedSortFields.includes(req.query.sortBy as string)
      ? (req.query.sortBy as string)
      : 'createdAt';

    const filter: any = { product: productId };
    if (req.query.rating) {
      filter.rating = parseInt(req.query.rating as string);
    }

    const reviews = await Review.find(filter)
      .populate('user', 'firstName lastName avatar')
      .sort({ [sortBy]: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments(filter);

    // Get rating distribution
    const distribution = await Review.aggregate([
      { $match: { product: productId } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        distribution,
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
   * Update review
   */
  async updateReview(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { reviewId } = req.params;

    const review = await Review.findOne({
      _id: reviewId,
      user: req.user?.id,
    });

    if (!review) {
      throw new AppError('Review not found', 404);
    }

    const allowedUpdates = ['rating', 'comment', 'images'];
    Object.keys(req.body).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        (review as any)[key] = req.body[key];
      }
    });

    await review.save();

    // Update product rating
    await this.updateProductRating(review.product.toString());

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: { review },
    });
  }

  /**
   * Delete review
   */
  async deleteReview(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { reviewId } = req.params;

    const review = await Review.findOne({
      _id: reviewId,
      user: req.user?.id,
    });

    if (!review) {
      throw new AppError('Review not found', 404);
    }

    const productId = review.product.toString();
    await review.deleteOne();

    // Update product rating
    await this.updateProductRating(productId);

    res.json({
      success: true,
      message: 'Review deleted successfully',
    });
  }

  /**
   * Mark review as helpful
   */
  async markHelpful(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);
    if (!review) {
      throw new AppError('Review not found', 404);
    }

    // Check if user already marked as helpful
    if (review.helpfulBy.includes(req.user?.id as any)) {
      throw new AppError('You have already marked this review as helpful', 400);
    }

    review.helpful += 1;
    review.helpfulBy.push(req.user?.id as any);
    await review.save();

    res.json({
      success: true,
      message: 'Review marked as helpful',
      data: { helpful: review.helpful },
    });
  }

  /**
   * Report review
   */
  async reportReview(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { reviewId } = req.params;
    const { reason } = req.body;

    const review = await Review.findById(reviewId);
    if (!review) {
      throw new AppError('Review not found', 404);
    }

    review.reported = true;
    review.reportReason = reason;
    await review.save();

    logger.info(`Review reported: ${reviewId} by user ${req.user?.id}`);

    res.json({
      success: true,
      message: 'Review reported successfully',
    });
  }

  /**
   * Get user's reviews
   */
  async getUserReviews(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({ user: req.user?.id })
      .populate('product', 'name slug images price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments({ user: req.user?.id });

    res.json({
      success: true,
      data: { reviews },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  /**
   * Update product rating then roll up to the vendor profile.
   */
  private async updateProductRating(productId: string): Promise<void> {
    const reviews = await Review.find({ product: productId });

    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;

    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      {
        averageRating: Math.round(averageRating * 10) / 10,
        totalReviews: reviews.length,
      },
      { new: true }
    );

    // Roll up to vendor profile
    if (updatedProduct?.vendor) {
      await this.updateVendorRating(updatedProduct.vendor.toString());
    }
  }

  /**
   * Recompute vendor averageRating and totalReviews from all their products.
   */
  private async updateVendorRating(vendorUserId: string): Promise<void> {
    const products = await Product.find({ vendor: vendorUserId }).select('averageRating totalReviews');

    const totalReviews = products.reduce((sum, p) => sum + (p.totalReviews || 0), 0);
    const weightedSum = products.reduce((sum, p) => sum + ((p.averageRating || 0) * (p.totalReviews || 0)), 0);
    const averageRating = totalReviews > 0
      ? Math.round((weightedSum / totalReviews) * 10) / 10
      : 0;

    await VendorProfile.findOneAndUpdate(
      { user: vendorUserId },
      { averageRating, totalReviews }
    );
  }
}

export const reviewController = new ReviewController();