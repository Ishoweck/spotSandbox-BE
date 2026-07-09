import mongoose, { Schema, Document, Types } from 'mongoose';
import { VendorVerificationStatus, IKYCDocument, IPayoutDetails } from '../types';

export interface IVendorProfile extends Document {
  user: Types.ObjectId;
  businessName: string;
  slug: string;
  businessDescription?: string;
  businessLogo?: string;
  businessBanner?: string;
  businessAddress: {
    street: string;
    city: string;
    state: string;
    country: string;
    shipBubble?: {
      addressCode: number;
      formattedAddress: string;
      latitude?: number;
      longitude?: number;
      validatedAt: Date;
    };
  };
  businessPhone: string;
  businessEmail: string;
  businessWebsite?: string;
  kycDocuments: IKYCDocument[];
  verificationStatus: VendorVerificationStatus;
  verifiedAt?: Date;
  payoutDetails?: IPayoutDetails;
  followers: Schema.Types.ObjectId[]; // ✅ ADD THIS FIELD

  commissionRate: number;
  totalSales: number;
  totalOrders: number;
  averageRating: number;
  totalReviews: number;
  isPremium: boolean;
  isActive: boolean;
  storefront: {
    theme?: string;
    bannerImages?: string[];
    customMessage?: string;
  };
  socialMedia?: {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    tiktok?: string;
  };
  businessSurvey?: {
    salesChannel?: string;
    weeklyOrders?: string;
    stockModel?: string;
    registered?: string;
    kycDoc?: string;
    goal?: string;
    dispatchTime?: string;
    submittedAt?: Date;
  };
  referredBy?: Types.ObjectId;
  referralRewarded: boolean;
  responseRate: number;
  responseSpeed: number;
  statsComputedAt?: Date;
  rejectionReason?: string;
  statusHistory: {
    action: string;
    changedBy?: Types.ObjectId | string;
    reason?: string;
    at: Date;
  }[];
  outreach?: {
    status: 'not_contacted' | 'contacted' | 'follow_up' | 'responded' | 'converted' | 'not_interested';
    assignee?: Types.ObjectId;
    assigneeName?: string;
    lastContactedAt?: Date;
    notes: {
      text: string;
      createdBy?: Types.ObjectId;
      createdByName?: string;
      createdAt: Date;
    }[];
  };
}

const vendorProfileSchema = new Schema<IVendorProfile>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  businessName: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    trim: true,
    lowercase: true,
  },
  businessDescription: {
    type: String,
    maxlength: 1000,
  },
  businessLogo: String,
  businessBanner: String,
  businessAddress: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true, default: 'Nigeria' },
    shipBubble: {
      addressCode: Number,
      formattedAddress: String,
      latitude: Number,
      longitude: Number,
      validatedAt: Date,
    },
  },
  businessPhone: {
    type: String,
    required: true,
  },
  businessEmail: {
    type: String,
    required: true,
  },
  businessWebsite: String,
  kycDocuments: [{
    type: {
      type: String,
      enum: ['NIN', 'CAC', 'ID_CARD', 'PASSPORT', 'DRIVERS_LICENSE', 'UTILITY_BILL'],
      required: true,
    },
    documentUrl: {
      type: String,
      required: true,
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
    verifiedAt: Date,
    rejectionReason: String,
  }],
  verificationStatus: {
    type: String,
    enum: Object.values(VendorVerificationStatus),
    default: VendorVerificationStatus.PENDING,
  },
  verifiedAt: Date,
  
  payoutDetails: {
    bankName: String,
    accountNumber: String,
    accountName: String,
    bankCode: String,
  },
    followers: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
      index: true,
    },
  commissionRate: {
    type: Number,
    default: 8,
    min: 0,
    max: 100,
  },
  totalSales: {
    type: Number,
    default: 0,
  },
  totalOrders: {
    type: Number,
    default: 0,
  },
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
  isPremium: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  storefront: {
    theme: String,
    bannerImages: [String],
    customMessage: String,
  },
  socialMedia: {
    facebook: String,
    instagram: String,
    twitter: String,
    tiktok: String,
  },
  businessSurvey: {
    salesChannel: String,
    weeklyOrders: String,
    stockModel: String,
    registered: String,
    kycDoc: String,
    goal: String,
    dispatchTime: String,
    submittedAt: { type: Date, default: Date.now },
  },
  referredBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  referralRewarded: {
    type: Boolean,
    default: false,
  },
  responseRate: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
  },
  responseSpeed: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
  },
  statsComputedAt: Date,
  rejectionReason: String,
  statusHistory: [{
    action: { type: String, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    at: { type: Date, default: Date.now },
  }],
  outreach: {
    status: {
      type: String,
      enum: ['not_contacted', 'contacted', 'follow_up', 'responded', 'converted', 'not_interested'],
      default: 'not_contacted',
    },
    assignee: { type: Schema.Types.ObjectId, ref: 'User' },
    assigneeName: String,
    lastContactedAt: Date,
    notes: [{
      text: { type: String, required: true },
      createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
      createdByName: String,
      createdAt: { type: Date, default: Date.now },
    }],
  },
}, {
  timestamps: true,
});

// Indexes
vendorProfileSchema.index({ user: 1 });
vendorProfileSchema.index({ slug: 1 }, { unique: true, sparse: true });
vendorProfileSchema.index({ verificationStatus: 1 });
vendorProfileSchema.index({ isActive: 1 });
vendorProfileSchema.index({ followers: 1 });


const VendorProfile = mongoose.model<IVendorProfile>('VendorProfile', vendorProfileSchema);

export default VendorProfile;
