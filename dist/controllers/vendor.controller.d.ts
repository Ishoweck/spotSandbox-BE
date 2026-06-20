import { Request, Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class VendorController {
    /**
     * Get top vendors (Public - for home screen)
     */
    getTopVendors(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Follow a vendor
     */
    followVendor(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Unfollow a vendor
     */
    unfollowVendor(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get user's followed vendors
     */
    getFollowedVendors(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Create vendor profile
     */
    createVendorProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get vendor profile
     */
    getVendorProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Update vendor profile
     */
    updateVendorProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Upload KYC documents
     */
    uploadKYCDocuments(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Update payout details
     */
    updatePayoutDetails(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * ============================================================
     * ⭐ ENHANCED VENDOR DASHBOARD
     * Works with User.points system (your existing rewards)
     * ============================================================
     */
    getVendorDashboard(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get sales analytics
     */
    getSalesAnalytics(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get all vendors (Admin only)
     */
    getAllVendors(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Verify vendor KYC (Admin only)
     */
    verifyVendorKYC(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Toggle vendor active status (Admin only)
     */
    toggleVendorStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    toggleMyStoreStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get public vendor profile
     */
    getPublicVendorProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * GET /api/v1/vendor/banks
     * Get Nigerian banks list from Paystack API
     */
    getBanks(req: Request, res: Response<ApiResponse>): Promise<void>;
    /**
     * POST /vendor/statement
     * Generate and email an account statement PDF for the given date range
     */
    requestStatement(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
}
export declare const vendorController: VendorController;
/**
 * POST /vendor/profile/set-referrer
 * Vendor records who referred them (one-time, before first sale)
 */
export declare const setVendorReferrer: (req: AuthRequest, res: Response<ApiResponse>) => Promise<void>;
//# sourceMappingURL=vendor.controller.d.ts.map