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
const customerOrderRecordSchema = new mongoose_1.Schema({
    orderId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderAmount: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    paidAt: { type: Date, default: Date.now },
}, { _id: false });
const ambassadorReferralSchema = new mongoose_1.Schema({
    ambassadorId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    referredUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    referredUserType: { type: String, enum: ['vendor', 'customer'], required: true },
    // Vendor fields
    ordinalPosition: Number,
    tierRate: Number,
    partialCount: { type: Number, default: 0 },
    stage40Reached: { type: Boolean, default: false },
    stage60Reached: { type: Boolean, default: false },
    commission40Amount: { type: Number, default: 0 },
    commission60Amount: { type: Number, default: 0 },
    commission40PaidAt: Date,
    commission60PaidAt: Date,
    // Customer fields
    customerOrdersTracked: { type: [customerOrderRecordSchema], default: [] },
    totalEarned: { type: Number, default: 0 },
}, { timestamps: true });
ambassadorReferralSchema.index({ ambassadorId: 1, referredUserType: 1 });
ambassadorReferralSchema.index({ ambassadorId: 1, referredUserId: 1 }, { unique: true });
ambassadorReferralSchema.index({ referredUserId: 1 });
const AmbassadorReferral = mongoose_1.default.model('AmbassadorReferral', ambassadorReferralSchema);
exports.default = AmbassadorReferral;
//# sourceMappingURL=AmbassadorReferral.js.map