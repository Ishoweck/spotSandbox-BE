"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const pointsTransactionSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    type: {
        type: String,
        enum: ['earn', 'spend', 'expire'],
        required: true,
    },
    activity: {
        type: String,
        enum: ['login', 'purchase', 'review', 'share', 'referral', 'redemption', 'bonus', 'other'],
        required: true,
    },
    points: {
        type: Number,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    reference: {
        type: String,
        sparse: true,
    },
    status: {
        type: String,
        enum: ['active', 'locked', 'expired'],
        default: 'active',
    },
    expiresAt: {
        type: Date,
    },
    lockedForVendor: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
    remindersSent: {
        type: [Number],
        default: [],
    },
    metadata: {
        type: mongoose_1.Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
});
pointsTransactionSchema.index({ user: 1, createdAt: -1 });
pointsTransactionSchema.index({ user: 1, activity: 1 });
pointsTransactionSchema.index({ type: 1, createdAt: -1 });
pointsTransactionSchema.index({ status: 1, expiresAt: 1 });
pointsTransactionSchema.index({ lockedForVendor: 1, status: 1 });
const PointsTransaction = (0, mongoose_1.model)('PointsTransaction', pointsTransactionSchema);
exports.default = PointsTransaction;
//# sourceMappingURL=PointsTransaction.js.map