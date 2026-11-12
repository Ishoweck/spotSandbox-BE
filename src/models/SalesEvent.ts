import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Seasonal sales events (Black Friday, Christmas Sale, ...).
 *
 * Admin creates the event and owns all of its copy. Vendors submit products
 * with an event price; admin approves each one. While the event is live the
 * approved products have their real price swapped for the event price (see
 * services/sales-event.service.ts), so cart/checkout need no special casing.
 */
export interface ISalesEvent extends Document {
  name: string;
  slug: string;
  tagline?: string;
  description?: string;
  vendorMessage?: string;
  badgeText: string;
  bannerImage?: string;
  themeColor: string;
  textColor: string;
  startsAt: Date;
  endsAt: Date;
  submissionDeadline?: Date;
  minDiscountPercent: number;
  isPublished: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const salesEventSchema = new Schema<ISalesEvent>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    tagline: { type: String, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 2000 },
    vendorMessage: { type: String, trim: true, maxlength: 2000 },
    badgeText: { type: String, required: true, trim: true, maxlength: 24 },
    bannerImage: { type: String },
    themeColor: { type: String, default: '#111827' },
    textColor: { type: String, default: '#FFFFFF' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    submissionDeadline: { type: Date },
    minDiscountPercent: { type: Number, default: 5, min: 0, max: 90 },
    isPublished: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

salesEventSchema.index({ isPublished: 1, endsAt: 1 });

export type SalesEventListingStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface ISalesEventListing extends Document {
  event: Types.ObjectId;
  product: Types.ObjectId;
  vendor: Types.ObjectId;
  eventPrice: number;
  status: SalesEventListingStatus;
  rejectionReason?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  // Set while the event price is live on the product, so it can be restored.
  applied: boolean;
  appliedAt?: Date;
  originalPrice?: number;
  originalCompareAtPrice?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const salesEventListingSchema = new Schema<ISalesEventListing>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'SalesEvent', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    eventPrice: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'withdrawn'],
      default: 'pending',
    },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    applied: { type: Boolean, default: false },
    appliedAt: { type: Date },
    originalPrice: { type: Number },
    originalCompareAtPrice: { type: Number, default: null },
  },
  { timestamps: true }
);

salesEventListingSchema.index({ event: 1, product: 1 }, { unique: true });
salesEventListingSchema.index({ event: 1, status: 1 });
salesEventListingSchema.index({ vendor: 1, event: 1 });
salesEventListingSchema.index({ applied: 1 });

export const SalesEvent = mongoose.model<ISalesEvent>('SalesEvent', salesEventSchema);
export const SalesEventListing = mongoose.model<ISalesEventListing>(
  'SalesEventListing',
  salesEventListingSchema
);
