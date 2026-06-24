import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class AuthController {
    /**
     * Register new user
     */
    register(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Guest register - create account with just email
     */
    guestRegister(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Verify email with OTP
     */
    verifyEmail(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Resend OTP
     */
    resendOTP(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Request account activation link (self-service for inactive/unverified users)
     */
    resendActivation(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Activate account via link token
     */
    activateAccount(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Login with daily login bonus
     */
    login(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Award daily login points with streak tracking and transaction logging
     */
    private awardDailyLoginPoints;
    /**
    * Forgot password - Generate and send reset OTP
    */
    forgotPassword(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Reset password with OTP code
     */
    resetPassword(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Refresh token
     */
    refreshToken(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get current user
     */
    getMe(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get support user (first admin/super_admin) for chat
     */
    getSupportUser(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Update profile
     */
    updateProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    updateAvatar(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Change password
     */
    changePassword(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Verify transaction PIN
     */
    verifyTransactionPin(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Verify current password (used before sensitive operations like PIN setup)
     */
    verifyPassword(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Set transaction PIN
     */
    setTransactionPin(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Ambassador registration — validates invite token, creates user, activates affiliate
     */
    ambassadorRegister(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
}
export declare const authController: AuthController;
//# sourceMappingURL=auth.controller.d.ts.map