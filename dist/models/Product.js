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
const productVariantSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    compareAtPrice: Number,
    sku: String,
    quantity: { type: Number, required: true, default: 0 },
    attributes: { type: Map, of: String },
}, { _id: true });
const productSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
    },
    description: {
        type: String,
        default: '',
    },
    shortDescription: {
        type: String,
        maxlength: 200,
    },
    vendor: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    category: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Category',
        required: true,
    },
    subcategory: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Category',
    },
    productType: {
        type: String,
        enum: Object.values(types_1.ProductType),
        required: true,
    },
    price: {
        type: Number,
        required: true,
        min: 0,
    },
    compareAtPrice: {
        type: Number,
        min: 0,
    },
    costPrice: {
        type: Number,
        min: 0,
    },
    sku: {
        type: String,
        required: true,
        unique: true,
    },
    quantity: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    lowStockThreshold: {
        type: Number,
        default: 10,
    },
    images: {
        type: [String],
        default: [],
    },
    videos: [String],
    variants: [productVariantSchema],
    tags: [String],
    status: {
        type: String,
        enum: Object.values(types_1.ProductStatus),
        default: types_1.ProductStatus.PENDING_APPROVAL,
    },
    isFlashSale: {
        type: Boolean,
        default: false,
    },
    flashSaleEndsAt: {
        type: Date,
        default: null,
    },
    isFeatured: {
        type: Boolean,
        default: false,
    },
    isAffiliate: {
        type: Boolean,
        default: true,
    },
    affiliateCommission: {
        type: Number,
        default: 3,
        min: 0,
        max: 100,
    },
    weight: Number,
    dimensions: {
        length: Number,
        width: Number,
        height: Number,
    },
    pickupAddress: {
        street: String,
        city: String,
        state: String,
        country: { type: String, default: 'Nigeria' },
        fullName: String,
        phone: String,
        shipBubble: {
            addressCode: Number,
            formattedAddress: String,
            latitude: Number,
            longitude: Number,
            validatedAt: Date,
        },
    },
    digitalFile: {
        url: String,
        fileName: String,
        fileSize: Number,
        fileType: String,
        version: String,
        uploadedAt: Date,
        isExternalLink: { type: Boolean, default: false },
    },
    requiresLicense: {
        type: Boolean,
        default: false,
    },
    licenseType: {
        type: String,
        enum: ['lifetime', 'subscription', 'trial'],
    },
    licenses: [{
            key: String,
            userId: {
                type: mongoose_1.Schema.Types.ObjectId,
                ref: 'User',
            },
            orderId: {
                type: mongoose_1.Schema.Types.ObjectId,
                ref: 'Order',
            },
            activatedAt: Date,
            expiresAt: Date,
            isActive: {
                type: Boolean,
                default: true,
            },
            deviceInfo: mongoose_1.Schema.Types.Mixed,
        }],
    colors: {
        type: [String],
        default: [],
    },
    sizes: {
        type: [String],
        default: [],
    },
    // NEW: Product details fields
    keyFeatures: {
        type: [String],
        default: [],
    },
    specifications: {
        type: Map,
        of: String,
        default: {},
    },
    // Existing fields
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
    totalSales: {
        type: Number,
        default: 0,
    },
    views: {
        type: Number,
        default: 0,
    },
    metaTitle: String,
    metaDescription: String,
    seo: {
        keywords: [String],
    },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
// Virtual for discount percentage
productSchema.virtual('discountPercentage').get(function () {
    if (this.compareAtPrice && this.compareAtPrice > this.price) {
        return Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100);
    }
    return 0;
});
// Virtual for in stock status
productSchema.virtual('inStock').get(function () {
    return this.quantity > 0;
});
// Indexes
productSchema.index({ slug: 1 });
productSchema.index({ vendor: 1, status: 1 });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ productType: 1, status: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ price: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ totalSales: -1 });
productSchema.index({ createdAt: -1 });
const Product = mongoose_1.default.model('Product', productSchema);
exports.default = Product;
//# sourceMappingURL=Product.js.map