import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class ReviewController {
    /**
     * Create review
     */
    createReview(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get product reviews
     */
    getProductReviews(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Update review
     */
    updateReview(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Delete review
     */
    deleteReview(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Mark review as helpful
     */
    markHelpful(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Report review
     */
    reportReview(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get user's reviews
     */
    getUserReviews(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Update product rating then roll up to the vendor profile.
     */
    private updateProductRating;
    /**
     * Recompute vendor averageRating and totalReviews from all their products.
     */
    private updateVendorRating;
}
export declare const reviewController: ReviewController;
//# sourceMappingURL=review.controller.d.ts.map