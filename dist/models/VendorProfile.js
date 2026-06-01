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
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const types_1 = require("../types");
const vendorProfileSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
    },
    businessName: {
        type: String,
        required: true,
        trim: true,
    },
    businessDescription: {
        type: String,
        maxlength: 1000,
    },
    businessLogo: String,
    businessBanner: String,
    businessAddress: {
        street: { type: String, required: true },
        city: { type: String, required: true },
        state: { type: String, required: true },
        country: { type: String, required: true, default: 'Nigeria' },
    },
    businessPhone: {
        type: String,
        required: true,
    },
    businessEmail: {
        type: String,
        required: true,
    },
    businessWebsite: String,
    kycDocuments: [{
            type: {
                type: String,
                enum: ['NIN', 'CAC', 'ID_CARD', 'PASSPORT', 'DRIVERS_LICENSE', 'UTILITY_BILL'],
                required: true,
            },
            documentUrl: {
                type: String,
                required: true,
            },
            verificationStatus: {
                type: String,
                enum: ['pending', 'verified', 'rejected'],
                default: 'pending',
            },
            verifiedAt: Date,
            rejectionReason: String,
        }],
    verificationStatus: {
        type: String,
        enum: Object.values(types_1.VendorVerificationStatus),
        default: types_1.VendorVerificationStatus.PENDING,
    },
    verifiedAt: Date,
    payoutDetails: {
        bankName: String,
        accountNumber: String,
        accountName: String,
        bankCode: String,
    },
    followers: {
        type: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'User' }],
        default: [],
        index: true,
    },
    commissionRate: {
        type: Number,
        default: 8,
        min: 0,
        max: 100,
    },
    totalSales: {
        type: Number,
        default: 0,
    },
    totalOrders: {
        type: Number,
        default: 0,
    },
    averageRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
    },
    totalReviews: {
        type: Number,
        default: 0,
    },
    isPremium: {
        type: Boolean,
        default: false,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    storefront: {
        theme: String,
        bannerImages: [String],
        customMessage: String,
    },
    socialMedia: {
        facebook: String,
        instagram: String,
        twitter: String,
        tiktok: String,
    },
    referredBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
    referralRewarded: {
        type: Boolean,
        default: false,
    },
    responseRate: {
        type: Number,
        default: 100,
        min: 0,
        max: 100,
    },
    responseSpeed: {
        type: Number,
        default: 100,
        min: 0,
        max: 100,
    },
    statsComputedAt: Date,
    rejectionReason: String,
    statusHistory: [{
            action: { type: String, required: true },
            changedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
            reason: String,
            at: { type: Date, default: Date.now },
        }],
}, {
    timestamps: true,
});
// Indexes
vendorProfileSchema.index({ user: 1 });
vendorProfileSchema.index({ verificationStatus: 1 });
vendorProfileSchema.index({ isActive: 1 });
vendorProfileSchema.index({ followers: 1 }); // ✅ ADD THIS LINE
const VendorProfile = mongoose_1.default.model('VendorProfile', vendorProfileSchema);
exports.default = VendorProfile;
//# sourceMappingURL=VendorProfile.js.map