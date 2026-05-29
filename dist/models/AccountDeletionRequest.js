"use strict";
// ============================================================
// ACCOUNT DELETION REQUEST MODEL
// File: models/AccountDeletionRequest.ts
// ============================================================
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
const accountDeletionRequestSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    userEmail: { type: String },
    userFullName: { type: String },
    reason: {
        type: String,
        required: true,
    },
    additionalDetails: {
        type: String,
        maxlength: 1000,
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'cancelled'],
        default: 'pending',
        index: true,
    },
    userRole: {
        type: String,
        enum: ['customer', 'vendor'],
        required: true,
    },
    hasPendingOrders: {
        type: Boolean,
        default: false,
    },
    pendingOrdersCount: {
        type: Number,
        default: 0,
    },
    processedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
    processedAt: Date,
    rejectionReason: String,
}, {
    timestamps: true,
});
// Indexes
accountDeletionRequestSchema.index({ user: 1, status: 1 });
accountDeletionRequestSchema.index({ createdAt: -1 });
accountDeletionRequestSchema.index({ status: 1, createdAt: -1 });
const AccountDeletionRequest = mongoose_1.default.model('AccountDeletionRequest', accountDeletionRequestSchema);
exports.default = AccountDeletionRequest;
//# sourceMappingURL=AccountDeletionRequest.js.map