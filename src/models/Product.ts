import mongoose, { Schema, Document, Types } from 'mongoose';
import { ProductType, ProductStatus, IProductVariant, IReview } from '../types';

export interface IProduct extends Document {
  name: string;
  slug: string;
  description: string;
  shortDescription?: string;
  vendor: Types.ObjectId;
  category: Types.ObjectId;
  subcategory?: Types.ObjectId;
  productType: ProductType;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  sku: string;
  quantity: number;
  lowStockThreshold: number;
  images: string[];
  videos?: string[];
  variants: IProductVariant[];
  tags: string[];
  status: ProductStatus;
  isFlashSale: boolean;
  flashSaleEndsAt?: Date;
  isFeatured: boolean;
  isAffiliate: boolean;
  affiliateCommission: number;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  digitalFile?: {
    url: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    version: string;
    uploadedAt: Date;
    isExternalLink?: boolean;
  };
  requiresLicense?: boolean;
  licenseType?: 'lifetime' | 'subscription' | 'trial';
  licenses?: Array<{
    key: string;
    userId: Types.ObjectId;
    orderId: Types.ObjectId;
    activatedAt?: Date;
    expiresAt?: Date;
    isActive: boolean;
    deviceInfo?: any;
  }>;
  colors?: string[];
  sizes?: string[];
  // NEW: Product details fields
  keyFeatures?: string[];
  specifications?: {
    [key: string]: string;
  };
  // Existing fields
  averageRating: number;
  totalReviews: number;
  totalSales: number;
  views: number;
  metaTitle?: string;
  metaDescription?: string;
  seo: {
    keywords?: string[];
  };
}

const productVariantSchema = new Schema<IProductVariant>({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  compareAtPrice: Number,
  sku: String,
  quantity: { type: Number, required: true, default: 0 },
  attributes: { type: Map, of: String },
}, { _id: true });

const productSchema = new Schema<IProduct>({
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
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  category: {
    type: Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
  },
  subcategory: {
    type: Schema.Types.ObjectId,
    ref: 'Category',
  },
  productType: {
    type: String,
    enum: Object.values(ProductType),
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
    enum: Object.values(ProductStatus),
    default: ProductStatus.PENDING_APPROVAL,
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
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
    },
    activatedAt: Date,
    expiresAt: Date,
    isActive: {
      type: Boolean,
      default: true,
    },
    deviceInfo: Schema.Types.Mixed,
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
productSchema.virtual('discountPercentage').get(function() {
  if (this.compareAtPrice && this.compareAtPrice > this.price) {
    return Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100);
  }
  return 0;
});

// Virtual for in stock status
productSchema.virtual('inStock').get(function() {
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

const Product = mongoose.model<IProduct>('Product', productSchema);

export default Product;