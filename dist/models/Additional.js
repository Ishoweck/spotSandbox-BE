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
exports.Wallet = exports.Wishlist = exports.ChatMessage = exports.Notification = exports.Challenge = exports.AffiliateLink = exports.Coupon = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const types_1 = require("../types");
const couponSchema = new mongoose_1.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
    },
    description: String,
    discountType: {
        type: String,
        enum: ['percentage', 'fixed'],
        required: true,
    },
    discountValue: {
        type: Number,
        required: true,
        min: 0,
    },
    minPurchase: {
        type: Number,
        default: 0,
    },
    maxDiscount: Number,
    usageLimit: Number,
    usageCount: {
        type: Number,
        default: 0,
    },
    validFrom: {
        type: Date,
        required: true,
    },
    validUntil: {
        type: Date,
        required: true,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    applicableProducts: [{
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Product',
        }],
    applicableCategories: [{
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Category',
        }],
    excludedProducts: [{
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Product',
        }],
    usedBy: [{
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'User',
        }],
    assignedTo: [{
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'User',
        }],
}, {
    timestamps: true,
});
couponSchema.index({ code: 1 });
couponSchema.index({ validFrom: 1, validUntil: 1 });
couponSchema.index({ assignedTo: 1, isActive: 1 });
const affiliateLinkSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    product: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Product',
    },
    code: {
        type: String,
        required: true,
        unique: true,
    },
    clicks: {
        type: Number,
        default: 0,
    },
    conversions: {
        type: Number,
        default: 0,
    },
    totalEarned: {
        type: Number,
        default: 0,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
}, {
    timestamps: true,
});
affiliateLinkSchema.index({ user: 1 });
affiliateLinkSchema.index({ code: 1 });
// Challenge Model
// Challenge Model - interface imported from types
const challengeSchema = new mongoose_1.Schema({
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        enum: Object.values(types_1.ChallengeType),
        required: true,
    },
    startDate: {
        type: Date,
        required: true,
    },
    endDate: {
        type: Date,
        required: true,
    },
    targetType: {
        type: String,
        required: true,
    },
    targetValue: {
        type: Number,
        required: true,
    },
    rewardType: {
        type: String,
        enum: ['points', 'cash'],
        required: true,
    },
    rewardValue: {
        type: Number,
        required: true,
    },
    isRecurring: {
        type: Boolean,
        default: false,
    },
    recurringPeriod: String,
    isActive: {
        type: Boolean,
        default: true,
    },
    participants: [{
            user: {
                type: mongoose_1.Schema.Types.ObjectId,
                ref: 'User',
                required: true,
            },
            progress: {
                type: Number,
                default: 0,
            },
            completed: {
                type: Boolean,
                default: false,
            },
            completedAt: Date,
            rewardClaimed: {
                type: Boolean,
                default: false,
            },
        }],
}, {
    timestamps: true,
});
challengeSchema.index({ type: 1, status: 1 });
challengeSchema.index({ startDate: 1, endDate: 1 });
const notificationSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    type: {
        type: String,
        enum: Object.values(types_1.NotificationType),
        required: true,
    },
    title: {
        type: String,
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
    data: mongoose_1.Schema.Types.Mixed,
    read: {
        type: Boolean,
        default: false,
    },
    link: String,
}, {
    timestamps: true,
});
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
const chatMessageSchema = new mongoose_1.Schema({
    conversationId: {
        type: String,
        required: true,
    },
    sender: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    receiver: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
    messageType: {
        type: String,
        enum: ['text', 'image', 'file', 'system'],
        default: 'text',
    },
    fileUrl: String,
    orderId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Order',
    },
    replyTo: {
        type: new mongoose_1.Schema({
            messageId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'ChatMessage' },
            message: String,
            senderName: String,
            messageType: { type: String, default: 'text' },
        }, { _id: false }),
        default: undefined,
    },
    read: {
        type: Boolean,
        default: false,
    },
    readAt: Date,
    deleted: {
        type: Boolean,
        default: false,
    },
    deletedAt: Date,
}, {
    timestamps: true,
});
chatMessageSchema.index({ conversationId: 1, createdAt: -1 });
chatMessageSchema.index({ sender: 1, receiver: 1 });
const wishlistSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
    },
    items: [{
            product: {
                type: mongoose_1.Schema.Types.ObjectId,
                ref: 'Product',
                required: true,
            },
            addedAt: {
                type: Date,
                default: Date.now,
            },
        }],
}, {
    timestamps: true,
});
wishlistSchema.index({ user: 1 });
exports.Coupon = mongoose_1.default.model('Coupon', couponSchema);
exports.AffiliateLink = mongoose_1.default.model('AffiliateLink', affiliateLinkSchema);
exports.Challenge = mongoose_1.default.model('Challenge', challengeSchema);
exports.Notification = mongoose_1.default.model('Notification', notificationSchema);
exports.ChatMessage = mongoose_1.default.model('ChatMessage', chatMessageSchema);
exports.Wishlist = mongoose_1.default.model('Wishlist', wishlistSchema);
// Export Wallet
const Wallet_1 = __importDefault(require("./Wallet"));
exports.Wallet = Wallet_1.default;
//# sourceMappingURL=Additional.js.map