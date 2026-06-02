import { Response } from 'express';
import { AuthRequest, ApiResponse, UserRole, UserStatus } from '../types';
import User from '../models/User';
import { Wallet } from '../models/Additional';
import { generateTokens } from '../utils/jwt';
import { generateAffiliateCode } from '../utils/helpers';
import { sendWelcomeEmail, sendFounderWelcomeEmail, sendVendorWelcomeEmail, sendProductPostingGuideEmail } from '../utils/email';
import { AppError } from '../middleware/error';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { createPublicKey } from 'crypto';
import { queueEmailsInBackground } from '../utils/email-queue';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Cache Apple's public keys — they rotate infrequently, so 1-hour TTL is fine
let appleKeysCache: { keys: any[]; fetchedAt: number } | null = null;

async function getApplePublicKey(kid: string): Promise<ReturnType<typeof createPublicKey>> {
  const now = Date.now();
  const TTL = 60 * 60 * 1000; // 1 hour

  if (!appleKeysCache || now - appleKeysCache.fetchedAt > TTL) {
    const { data } = await axios.get('https://appleid.apple.com/auth/keys');
    appleKeysCache = { keys: data.keys, fetchedAt: now };
  }

  const jwk = appleKeysCache.keys.find((k: any) => k.kid === kid);
  if (!jwk) {
    // Key not in cache — force a refresh once in case Apple rotated keys
    const { data } = await axios.get('https://appleid.apple.com/auth/keys');
    appleKeysCache = { keys: data.keys, fetchedAt: now };
    const refreshedJwk = appleKeysCache.keys.find((k: any) => k.kid === kid);
    if (!refreshedJwk) throw new AppError('Apple public key not found', 400);
    return createPublicKey({ key: refreshedJwk, format: 'jwk' });
  }

  return createPublicKey({ key: jwk, format: 'jwk' });
}

export class OAuthController {
  /**
   * Google OAuth Login
   */
  async googleLogin(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { idToken, role } = req.body;

    if (!idToken) {
      throw new AppError('Google ID token is required', 400);
    }

    try {
      // Verify Google token
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      
      if (!payload || !payload.email) {
        throw new AppError('Invalid Google token', 400);
      }

      const { email, given_name, family_name, picture, email_verified } = payload;

      // Check if user exists
      let user = await User.findOne({ email });

      if (user) {
        // Existing user - log them in
        if (user.status !== UserStatus.ACTIVE) {
          throw new AppError('Account is not active', 403);
        }

        // Update last login and avatar if not set
        user.lastLogin = new Date();
        if (!user.avatar && picture) {
          user.avatar = picture;
        }

        // Award daily login points
        await this.awardDailyLoginPoints(user);

        await user.save();
      } else {
        // New user - create account
        user = await User.create({
          firstName: given_name || 'User',
          lastName: family_name || '',
          email,
          password: this.generateRandomPassword(), // Generate random password for OAuth users
          role: role || UserRole.CUSTOMER,
          avatar: picture,
          emailVerified: email_verified || false,
          status: email_verified ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION,
          oauthProvider: 'google',
          oauthId: payload.sub,
        });

        // Create wallet for user
        await Wallet.create({ user: user._id });

        // Generate affiliate code if applicable
        if (role === UserRole.AFFILIATE || user.isAffiliate) {
          user.affiliateCode = generateAffiliateCode(email);
          await user.save();
        }

        // Vendor welcome emails are sent after admin approval, not at OAuth registration
      }

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
    } catch (error: any) {
      console.error('Google OAuth error:', error);
      throw new AppError('Google authentication failed', 400);
    }
  }

  /**
   * Apple OAuth Login
   */
  async appleLogin(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { identityToken, authorizationCode, user: appleUser, role } = req.body;

    if (!identityToken) {
      throw new AppError('Apple identity token is required', 400);
    }

    try {
      // Decode header to get the key ID, then fetch Apple's matching public key
      const tokenHeader = JSON.parse(
        Buffer.from(identityToken.split('.')[0], 'base64url').toString()
      );

      const publicKey = await getApplePublicKey(tokenHeader.kid);

      // Verify signature, expiry, issuer, and audience — jwt.decode() did none of this
      const verified: any = jwt.verify(identityToken, publicKey, {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience: process.env.APPLE_BUNDLE_ID || 'com.vendorspotng.vendorspot',
      });

      const { email, sub: appleId, email_verified } = verified;

      if (!email) {
        throw new AppError('Email not provided by Apple', 400);
      }

      // Check if user exists
      let user = await User.findOne({ email });

      if (user) {
        // Existing user - log them in
        if (user.status !== UserStatus.ACTIVE) {
          throw new AppError('Account is not active', 403);
        }

        // Update last login
        user.lastLogin = new Date();

        // Award daily login points
        await this.awardDailyLoginPoints(user);

        await user.save();
      } else {
        // New user - create account
        // Apple might provide user info only on first sign-in
        const firstName = appleUser?.name?.firstName || appleUser?.givenName || 'User';
        const lastName = appleUser?.name?.lastName || appleUser?.familyName || '';

        user = await User.create({
          firstName,
          lastName,
          email,
          password: this.generateRandomPassword(), // Generate random password for OAuth users
          role: role || UserRole.CUSTOMER,
          emailVerified: email_verified === 'true' || email_verified === true,
          status: email_verified ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION,
          oauthProvider: 'apple',
          oauthId: appleId,
        });

        // Create wallet for user
        await Wallet.create({ user: user._id });

        // Generate affiliate code if applicable
        if (role === UserRole.AFFILIATE || user.isAffiliate) {
          user.affiliateCode = generateAffiliateCode(email);
          await user.save();
        }

        // Vendor welcome emails are sent after admin approval, not at OAuth registration
      }

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
    } catch (error: any) {
      console.error('Apple OAuth error:', error);
      throw new AppError('Apple authentication failed', 400);
    }
  }

  /**
   * Award daily login points with streak tracking
   */
  private async awardDailyLoginPoints(user: any): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastLogin = user.lastLogin ? new Date(user.lastLogin) : null;
    
    if (lastLogin) {
      lastLogin.setHours(0, 0, 0, 0);
    }

    // Check if user already logged in today
    if (lastLogin && lastLogin.getTime() === today.getTime()) {
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

    let pointsAwarded = 5;
    let streakBonus = 0;
    let newStreak = 1;

    if (lastLogin && lastLogin.getTime() === yesterday.getTime()) {
      newStreak = (user.loginStreak.currentStreak || 0) + 1;
    } else if (!lastLogin || lastLogin.getTime() < yesterday.getTime()) {
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

    // Create transaction record
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

    console.log(`✅ Daily login points awarded: ${pointsAwarded} to user ${user.email} (Streak: ${newStreak})`);
  }

  /**
   * Generate random password for OAuth users
   */
  private generateRandomPassword(): string {
    return Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
  }
}

export const oauthController = new OAuthController();