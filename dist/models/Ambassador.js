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
const ambassadorSchema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    role: { type: String, enum: ['student', 'state'], required: true },
    location: { type: String, required: true, trim: true },
    social: { type: String, trim: true },
    why: { type: String, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
    },
    inviteToken: { type: String, select: false },
    inviteTokenExpires: { type: Date },
    ambassadorCode: { type: String, unique: true, sparse: true, uppercase: true },
    adminNotes: [
        {
            text: { type: String, required: true },
            createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
            createdByName: String,
            createdAt: { type: Date, default: Date.now },
        },
    ],
    approvedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedAt: Date,
    rejectionReason: String,
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', sparse: true },
}, { timestamps: true });
ambassadorSchema.index({ email: 1 });
ambassadorSchema.index({ status: 1 });
ambassadorSchema.index({ ambassadorCode: 1 });
ambassadorSchema.index({ inviteToken: 1 });
ambassadorSchema.index({ userId: 1 });
const Ambassador = mongoose_1.default.model('Ambassador', ambassadorSchema);
exports.default = Ambassador;
//# sourceMappingURL=Ambassador.js.map