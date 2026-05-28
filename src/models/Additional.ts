import mongoose, { Schema, Document, Types } from 'mongoose';
import { ChallengeType, ChallengeStatus, NotificationType, IChallenge } from '../types';

// Coupon Model
export interface ICoupon extends Document {
  code: string;
  description?: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minPurchase?: number;
  maxDiscount?: number;
  usageLimit?: number;
  usageCount: number;
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
  applicableProducts?: Types.ObjectId[];
  applicableCategories?: Types.ObjectId[];
  excludedProducts?: Types.ObjectId[];
  usedBy: Types.ObjectId[];
  assignedTo?: Types.ObjectId[]; // if set, only these users can redeem this coupon
}

const couponSchema = new Schema<ICoupon>({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  description: String,
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true,
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0,
  },
  minPurchase: {
    type: Number,
    default: 0,
  },
  maxDiscount: Number,
  usageLimit: Number,
  usageCount: {
    type: Number,
    default: 0,
  },
  validFrom: {
    type: Date,
    required: true,
  },
  validUntil: {
    type: Date,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  applicableProducts: [{
    type: Schema.Types.ObjectId,
    ref: 'Product',
  }],
  applicableCategories: [{
    type: Schema.Types.ObjectId,
    ref: 'Category',
  }],
  excludedProducts: [{
    type: Schema.Types.ObjectId,
    ref: 'Product',
  }],
  usedBy: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  assignedTo: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
}, {
  timestamps: true,
});

couponSchema.index({ code: 1 });
couponSchema.index({ validFrom: 1, validUntil: 1 });
couponSchema.index({ assignedTo: 1, isActive: 1 });

// Affiliate Link Model
export interface IAffiliateLink extends Document {
  user: Types.ObjectId;
  product?: Types.ObjectId;
  code: string;
  clicks: number;
  conversions: number;
  totalEarned: number;
  isActive: boolean;
}

const affiliateLinkSchema = new Schema<IAffiliateLink>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
  },
  code: {
    type: String,
    required: true,
    unique: true,
  },
  clicks: {
    type: Number,
    default: 0,
  },
  conversions: {
    type: Number,
    default: 0,
  },
  totalEarned: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

affiliateLinkSchema.index({ user: 1 });
affiliateLinkSchema.index({ code: 1 });

// Challenge Model
// Challenge Model - interface imported from types
const challengeSchema = new Schema<IChallenge>({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: Object.values(ChallengeType),
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  targetType: {
    type: String,
    required: true,
  },
  targetValue: {
    type: Number,
    required: true,
  },
  rewardType: {
    type: String,
    enum: ['points', 'cash'],
    required: true,
  },
  rewardValue: {
    type: Number,
    required: true,
  },
  isRecurring: {
    type: Boolean,
    default: false,
  },
  recurringPeriod: String,
  isActive: {
    type: Boolean,
    default: true,
  },
  participants: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    progress: {
      type: Number,
      default: 0,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    completedAt: Date,
    rewardClaimed: {
      type: Boolean,
      default: false,
    },
  }],
}, {
  timestamps: true,
});

challengeSchema.index({ type: 1, status: 1 });
challengeSchema.index({ startDate: 1, endDate: 1 });

// Notification Model
export interface INotification extends Document {
  user: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  data?: any;
  read: boolean;
  link?: string;
}

const notificationSchema = new Schema<INotification>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: Object.values(NotificationType),
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  data: Schema.Types.Mixed,
  read: {
    type: Boolean,
    default: false,
  },
  link: String,
}, {
  timestamps: true,
});

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

// Chat Message Model
export interface IChatMessage extends Document {
  conversationId: string;
  sender: Types.ObjectId;
  receiver: Types.ObjectId;
  message: string;
  messageType: 'text' | 'image' | 'file' | 'system';
  fileUrl?: string;
  orderId?: Types.ObjectId;
  replyTo?: {
    messageId: Types.ObjectId;
    message: string;
    senderName: string;
    messageType: string;
  };
  read: boolean;
  readAt?: Date;
  deleted: boolean;
  deletedAt?: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
  conversationId: {
    type: String,
    required: true,
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiver: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text',
  },
  fileUrl: String,
  orderId: {
    type: Schema.Types.ObjectId,
    ref: 'Order',
  },
  replyTo: {
    type: new Schema({
      messageId: { type: Schema.Types.ObjectId, ref: 'ChatMessage' },
      message: String,
      senderName: String,
      messageType: { type: String, default: 'text' },
    }, { _id: false }),
    default: undefined,
  },
  read: {
    type: Boolean,
    default: false,
  },
  readAt: Date,
  deleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: Date,
}, {
  timestamps: true,
});

chatMessageSchema.index({ conversationId: 1, createdAt: -1 });
chatMessageSchema.index({ sender: 1, receiver: 1 });

// Wishlist Model
export interface IWishlist extends Document {
  user: Types.ObjectId;
  items: Array<{
    product: Types.ObjectId;
    addedAt?: Date;
  }>;
}

const wishlistSchema = new Schema<IWishlist>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [{
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  }],
}, {
  timestamps: true,
});

wishlistSchema.index({ user: 1 });

export const Coupon = mongoose.model<ICoupon>('Coupon', couponSchema);
export const AffiliateLink = mongoose.model<IAffiliateLink>('AffiliateLink', affiliateLinkSchema);
export const Challenge = mongoose.model<IChallenge>('Challenge', challengeSchema);
export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema);
export const Wishlist = mongoose.model<IWishlist>('Wishlist', wishlistSchema);

// Export Wallet
import WalletModel from './Wallet';
export const Wallet = WalletModel;
