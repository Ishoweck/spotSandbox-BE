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
     * Award points after order completion
     */
    awardOrderPoints(orderId: string): Promise<void>;
    /** Returns a Date 60 days from now — used to (re)set vCredits expiry */
    vCreditsExpiry(): Date;
    /**
     * Cashback rates per tier (applied to order total on delivery)
     */
    private getTierCashbackRate;
    /**
     * Points → VCredits conversion rate (₦ per point) per tier
     */
    private getTierConversionRate;
    private getTierName;
    /**
     * Award tier-based cashback to buyer's wallet after order delivery
     * Called alongside awardOrderPoints — safe to call multiple times (uses orderId reference guard)
     */
    awardCashback(orderId: string): Promise<void>;
}
export declare const rewardController: RewardController;
//# sourceMappingURL=reward.controller.d.ts.map