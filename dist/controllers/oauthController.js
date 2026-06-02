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
exports.oauthController = exports.OAuthController = void 0;
const types_1 = require("../types");
const User_1 = __importDefault(require("../models/User"));
const Additional_1 = require("../models/Additional");
const jwt_1 = require("../utils/jwt");
const helpers_1 = require("../utils/helpers");
const error_1 = require("../middleware/error");
const google_auth_library_1 = require("google-auth-library");
const axios_1 = __importDefault(require("axios"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const googleClient = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
// Cache Apple's public keys — they rotate infrequently, so 1-hour TTL is fine
let appleKeysCache = null;
async function getApplePublicKey(kid) {
    const now = Date.now();
    const TTL = 60 * 60 * 1000; // 1 hour
    if (!appleKeysCache || now - appleKeysCache.fetchedAt > TTL) {
        const { data } = await axios_1.default.get('https://appleid.apple.com/auth/keys');
        appleKeysCache = { keys: data.keys, fetchedAt: now };
    }
    const jwk = appleKeysCache.keys.find((k) => k.kid === kid);
    if (!jwk) {
        // Key not in cache — force a refresh once in case Apple rotated keys
        const { data } = await axios_1.default.get('https://appleid.apple.com/auth/keys');
        appleKeysCache = { keys: data.keys, fetchedAt: now };
        const refreshedJwk = appleKeysCache.keys.find((k) => k.kid === kid);
        if (!refreshedJwk)
            throw new error_1.AppError('Apple public key not found', 400);
        return (0, crypto_1.createPublicKey)({ key: refreshedJwk, format: 'jwk' });
    }
    return (0, crypto_1.createPublicKey)({ key: jwk, format: 'jwk' });
}
class OAuthController {
    /**
     * Google OAuth Login
     */
    async googleLogin(req, res) {
        const { idToken, role } = req.body;
        if (!idToken) {
            throw new error_1.AppError('Google ID token is required', 400);
        }
        try {
            // Verify Google token
            const ticket = await googleClient.verifyIdToken({
                idToken,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            if (!payload || !payload.email) {
                throw new error_1.AppError('Invalid Google token', 400);
            }
            const { email, given_name, family_name, picture, email_verified } = payload;
            // Check if user exists
            let user = await User_1.default.findOne({ email });
            if (user) {
                // Existing user - log them in
                if (user.status !== types_1.UserStatus.ACTIVE) {
                    throw new error_1.AppError('Account is not active', 403);
                }
                // Update last login and avatar if not set
                user.lastLogin = new Date();
                if (!user.avatar && picture) {
                    user.avatar = picture;
                }
                // Award daily login points
                await this.awardDailyLoginPoints(user);
                await user.save();
            }
            else {
                // New user - create account
                user = await User_1.default.create({
                    firstName: given_name || 'User',
                    lastName: family_name || '',
                    email,
                    password: this.generateRandomPassword(), // Generate random password for OAuth users
                    role: role || types_1.UserRole.CUSTOMER,
                    avatar: picture,
                    emailVerified: email_verified || false,
                    status: email_verified ? types_1.UserStatus.ACTIVE : types_1.UserStatus.PENDING_VERIFICATION,
                    oauthProvider: 'google',
                    oauthId: payload.sub,
                });
                // Create wallet for user
                await Additional_1.Wallet.create({ user: user._id });
                // Generate affiliate code if applicable
                if (role === types_1.UserRole.AFFILIATE || user.isAffiliate) {
                    user.affiliateCode = (0, helpers_1.generateAffiliateCode)(email);
                    await user.save();
                }
                // Vendor welcome emails are sent after admin approval, not at OAuth registration
            }
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
        catch (error) {
            console.error('Google OAuth error:', error);
            throw new error_1.AppError('Google authentication failed', 400);
        }
    }
    /**
     * Apple OAuth Login
     */
    async appleLogin(req, res) {
        const { identityToken, authorizationCode, user: appleUser, role } = req.body;
        if (!identityToken) {
            throw new error_1.AppError('Apple identity token is required', 400);
        }
        try {
            // Decode header to get the key ID, then fetch Apple's matching public key
            const tokenHeader = JSON.parse(Buffer.from(identityToken.split('.')[0], 'base64url').toString());
            const publicKey = await getApplePublicKey(tokenHeader.kid);
            // Verify signature, expiry, issuer, and audience — jwt.decode() did none of this
            const verified = jsonwebtoken_1.default.verify(identityToken, publicKey, {
                algorithms: ['RS256'],
                issuer: 'https://appleid.apple.com',
                audience: process.env.APPLE_BUNDLE_ID || 'com.vendorspotng.vendorspot',
            });
            const { email, sub: appleId, email_verified } = verified;
            if (!email) {
                throw new error_1.AppError('Email not provided by Apple', 400);
            }
            // Check if user exists
            let user = await User_1.default.findOne({ email });
            if (user) {
                // Existing user - log them in
                if (user.status !== types_1.UserStatus.ACTIVE) {
                    throw new error_1.AppError('Account is not active', 403);
                }
                // Update last login
                user.lastLogin = new Date();
                // Award daily login points
                await this.awardDailyLoginPoints(user);
                await user.save();
            }
            else {
                // New user - create account
                // Apple might provide user info only on first sign-in
                const firstName = appleUser?.name?.firstName || appleUser?.givenName || 'User';
                const lastName = appleUser?.name?.lastName || appleUser?.familyName || '';
                user = await User_1.default.create({
                    firstName,
                    lastName,
                    email,
                    password: this.generateRandomPassword(), // Generate random password for OAuth users
                    role: role || types_1.UserRole.CUSTOMER,
                    emailVerified: email_verified === 'true' || email_verified === true,
                    status: email_verified ? types_1.UserStatus.ACTIVE : types_1.UserStatus.PENDING_VERIFICATION,
                    oauthProvider: 'apple',
                    oauthId: appleId,
                });
                // Create wallet for user
                await Additional_1.Wallet.create({ user: user._id });
                // Generate affiliate code if applicable
                if (role === types_1.UserRole.AFFILIATE || user.isAffiliate) {
                    user.affiliateCode = (0, helpers_1.generateAffiliateCode)(email);
                    await user.save();
                }
                // Vendor welcome emails are sent after admin approval, not at OAuth registration
            }
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
        catch (error) {
            console.error('Apple OAuth error:', error);
            throw new error_1.AppError('Apple authentication failed', 400);
        }
    }
    /**
     * Award daily login points with streak tracking
     */
    async awardDailyLoginPoints(user) {
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
        }
        else if (!lastLogin || lastLogin.getTime() < yesterday.getTime()) {
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
        // Create transaction record
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
        console.log(`✅ Daily login points awarded: ${pointsAwarded} to user ${user.email} (Streak: ${newStreak})`);
    }
    /**
     * Generate random password for OAuth users
     */
    generateRandomPassword() {
        return Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
    }
}
exports.OAuthController = OAuthController;
exports.oauthController = new OAuthController();
//# sourceMappingURL=oauthController.js.map