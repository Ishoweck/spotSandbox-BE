"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewController = exports.ReviewController = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Review_1 = __importDefault(require("../models/Review"));
const Product_1 = __importDefault(require("../models/Product"));
const Order_1 = __importDefault(require("../models/Order"));
const User_1 = __importDefault(require("../models/User"));
const Wallet_1 = __importDefault(require("../models/Wallet"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const error_1 = require("../middleware/error");
const notification_service_1 = require("../services/notification.service");
const logger_1 = require("../utils/logger");
const reward_controller_1 = require("./reward.controller");
const VERIFIED_BUYER_THRESHOLD = 5000; // ₦5,000 minimum spend for verified buyer badge
class ReviewController {
    /**
     * Create review
     */
    async createReview(req, res) {
        const { productId, orderId, rating, comment, images } = req.body;
        // Check if user has purchased this product in this order
        const hasPurchased = await Order_1.default.findOne({
            _id: orderId,
            user: req.user?.id,
            'items.product': productId,
            paymentStatus: 'completed',
        });
        if (!hasPurchased) {
            throw new error_1.AppError('You can only review products you have purchased', 400);
        }
        // Check if user has already reviewed this product for this order
        const existingReview = await Review_1.default.findOne({
            user: req.user?.id,
            product: productId,
            order: orderId,
        });
        if (existingReview) {
            throw new error_1.AppError('You have already reviewed this product', 400);
        }
        // Check if user qualifies as a verified buyer (spent >= ₦5,000 on the platform)
        let isVerifiedBuyer = false;
        try {
            const wallet = await Wallet_1.default.findOne({ user: req.user?.id });
            if (wallet && wallet.totalSpent >= VERIFIED_BUYER_THRESHOLD) {
                isVerifiedBuyer = true;
            }
            else {
                // Fallback: sum completed orders if wallet doesn't track totalSpent
                const completedOrders = await Order_1.default.aggregate([
                    { $match: { user: new mongoose_1.default.Types.ObjectId(req.user?.id), paymentStatus: 'completed', total: { $gte: 0 } } },
                    { $group: { _id: null, totalSpent: { $sum: '$total' } } },
                ]);
                if (completedOrders.length > 0 && completedOrders[0].totalSpent >= VERIFIED_BUYER_THRESHOLD) {
                    isVerifiedBuyer = true;
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error checking verified buyer status:', error);
        }
        // Create review
        const review = await Review_1.default.create({
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
            const product = await Product_1.default.findById(productId).select('vendor name');
            const reviewer = await User_1.default.findById(req.user?.id).select('firstName lastName');
            if (product && reviewer) {
                await notification_service_1.notificationService.newReviewOnProduct(product.vendor.toString(), product.name, rating, `${reviewer.firstName} ${reviewer.lastName}`);
            }
        }
        catch (error) {
            logger_1.logger.error('Error sending review notification:', error);
        }
        // Check for review-related badges (non-blocking)
        reward_controller_1.rewardController.checkBadges(req.user.id).catch(() => { });
        logger_1.logger.info(`Review created: ${review._id} for product ${productId} on order ${orderId}`);
        res.status(201).json({
            success: true,
            message: 'Review created successfully',
            data: { review },
        });
    }
    /**
     * Get product reviews
     */
    async getProductReviews(req, res) {
        const { productId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const allowedSortFields = ['createdAt', 'rating', 'helpful'];
        const sortBy = allowedSortFields.includes(req.query.sortBy)
            ? req.query.sortBy
            : 'createdAt';
        const filter = { product: productId };
        if (req.query.rating) {
            filter.rating = parseInt(req.query.rating);
        }
        const reviews = await Review_1.default.find(filter)
            .populate('user', 'firstName lastName avatar')
            .sort({ [sortBy]: -1 })
            .skip(skip)
            .limit(limit);
        const total = await Review_1.default.countDocuments(filter);
        // Get rating distribution
        const distribution = await Review_1.default.aggregate([
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
    async updateReview(req, res) {
        const { reviewId } = req.params;
        const review = await Review_1.default.findOne({
            _id: reviewId,
            user: req.user?.id,
        });
        if (!review) {
            throw new error_1.AppError('Review not found', 404);
        }
        const allowedUpdates = ['rating', 'comment', 'images'];
        Object.keys(req.body).forEach((key) => {
            if (allowedUpdates.includes(key)) {
                review[key] = req.body[key];
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
    async deleteReview(req, res) {
        const { reviewId } = req.params;
        const review = await Review_1.default.findOne({
            _id: reviewId,
            user: req.user?.id,
        });
        if (!review) {
            throw new error_1.AppError('Review not found', 404);
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
    async markHelpful(req, res) {
        const { reviewId } = req.params;
        const review = await Review_1.default.findById(reviewId);
        if (!review) {
            throw new error_1.AppError('Review not found', 404);
        }
        // Check if user already marked as helpful
        if (review.helpfulBy.includes(req.user?.id)) {
            throw new error_1.AppError('You have already marked this review as helpful', 400);
        }
        review.helpful += 1;
        review.helpfulBy.push(req.user?.id);
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
    async reportReview(req, res) {
        const { reviewId } = req.params;
        const { reason } = req.body;
        const review = await Review_1.default.findById(reviewId);
        if (!review) {
            throw new error_1.AppError('Review not found', 404);
        }
        review.reported = true;
        review.reportReason = reason;
        await review.save();
        logger_1.logger.info(`Review reported: ${reviewId} by user ${req.user?.id}`);
        res.json({
            success: true,
            message: 'Review reported successfully',
        });
    }
    /**
     * Get user's reviews
     */
    async getUserReviews(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const reviews = await Review_1.default.find({ user: req.user?.id })
            .populate('product', 'name slug images price')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const total = await Review_1.default.countDocuments({ user: req.user?.id });
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
    async updateProductRating(productId) {
        const reviews = await Review_1.default.find({ product: productId });
        const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
        const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;
        const updatedProduct = await Product_1.default.findByIdAndUpdate(productId, {
            averageRating: Math.round(averageRating * 10) / 10,
            totalReviews: reviews.length,
        }, { new: true });
        // Roll up to vendor profile
        if (updatedProduct?.vendor) {
            await this.updateVendorRating(updatedProduct.vendor.toString());
        }
    }
    /**
     * Recompute vendor averageRating and totalReviews from all their products.
     */
    async updateVendorRating(vendorUserId) {
        const products = await Product_1.default.find({ vendor: vendorUserId }).select('averageRating totalReviews');
        const totalReviews = products.reduce((sum, p) => sum + (p.totalReviews || 0), 0);
        const weightedSum = products.reduce((sum, p) => sum + ((p.averageRating || 0) * (p.totalReviews || 0)), 0);
        const averageRating = totalReviews > 0
            ? Math.round((weightedSum / totalReviews) * 10) / 10
            : 0;
        await VendorProfile_1.default.findOneAndUpdate({ user: vendorUserId }, { averageRating, totalReviews });
    }
}
exports.ReviewController = ReviewController;
exports.reviewController = new ReviewController();
//# sourceMappingURL=review.controller.js.map