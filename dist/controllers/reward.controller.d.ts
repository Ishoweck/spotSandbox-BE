import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class RewardController {
    private redemptionLocks;
    /**
     * Get user points and rewards
     */
    getUserPoints(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Award points to user with transaction tracking
     */
    awardPoints(userId: string, points: number, activity: 'login' | 'purchase' | 'review' | 'share' | 'referral' | 'bonus' | 'other', description: string, metadata?: any): Promise<void>;
    /**
     * Redeem points for cash
     */
    redeemPoints(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Award badge to user
     */
    awardBadge(userId: string, badge: string): Promise<void>;
    /**
     * Get points history from transactions
     */
    getPointsHistory(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get leaderboard
     */
    getLeaderboard(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get available rewards
     */
    getAvailableRewards(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Check and award automatic badges
     */
    checkBadges(userId: string): Promise<void>;
    /**
     * Expire points older than 60 days (lazy — call before any balance read/write)
     */
    expireOldPoints(userId: string): Promise<void>;
    /**
     * Award locked points for vendor referral — not usable until vendor's first sale
     */
    awardVendorReferralPoints(referrerId: string, vendorId: string): Promise<void>;
    /**
     * Unlock vendor referral points when the vendor makes their first sale
     */
    unlockVendorReferralPoints(vendorId: string): Promise<void>;
    /**
     * Award points after order completion — 1 pt per ₦100 spent
     */
    awardOrderPoints(orderId: string): Promise<void>;
    /**
     * Award points to a referrer when their referred customer completes their first order
     */
    awardCustomerReferralPoints(buyerUserId: string, orderId: string): Promise<void>;
    /** Returns a Date 60 days from now — used to (re)set vCredits expiry */
    vCreditsExpiry(): Date;
    /**
     * Points → VCredits conversion rate (₦ per point) per tier
     */
    private getTierConversionRate;
    private getTierName;
}
export declare const rewardController: RewardController;
//# sourceMappingURL=reward.controller.d.ts.map