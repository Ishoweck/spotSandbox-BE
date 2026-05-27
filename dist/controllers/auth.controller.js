"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = exports.AuthController = void 0;
const types_1 = require("../types");
const User_1 = __importDefault(require("../models/User"));
const Additional_1 = require("../models/Additional");
const jwt_1 = require("../utils/jwt");
const helpers_1 = require("../utils/helpers");
const email_1 = require("../utils/email");
const error_1 = require("../middleware/error");
const crypto_1 = __importDefault(require("crypto"));
const email_queue_1 = require("../utils/email-queue");
const cloudinary_1 = require("../utils/cloudinary");
const notification_service_1 = require("../services/notification.service");
class AuthController {
    /**
     * Register new user
     */
    async register(req, res) {
        let { firstName, lastName, email, phone, password, role, fullName } = req.body;
        // Support fullName field — split into firstName and lastName
        if (fullName && (!firstName || !lastName)) {
            const parts = fullName.trim().split(/\s+/);
            firstName = parts[0];
            lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
        }
        // Check if user exists
        const existingUser = await User_1.default.findOne({ email });
        if (existingUser) {
            throw new error_1.AppError('Email already registered', 400);
        }
        // Generate OTP
        const otpCode = (0, helpers_1.generateOTP)();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        // Only allow self-registration as customer, vendor, or affiliate — never admin
        const allowedSelfRegistrationRoles = [types_1.UserRole.CUSTOMER, types_1.UserRole.VENDOR, types_1.UserRole.AFFILIATE];
        const safeRole = allowedSelfRegistrationRoles.includes(role) ? role : types_1.UserRole.CUSTOMER;
        // Create user
        const user = await User_1.default.create({
            firstName,
            lastName,
            email,
            phone,
            password,
            role: safeRole,
            otp: {
                code: otpCode,
                expiresAt: otpExpiry,
            },
        });
        // Create wallet for user
        await Additional_1.Wallet.create({ user: user._id });
        // Generate affiliate code if applicable
        if (role === types_1.UserRole.AFFILIATE || user.isAffiliate) {
            user.affiliateCode = (0, helpers_1.generateAffiliateCode)(email);
            await user.save();
        }
        // Send OTP email
        if (process.env.NODE_ENV !== 'production') {
            console.log(`\n🔑 [DEV] Registration OTP for ${email}: ${otpCode}\n`);
        }
        await (0, email_1.sendOTPEmail)(email, otpCode);
        res.status(201).json({
            success: true,
            message: 'Registration successful. Please verify your email.',
            data: {
                userId: user._id,
                email: user.email,
            },
        });
    }
    /**
     * Guest register - create account with just email
     */
    async guestRegister(req, res) {
        const { email } = req.body;
        // Check if user exists
        const existingUser = await User_1.default.findOne({ email });
        if (existingUser) {
            throw new error_1.AppError('Email already registered. Please sign in.', 400);
        }
        // Generate random password
        const randomPassword = crypto_1.default.randomBytes(8).toString('hex');
        // Create user
        const user = await User_1.default.create({
            firstName: 'Guest',
            lastName: 'User',
            email,
            password: randomPassword,
            role: types_1.UserRole.CUSTOMER,
            emailVerified: true,
            status: types_1.UserStatus.ACTIVE,
        });
        // Create wallet for user
        await Additional_1.Wallet.create({ user: user._id });
        // Generate a password reset code so the guest can set their own password later
        const resetCode = (0, helpers_1.generateResetCode)();
        const hashedResetCode = crypto_1.default.createHash('sha256').update(resetCode).digest('hex');
        user.resetPasswordToken = hashedResetCode;
        user.resetPasswordExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await user.save();
        // Send password setup email in background (non-blocking)
        (0, email_1.sendPasswordResetEmail)(email, resetCode).catch((err) => {
            console.error('Failed to send guest password setup email:', err);
        });
        // Generate tokens
        const tokens = (0, jwt_1.generateTokens)(user._id, user.email, user.role);
        res.status(201).json({
            success: true,
            message: 'Guest registration successful',
            data: {
                user: {
                    id: user._id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    role: user.role,
                },
                ...tokens,
            },
        });
    }
    /**
     * Verify email with OTP
     */
    async verifyEmail(req, res) {
        const { email, otp } = req.body;
        const user = await User_1.default.findOne({ email });
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        if (user.emailVerified) {
            throw new error_1.AppError('Email already verified', 400);
        }
        const otpMatch = user.otp &&
            user.otp.code.length === String(otp).length &&
            crypto_1.default.timingSafeEqual(Buffer.from(user.otp.code), Buffer.from(String(otp)));
        if (!otpMatch) {
            throw new error_1.AppError('Invalid OTP', 400);
        }
        if (user.otp.expiresAt && user.otp.expiresAt < new Date()) {
            throw new error_1.AppError('OTP expired', 400);
        }
        // Update user
        user.emailVerified = true;
        user.status = types_1.UserStatus.ACTIVE;
        user.otp = undefined;
        await user.save();
        // Check verified-identity badge in background
        Promise.resolve().then(() => __importStar(require('./reward.controller'))).then(({ rewardController: rc }) => rc.checkBadges(user._id.toString())).catch(() => { });
        // Queue welcome emails in background with 10 second delays
        // Only send vendor-specific emails (founder welcome + product posting guide) to vendors
        // Buyers get welcome email + buyer founder's note only
        if (user.role === 'vendor') {
            (0, email_queue_1.queueEmailsInBackground)([
                () => (0, email_1.sendWelcomeEmail)(user.email, user.firstName),
                () => (0, email_1.sendFounderWelcomeEmail)(user.email),
                () => (0, email_1.sendProductPostingGuideEmail)(user.email),
            ], 10000);
        }
        else {
            (0, email_queue_1.queueEmailsInBackground)([
                () => (0, email_1.sendWelcomeEmail)(user.email, user.firstName),
                () => (0, email_1.sendBuyerFounderWelcomeEmail)(user.email, user.firstName),
            ], 10000);
        }
        // Send welcome notification
        try {
            await notification_service_1.notificationService.welcomeNotification(user._id.toString(), user.firstName);
        }
        catch (error) {
            // Non-critical, don't throw
        }
        // Notify referrer if this user was referred + check their referral badges
        if (user.referredBy) {
            const referrerId = user.referredBy.toString();
            try {
                await notification_service_1.notificationService.referralSignup(referrerId, `${user.firstName} ${user.lastName}`);
            }
            catch (error) {
                // Non-critical
            }
            // Fire referral badge check for the referrer immediately
            Promise.resolve().then(() => __importStar(require('./reward.controller'))).then(({ rewardController: rc }) => rc.checkBadges(referrerId)).catch(() => { });
        }
        // Generate tokens
        const tokens = (0, jwt_1.generateTokens)(user._id, user.email, user.role);
        res.json({
            success: true,
            message: 'Email verified successfully',
            data: {
                user: {
                    id: user._id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    role: user.role,
                },
                ...tokens,
            },
        });
    }
    /**
     * Resend OTP
     */
    async resendOTP(req, res) {
        const { email } = req.body;
        const user = await User_1.default.findOne({ email });
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        if (user.emailVerified) {
            throw new error_1.AppError('Email already verified', 400);
        }
        // Generate new OTP
        const otpCode = (0, helpers_1.generateOTP)();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
        user.otp = {
            code: otpCode,
            expiresAt: otpExpiry,
        };
        await user.save();
        // Send OTP email
        if (process.env.NODE_ENV !== 'production') {
            console.log(`\n🔑 [DEV] Resend OTP for ${email}: ${otpCode}\n`);
        }
        await (0, email_1.sendOTPEmail)(email, otpCode);
        res.json({
            success: true,
            message: 'OTP sent successfully',
        });
    }
    /**
     * Login with daily login bonus
     */
    async login(req, res) {
        const { email, password } = req.body;
        // Find user with password
        const user = await User_1.default.findOne({ email }).select('+password');
        if (!user) {
            throw new error_1.AppError('Invalid credentials', 401);
        }
        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            throw new error_1.AppError('Invalid credentials', 401);
        }
        // Check if email is verified
        if (!user.emailVerified) {
            throw new error_1.AppError('Please verify your email first', 403);
        }
        // Check if account is active
        if (user.status !== types_1.UserStatus.ACTIVE) {
            throw new error_1.AppError('Account is not active', 403);
        }
        // ✅ AWARD DAILY LOGIN POINTS
        await this.awardDailyLoginPoints(user);
        // Update last login
        user.lastLogin = new Date();
        await user.save();
        // Generate tokens
        const tokens = (0, jwt_1.generateTokens)(user._id, user.email, user.role);
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user._id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    avatar: user.avatar,
                },
                ...tokens,
            },
        });
    }
    /**
     * Award daily login points with streak tracking and transaction logging
     */
    async awardDailyLoginPoints(user) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Use loginStreak.lastLoginDate as the source of truth — it's what this method updates,
        // so the guard stays consistent whether called from login() or getMe().
        const lastAwardDate = user.loginStreak?.lastLoginDate
            ? new Date(user.loginStreak.lastLoginDate)
            : null;
        if (lastAwardDate) {
            lastAwardDate.setHours(0, 0, 0, 0);
        }
        // Already awarded points today — nothing to do
        if (lastAwardDate && lastAwardDate.getTime() === today.getTime()) {
            return;
        }
        // Initialize login streak tracking if it doesn't exist
        if (!user.loginStreak) {
            user.loginStreak = {
                currentStreak: 0,
                lastLoginDate: null,
            };
        }
        // Check if login is consecutive (yesterday)
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        let pointsAwarded = 5; // Base daily login points
        let streakBonus = 0;
        let newStreak = 1;
        if (lastAwardDate && lastAwardDate.getTime() === yesterday.getTime()) {
            // Consecutive day - increase streak
            newStreak = (user.loginStreak.currentStreak || 0) + 1;
        }
        else if (!lastAwardDate || lastAwardDate.getTime() < yesterday.getTime()) {
            // Streak broken - reset to 1
            newStreak = 1;
        }
        // Award streak bonuses
        if (newStreak === 7) {
            streakBonus = 20;
            pointsAwarded += streakBonus;
        }
        else if (newStreak === 14) {
            streakBonus = 50;
            pointsAwarded += streakBonus;
        }
        else if (newStreak === 30) {
            streakBonus = 120;
            pointsAwarded += streakBonus;
        }
        // Update user points and streak
        user.points = (user.points || 0) + pointsAwarded;
        user.loginStreak = {
            currentStreak: newStreak,
            lastLoginDate: today,
        };
        await user.save();
        // Check streak-related badges in background — non-blocking
        const { rewardController: rc } = await Promise.resolve().then(() => __importStar(require('./reward.controller')));
        rc.checkBadges(user._id.toString()).catch(() => { });
        // ✅ CREATE TRANSACTION RECORD
        const PointsTransaction = (await Promise.resolve().then(() => __importStar(require('../models/PointsTransaction')))).default;
        let description = `Daily login`;
        if (streakBonus > 0) {
            description = `Daily login + ${newStreak}-day streak bonus`;
        }
        await PointsTransaction.create({
            user: user._id,
            type: 'earn',
            activity: 'login',
            points: pointsAwarded,
            description,
            metadata: {
                streakDay: newStreak,
                basePoints: 5,
                bonusPoints: streakBonus,
            },
        });
        // Send notification for the daily login points
        try {
            const { notificationService } = await Promise.resolve().then(() => __importStar(require('../services/notification.service')));
            const reason = streakBonus > 0
                ? `daily login (${newStreak}-day streak bonus!)`
                : 'daily login';
            await notificationService.pointsEarned(user._id.toString(), pointsAwarded, reason);
        }
        catch (err) {
            // Non-critical — don't block login
        }
        console.log(`✅ Daily login points awarded: ${pointsAwarded} to user ${user.email} (Streak: ${newStreak})`);
        if (streakBonus > 0) {
            console.log(`🎉 Streak bonus: ${streakBonus} points for ${newStreak}-day streak!`);
        }
    }
    /**
    * Forgot password - Generate and send reset OTP
    */
    async forgotPassword(req, res) {
        const { email } = req.body;
        const user = await User_1.default.findOne({ email });
        if (!user) {
            // Don't reveal if email exists for security
            res.json({
                success: true,
                message: 'If email exists, password reset code has been sent',
            });
            return;
        }
        // Generate OTP
        const otpCode = (0, helpers_1.generateOTP)();
        const hashedCode = crypto_1.default.createHash('sha256').update(otpCode).digest('hex');
        user.resetPasswordToken = hashedCode;
        user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await user.save();
        // Send reset email with OTP
        await (0, email_1.sendPasswordResetEmail)(email, otpCode);
        if (process.env.NODE_ENV !== 'production') {
            console.log(`\n🔐 [DEV] Password reset OTP for ${email}: ${otpCode}\n`);
        }
        res.json({
            success: true,
            message: 'Password reset code sent to email',
        });
    }
    /**
     * Reset password with OTP code
     */
    async resetPassword(req, res) {
        const { code, password, token } = req.body;
        // Accept both 'code' and 'token' for backwards compatibility
        const resetCode = code || token;
        if (!resetCode || !password) {
            throw new error_1.AppError('Reset code and new password are required', 400);
        }
        const normalizedCode = resetCode.trim();
        const hashedCode = crypto_1.default.createHash('sha256').update(normalizedCode).digest('hex');
        const user = await User_1.default.findOne({
            resetPasswordToken: hashedCode,
            resetPasswordExpires: { $gt: Date.now() },
        });
        if (!user) {
            throw new error_1.AppError('Invalid or expired reset code', 400);
        }
        // Update password
        user.password = password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        res.json({
            success: true,
            message: 'Password reset successful',
        });
    }
    /**
     * Refresh token
     */
    async refreshToken(req, res) {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            throw new error_1.AppError('Refresh token required', 400);
        }
        const decoded = (0, jwt_1.verifyRefreshToken)(refreshToken);
        const user = await User_1.default.findById(decoded.id).select('status email role');
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        if (user.status === 'suspended' || user.status === 'inactive') {
            throw new error_1.AppError('Your account is not active. Please contact support.', 403);
        }
        // Generate new tokens
        const tokens = (0, jwt_1.generateTokens)(user._id, user.email, user.role);
        res.json({
            success: true,
            message: 'Token refreshed successfully',
            data: tokens,
        });
    }
    /**
     * Get current user
     */
    async getMe(req, res) {
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        // Award daily points when the app loads with an existing session (user didn't log out/in)
        await this.awardDailyLoginPoints(user);
        res.json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    status: user.status,
                    avatar: user.avatar,
                    addresses: user.addresses,
                    emailVerified: user.emailVerified,
                    phoneVerified: user.phoneVerified,
                    isAffiliate: user.isAffiliate,
                    affiliateCode: user.affiliateCode,
                },
            },
        });
    }
    /**
     * Get support user (first admin/super_admin) for chat
     */
    async getSupportUser(req, res) {
        const supportUser = await User_1.default.findOne({
            role: { $in: ['admin', 'super_admin'] },
            status: types_1.UserStatus.ACTIVE,
        }).select('_id firstName lastName avatar');
        if (!supportUser) {
            throw new error_1.AppError('Support user not available', 404);
        }
        res.json({
            success: true,
            data: {
                user: {
                    id: supportUser._id,
                    firstName: supportUser.firstName,
                    lastName: supportUser.lastName,
                    avatar: supportUser.avatar,
                },
            },
        });
    }
    /**
     * Update profile
     */
    async updateProfile(req, res) {
        const { firstName, lastName, phone, avatar } = req.body;
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        if (firstName)
            user.firstName = firstName;
        if (lastName)
            user.lastName = lastName;
        if (phone)
            user.phone = phone;
        if (avatar)
            user.avatar = avatar;
        await user.save();
        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: { user },
        });
    }
    // In auth.controller.ts
    async updateAvatar(req, res) {
        const { base64Image } = req.body;
        const user = await User_1.default.findById(req.user?.id);
        if (!user)
            throw new error_1.AppError('User not found', 404);
        // Delete old avatar if exists
        if (user.avatar) {
            const oldPublicId = user.avatar.split('/').slice(-2).join('/').split('.')[0];
            await (0, cloudinary_1.deleteFromCloudinary)(oldPublicId).catch(() => { });
        }
        const { url } = await (0, cloudinary_1.uploadToCloudinary)(base64Image, 'avatars');
        user.avatar = url;
        await user.save();
        res.json({ success: true, message: 'Avatar updated', data: { avatar: url } });
    }
    /**
     * Change password
     */
    async changePassword(req, res) {
        const { currentPassword, newPassword } = req.body;
        const user = await User_1.default.findById(req.user?.id).select('+password');
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            throw new error_1.AppError('Current password is incorrect', 400);
        }
        user.password = newPassword;
        await user.save();
        res.json({
            success: true,
            message: 'Password changed successfully',
        });
    }
}
exports.AuthController = AuthController;
exports.authController = new AuthController();
//# sourceMappingURL=auth.controller.js.map