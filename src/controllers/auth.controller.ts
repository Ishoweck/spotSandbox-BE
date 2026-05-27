import { Response } from 'express';
import { AuthRequest, ApiResponse, UserRole, UserStatus } from '../types';
import User from '../models/User';
import { Wallet } from '../models/Additional';
import { generateTokens, verifyRefreshToken } from '../utils/jwt';
import { generateOTP, generateAffiliateCode, generateResetCode } from '../utils/helpers';
import { sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail, sendFounderWelcomeEmail, sendProductPostingGuideEmail, sendBuyerFounderWelcomeEmail } from '../utils/email';
import { AppError } from '../middleware/error';
import crypto from 'crypto';
import { queueEmailsInBackground } from '../utils/email-queue';
import { deleteFromCloudinary, uploadToCloudinary } from '../utils/cloudinary';
import { notificationService } from '../services/notification.service';

export class AuthController {
  /**
   * Register new user
   */
 async register(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    let { firstName, lastName, email, phone, password, role, fullName } = req.body;

    // Support fullName field — split into firstName and lastName
    if (fullName && (!firstName || !lastName)) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0];
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError('Email already registered', 400);
    }

    // Generate OTP
    const otpCode = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Only allow self-registration as customer, vendor, or affiliate — never admin
    const allowedSelfRegistrationRoles = [UserRole.CUSTOMER, UserRole.VENDOR, UserRole.AFFILIATE];
    const safeRole = allowedSelfRegistrationRoles.includes(role) ? role : UserRole.CUSTOMER;

    // Create user
    const user = await User.create({
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
    await Wallet.create({ user: user._id });

    // Generate affiliate code if applicable
    if (role === UserRole.AFFILIATE || user.isAffiliate) {
      user.affiliateCode = generateAffiliateCode(email);
      await user.save();
    }

    // Send OTP email
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n🔑 [DEV] Registration OTP for ${email}: ${otpCode}\n`);
    }
    await sendOTPEmail(email, otpCode);

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
  async guestRegister(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { email } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError('Email already registered. Please sign in.', 400);
    }

    // Generate random password
    const randomPassword = crypto.randomBytes(8).toString('hex');

    // Create user
    const user = await User.create({
      firstName: 'Guest',
      lastName: 'User',
      email,
      password: randomPassword,
      role: UserRole.CUSTOMER,
      emailVerified: true,
      status: UserStatus.ACTIVE,
    });

    // Create wallet for user
    await Wallet.create({ user: user._id });

    // Generate a password reset code so the guest can set their own password later
    const resetCode = generateResetCode();
    const hashedResetCode = crypto.createHash('sha256').update(resetCode).digest('hex');
    user.resetPasswordToken = hashedResetCode;
    user.resetPasswordExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await user.save();

    // Send password setup email in background (non-blocking)
    sendPasswordResetEmail(email, resetCode).catch((err: any) => {
      console.error('Failed to send guest password setup email:', err);
    });

    // Generate tokens
    const tokens = generateTokens(user._id, user.email, user.role);

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
 
async verifyEmail(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
  const { email, otp } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.emailVerified) {
    throw new AppError('Email already verified', 400);
  }

  const otpMatch = user.otp &&
    user.otp.code.length === String(otp).length &&
    crypto.timingSafeEqual(Buffer.from(user.otp.code), Buffer.from(String(otp)));
  if (!otpMatch) {
    throw new AppError('Invalid OTP', 400);
  }

  if (user.otp.expiresAt && user.otp.expiresAt < new Date()) {
    throw new AppError('OTP expired', 400);
  }

  // Update user
  user.emailVerified = true;
  user.status = UserStatus.ACTIVE;
  user.otp = undefined;
  await user.save();

  // Check verified-identity badge in background
  import('./reward.controller').then(({ rewardController: rc }) => rc.checkBadges(user._id.toString())).catch(() => {});

  // Queue welcome emails in background with 10 second delays
  // Only send vendor-specific emails (founder welcome + product posting guide) to vendors
  // Buyers get welcome email + buyer founder's note only
  if (user.role === 'vendor') {
    queueEmailsInBackground([
      () => sendWelcomeEmail(user.email, user.firstName),
      () => sendFounderWelcomeEmail(user.email),
      () => sendProductPostingGuideEmail(user.email),
    ], 10000);
  } else {
    queueEmailsInBackground([
      () => sendWelcomeEmail(user.email, user.firstName),
      () => sendBuyerFounderWelcomeEmail(user.email, user.firstName),
    ], 10000);
  }

  // Send welcome notification
  try {
    await notificationService.welcomeNotification(user._id.toString(), user.firstName);
  } catch (error) {
    // Non-critical, don't throw
  }

  // Notify referrer if this user was referred + check their referral badges
  if (user.referredBy) {
    const referrerId = user.referredBy.toString();
    try {
      await notificationService.referralSignup(referrerId, `${user.firstName} ${user.lastName}`);
    } catch (error) {
      // Non-critical
    }
    // Fire referral badge check for the referrer immediately
    import('./reward.controller').then(({ rewardController: rc }) => rc.checkBadges(referrerId)).catch(() => {});
  }

  // Generate tokens
  const tokens = generateTokens(user._id, user.email, user.role);

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
  async resendOTP(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (user.emailVerified) {
      throw new AppError('Email already verified', 400);
    }

    // Generate new OTP
    const otpCode = generateOTP();
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
    await sendOTPEmail(email, otpCode);

    res.json({
      success: true,
      message: 'OTP sent successfully',
    });
  }

/**
 * Login with daily login bonus
 */
async login(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
  const { email, password } = req.body;

  // Find user with password
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  // Check password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError('Invalid credentials', 401);
  }

  // Check if email is verified
  if (!user.emailVerified) {
    throw new AppError('Please verify your email first', 403);
  }

  // Check if account is active
  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError('Account is not active', 403);
  }

  // ✅ AWARD DAILY LOGIN POINTS
  await this.awardDailyLoginPoints(user);

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Generate tokens
  const tokens = generateTokens(user._id, user.email, user.role);

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
private async awardDailyLoginPoints(user: any): Promise<void> {
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
  } else if (!lastAwardDate || lastAwardDate.getTime() < yesterday.getTime()) {
    // Streak broken - reset to 1
    newStreak = 1;
  }

  // Award streak bonuses
  if (newStreak === 7) {
    streakBonus = 20;
    pointsAwarded += streakBonus;
  } else if (newStreak === 14) {
    streakBonus = 50;
    pointsAwarded += streakBonus;
  } else if (newStreak === 30) {
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
  const { rewardController: rc } = await import('./reward.controller');
  rc.checkBadges(user._id.toString()).catch(() => {});

  // ✅ CREATE TRANSACTION RECORD
  const PointsTransaction = (await import('../models/PointsTransaction')).default;
  
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
    const { notificationService } = await import('../services/notification.service');
    const reason = streakBonus > 0
      ? `daily login (${newStreak}-day streak bonus!)`
      : 'daily login';
    await notificationService.pointsEarned(user._id.toString(), pointsAwarded, reason);
  } catch (err) {
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
async forgotPassword(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if email exists for security
      res.json({
        success: true,
        message: 'If email exists, password reset code has been sent',
      });
      return;
    }

    // Generate OTP
    const otpCode = generateOTP();
    const hashedCode = crypto.createHash('sha256').update(otpCode).digest('hex');

    user.resetPasswordToken = hashedCode;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send reset email with OTP
    await sendPasswordResetEmail(email, otpCode);

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
  async resetPassword(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { code, password, token } = req.body;

    // Accept both 'code' and 'token' for backwards compatibility
    const resetCode = code || token;

    if (!resetCode || !password) {
      throw new AppError('Reset code and new password are required', 400);
    }

    const normalizedCode = resetCode.trim();

    const hashedCode = crypto.createHash('sha256').update(normalizedCode).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedCode,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      throw new AppError('Invalid or expired reset code', 400);
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
  async refreshToken(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token required', 400);
    }

    const decoded = verifyRefreshToken(refreshToken);

    const user = await User.findById(decoded.id).select('status email role');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (user.status === 'suspended' || user.status === 'inactive') {
      throw new AppError('Your account is not active. Please contact support.', 403);
    }

    // Generate new tokens
    const tokens = generateTokens(user._id, user.email, user.role);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: tokens,
    });
  }

  /**
   * Get current user
   */
  async getMe(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const user = await User.findById(req.user?.id);

    if (!user) {
      throw new AppError('User not found', 404);
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
  async getSupportUser(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const supportUser = await User.findOne({
      role: { $in: ['admin', 'super_admin'] },
      status: UserStatus.ACTIVE,
    }).select('_id firstName lastName avatar');

    if (!supportUser) {
      throw new AppError('Support user not available', 404);
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
  async updateProfile(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { firstName, lastName, phone, avatar } = req.body;

    const user = await User.findById(req.user?.id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;
    if (avatar) user.avatar = avatar;

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user },
    });
  }


  // In auth.controller.ts
async updateAvatar(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
  const { base64Image } = req.body;
  const user = await User.findById(req.user?.id);
  if (!user) throw new AppError('User not found', 404);

  // Delete old avatar if exists
  if (user.avatar) {
    const oldPublicId = user.avatar.split('/').slice(-2).join('/').split('.')[0];
    await deleteFromCloudinary(oldPublicId).catch(() => {});
  }

  const { url } = await uploadToCloudinary(base64Image, 'avatars');
  user.avatar = url;
  await user.save();

  res.json({ success: true, message: 'Avatar updated', data: { avatar: url } });
}

  /**
   * Change password
   */
  async changePassword(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user?.id).select('+password');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      throw new AppError('Current password is incorrect', 400);
    }

    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  }
}

export const authController = new AuthController();