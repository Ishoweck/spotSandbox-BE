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
const walletTransactionSchema = new mongoose_1.Schema({
    type: {
        type: String,
        enum: Object.values(types_1.TransactionType),
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    purpose: {
        type: String,
        enum: Object.values(types_1.WalletPurpose),
        required: true,
    },
    reference: {
        type: String,
        required: true,
        // REMOVED: unique: true - This was causing the error
        // Uniqueness will be enforced by the sparse index below
    },
    description: String,
    relatedOrder: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Order',
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'completed',
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
}, { _id: true });
const walletSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
    },
    balance: {
        type: Number,
        default: 0,
        min: 0,
    },
    vCredits: {
        type: Number,
        default: 0,
        min: 0,
    },
    vCreditsExpiresAt: {
        type: Date,
    },
    vCreditsRemindersSent: {
        type: [Number],
        default: [],
    },
    totalEarned: {
        type: Number,
        default: 0,
    },
    totalSpent: {
        type: Number,
        default: 0,
    },
    totalWithdrawn: {
        type: Number,
        default: 0,
    },
    pendingBalance: {
        type: Number,
        default: 0,
    },
    transactions: [walletTransactionSchema],
}, {
    timestamps: true,
});
// Indexes
walletSchema.index({ user: 1 });
// FIXED: Added sparse: true to allow empty transaction arrays
// This ensures uniqueness only for actual transaction references
walletSchema.index({ 'transactions.reference': 1 }, { unique: true, sparse: true });
const Wallet = mongoose_1.default.model('Wallet', walletSchema);
exports.default = Wallet;
//# sourceMappingURL=Wallet.js.map