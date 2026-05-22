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
// models/Order.ts - UPDATED FOR DIGITAL PRODUCTS
const mongoose_1 = __importStar(require("mongoose"));
const types_1 = require("../types");
const orderItemSchema = new mongoose_1.Schema({
    product: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    },
    productName: {
        type: String,
        required: true,
    },
    productImage: {
        type: String,
        required: true,
    },
    productType: String, // ✅ ADDED for digital/physical/service
    variant: String,
    quantity: {
        type: Number,
        required: true,
        min: 1,
    },
    price: {
        type: Number,
        required: true,
    },
    vendor: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
}, { _id: false });
const shippingDetailsSchema = new mongoose_1.Schema({
    method: String,
    cost: Number,
    estimatedDelivery: Date,
    trackingNumber: String,
    carrier: String,
}, { _id: false });
const addressSchema = new mongoose_1.Schema({
    street: { type: String }, // ✅ REMOVED required: true
    city: { type: String }, // ✅ REMOVED required: true
    state: { type: String }, // ✅ REMOVED required: true
    country: { type: String }, // ✅ REMOVED required: true
    zipCode: String,
    postalCode: String,
    fullName: String,
    phone: String,
    isDefault: Boolean,
    label: String,
}, { _id: false });
const vendorShipmentSchema = new mongoose_1.Schema({
    vendor: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    vendorName: {
        type: String,
        required: true,
    },
    items: [{
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'Product',
        }],
    origin: {
        street: String,
        city: { type: String, required: true },
        state: { type: String, required: true },
        country: { type: String, required: true },
    },
    shippingCost: {
        type: Number,
        required: true,
        default: 0,
    },
    trackingNumber: String,
    trackingUrl: String,
    shipmentId: String,
    courier: String,
    estimatedDelivery: Date,
    paidAt: Date,
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'processing', 'created', 'shipped', 'in_transit', 'delivered', 'cancelled'],
        default: 'pending',
    },
}, { _id: false });
const orderSchema = new mongoose_1.Schema({
    orderNumber: {
        type: String,
        required: true,
        unique: true,
    },
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    items: [orderItemSchema],
    subtotal: {
        type: Number,
        required: true,
    },
    discount: {
        type: Number,
        default: 0,
    },
    shippingCost: {
        type: Number,
        default: 0,
    },
    tax: {
        type: Number,
        default: 0,
    },
    serviceCharge: {
        type: Number,
        default: 0,
    },
    total: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: Object.values(types_1.OrderStatus),
        default: types_1.OrderStatus.PENDING,
    },
    paymentStatus: {
        type: String,
        enum: Object.values(types_1.PaymentStatus),
        default: types_1.PaymentStatus.PENDING,
    },
    paymentMethod: {
        type: String,
        enum: Object.values(types_1.PaymentMethod),
        required: true,
    },
    paymentReference: String,
    shippingAddress: {
        type: addressSchema,
        required: false, // ✅ CHANGED to false (not required for digital products)
    },
    billingAddress: addressSchema,
    shippingDetails: shippingDetailsSchema,
    couponCode: String,
    notes: String,
    deliveryType: {
        type: String,
        default: 'standard',
    },
    isPickup: {
        type: Boolean,
        default: false,
    },
    isDigital: {
        type: Boolean,
        default: false,
    },
    // Multi-vendor shipments
    vendorShipments: [vendorShipmentSchema],
    // Legacy fields
    trackingNumber: String,
    shipmentId: String,
    courier: String,
    estimatedDelivery: Date,
    cancelReason: String,
    refundAmount: Number,
    refundReason: String,
    deliveredAt: Date,
    fundsReleased: { type: Boolean, default: false },
    affiliateUser: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
    affiliateCommission: Number,
    statusHistory: [{
            status: {
                type: String,
                enum: Object.values(types_1.OrderStatus),
                required: true,
            },
            timestamp: {
                type: Date,
                default: Date.now,
            },
            note: String,
        }],
}, {
    timestamps: true, // ✅ This adds createdAt and updatedAt automatically
});
// Add status to history before saving
orderSchema.pre('save', function (next) {
    if (this.isModified('status')) {
        this.statusHistory.push({
            status: this.status,
            timestamp: new Date(),
        });
    }
    next();
});
// Indexes
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ 'items.vendor': 1 });
orderSchema.index({ trackingNumber: 1 });
orderSchema.index({ shipmentId: 1 });
orderSchema.index({ 'vendorShipments.vendor': 1 });
orderSchema.index({ 'vendorShipments.trackingNumber': 1 });
orderSchema.index({ isDigital: 1 }); // ✅ ADDED index
const Order = mongoose_1.default.model('Order', orderSchema);
exports.default = Order;
//# sourceMappingURL=Order.js.map