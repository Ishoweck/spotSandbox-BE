"use strict";
// models/User.ts - COMPLETE USER MODEL WITH OAUTH SUPPORT
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const types_1 = require("../types");
const addressSchema = new mongoose_1.Schema({
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true, default: 'Nigeria' },
    postalCode: String,
    zipCode: String,
    isDefault: { type: Boolean, default: false },
    label: String,
    fullName: String,
    phone: String,
    shipBubble: {
        addressCode: Number,
        formattedAddress: String,
        latitude: Number,
        longitude: Number,
        validatedAt: Date,
    },
}, { _id: true });
const userSchema = new mongoose_1.Schema({
    firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true,
    },
    lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true,
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
    },
    phone: {
        type: String,
        trim: true,
    },
    password: {
        type: String,
        required: function () {
            // Password not required for OAuth users
            return !this.oauthProvider;
        },
        minlength: 6,
        select: false,
    },
    role: {
        type: String,
        enum: Object.values(types_1.UserRole),
        default: types_1.UserRole.CUSTOMER,
    },
    status: {
        type: String,
        enum: Object.values(types_1.UserStatus),
        default: types_1.UserStatus.PENDING_VERIFICATION,
    },
    avatar: String,
    addresses: [addressSchema],
    emailVerified: {
        type: Boolean,
        default: false,
    },
    phoneVerified: {
        type: Boolean,
        default: false,
    },
    otp: {
        code: String,
        expiresAt: Date,
    },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    activationToken: String,
    activationTokenExpires: Date,
    fcmTokens: [String],
    lastLogin: Date,
    isAffiliate: {
        type: Boolean,
        default: false,
    },
    affiliateCode: {
        type: String,
        unique: true,
        sparse: true,
    },
    referredBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
    points: {
        type: Number,
        default: 0,
    },
    badges: [String],
    achievements: [String],
    // ✅ LOGIN STREAK TRACKING
    loginStreak: {
        currentStreak: {
            type: Number,
            default: 0,
        },
        lastLoginDate: {
            type: Date,
            default: null,
        },
    },
    // ✅ OAUTH FIELDS
    oauthProvider: {
        type: String,
        enum: ['google', 'apple', 'facebook'],
        sparse: true,
    },
    oauthId: {
        type: String,
        sparse: true,
    },
    // Bank account for withdrawals (customers)
    payoutDetails: {
        bankName: String,
        accountNumber: String,
        accountName: String,
        bankCode: String,
    },
    transactionPin: {
        type: String,
        select: false,
    },
    hasTransactionPin: {
        type: Boolean,
        default: false,
    },
    outreach: {
        status: {
            type: String,
            enum: ['not_contacted', 'contacted', 'follow_up', 'responded', 'converted', 'not_interested'],
            default: 'not_contacted',
        },
        assignee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
        assigneeName: String,
        lastContactedAt: Date,
        notes: [{
                text: { type: String, required: true },
                createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
                createdByName: String,
                createdAt: { type: Date, default: Date.now },
            }],
    },
    // Notification preferences
    notificationPreferences: {
        pushEnabled: { type: Boolean, default: true },
        order: [{
                id: String,
                enabled: { type: Boolean, default: true },
            }],
        promo: [{
                id: String,
                enabled: { type: Boolean, default: true },
            }],
        social: [{
                id: String,
                enabled: { type: Boolean, default: true },
            }],
    },
}, {
    timestamps: true,
});
// Indexes
userSchema.index({ email: 1 });
userSchema.index({ affiliateCode: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ oauthProvider: 1, oauthId: 1 }); // ✅ OAuth index
// Hash password before saving
userSchema.pre('save', async function (next) {
    // Skip hashing for OAuth users without password
    if (!this.password || !this.isModified('password')) {
        return next();
    }
    try {
        const salt = await bcryptjs_1.default.genSalt(10);
        this.password = await bcryptjs_1.default.hash(this.password, salt);
        next();
    }
    catch (error) {
        next(error);
    }
});
// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    try {
        // If user has no password (OAuth user), return false
        if (!this.password) {
            return false;
        }
        return await bcryptjs_1.default.compare(candidatePassword, this.password);
    }
    catch (error) {
        return false;
    }
};
const User = (0, mongoose_1.model)('User', userSchema);
exports.default = User;
//# sourceMappingURL=User.js.map