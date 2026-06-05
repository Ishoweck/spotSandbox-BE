import { Request } from 'express';
import { Document, Types } from 'mongoose';

// User Roles
export enum UserRole {
  CUSTOMER = 'customer',
  VENDOR = 'vendor',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
  FINANCIAL_ADMIN = 'financial_admin',
  SUPPORT_ADMIN = 'support_admin',
  CONTENT_ADMIN = 'content_admin',
  KYC_ADMIN = 'kyc_admin',
  MARKETING_ADMIN = 'marketing_admin',
  AFFILIATE = 'affiliate'
}

// User Status
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  PENDING_VERIFICATION = 'pending_verification'
}

// Product Types
export enum ProductType {
  PHYSICAL = 'physical',
  DIGITAL = 'digital'
}

// Product Status
export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  OUT_OF_STOCK = 'out_of_stock',
  PENDING_APPROVAL = 'pending_approval',
  VENDOR_SUSPENDED = 'vendor_suspended',
}

// Order Status
export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  FAILED = 'failed',
  DISPUTED = 'disputed',
}

// Payment Status
export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded'
}

// Payment Method
export enum PaymentMethod {
  PAYSTACK = 'paystack',
  FLUTTERWAVE = 'flutterwave',
  WALLET = 'wallet',
}

// Transaction Types
export enum TransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit'
}

// Wallet Transaction Purpose
export enum WalletPurpose {
  PURCHASE = 'purchase',
  REFUND = 'refund',
  WITHDRAWAL = 'withdrawal',
  COMMISSION = 'commission',
  REWARD = 'reward',
  CASHBACK = 'cashback',
  TOP_UP = 'top_up'
}

// Vendor Verification Status
export enum VendorVerificationStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected'
}

// Delivery Status
export enum DeliveryStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  PICKED_UP = 'picked_up',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// Notification Types
export enum NotificationType {
  ORDER = 'order',
  PAYMENT = 'payment',
  DELIVERY = 'delivery',
  PROMOTION = 'promotion',
  ACCOUNT = 'account',
  CHAT = 'chat',
  REVIEW = 'review',
  SYSTEM = 'system',
  CHALLENGE = 'challenge'
}

// Challenge Types
export enum ChallengeType {
  BUYER = 'buyer',
  SELLER = 'seller',
  AFFILIATE = 'affiliate'
}

// Challenge Status
export enum ChallengeStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  COMPLETED = 'completed'
}

// Extended Request with User
export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: UserRole;
    email: string;
  };
  file?: Express.Multer.File;
  files?: Express.Multer.File[];
}

// Pagination
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

// API Response
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  code?: string;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
  };
}

// Address Interface
export interface IAddress {
  _id?: Types.ObjectId;
  street: string;
  city: string;
  state: string;
  country: string;
  zipCode?: string;
  postalCode?: string;
  isDefault?: boolean;
  label?: string;
  fullName?: string;
  phone?: string;
  shipBubble?: {
    addressCode?: number;
    formattedAddress?: string;
    latitude?: number;
    longitude?: number;
    validatedAt?: Date;
  };
}

// Address type for API responses
export interface Address {
  _id: string;
  street: string;
  city: string;
  state: string;
  country: string;
  zipCode?: string;
  postalCode?: string;
  isDefault: boolean;
  label?: string;
  fullName?: string;
  phone?: string;
  shipBubble?: {
    addressCode?: number;
    formattedAddress?: string;
    latitude?: number;
    longitude?: number;
    validatedAt?: Date;
  };
}

// Coordinate
export interface ICoordinate {
  latitude: number;
  longitude: number;
}

// Product Variant
export interface IProductVariant {
  name: string;
  price: number;
  compareAtPrice?: number;
  sku?: string;
  quantity: number;
  attributes: {
    [key: string]: string;
  };
}

// Cart Item
export interface ICartItem {
  product: Types.ObjectId;
  variant?: string;
  quantity: number;
  price: number;
}

// Order Item
export interface IOrderItem {
  product: Types.ObjectId;
  productName: string;
  productImage: string;
  variant?: string;
  quantity: number;
  price: number;
  vendor: Types.ObjectId;
  productType: string;
}

// Review Rating
export interface IReview {
  user: Types.ObjectId;
  rating: number;
  comment: string;
  images?: string[];
  helpful: number;
  createdAt: Date;
}

// Shipping Details
export interface IShippingDetails {
  method: string;
  cost: number;
  estimatedDelivery?: Date;
  trackingNumber?: string;
  carrier?: string;
}

// Payout Details
export interface IPayoutDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
  bankCode?: string;
}

// KYC Document
export interface IKYCDocument {
  type: string;
  documentUrl: string;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  verifiedAt?: Date;
  rejectionReason?: string;
}

// Commission Structure
export interface ICommissionStructure {
  affiliateRate: number;
  vendorRate: number;
  platformRate: number;
}

// Leaderboard Entry
export interface ILeaderboardEntry {
  user: Types.ObjectId;
  score: number;
  rank: number;
}

// File Upload
export interface IFileUpload {
  url: string;
  publicId: string;
  format: string;
  size: number;
}

// Challenge Participant
export interface IChallengeParticipant {
  user: Types.ObjectId;
  progress: number;
  completed: boolean;
  completedAt?: Date;
  rewardClaimed: boolean;
}

// Challenge Document
export interface IChallenge extends Document {
  _id: Types.ObjectId;
  title: string;
  description: string;
  type: ChallengeType;
  targetType: string;
  targetValue: number;
  rewardType: 'cash' | 'points';
  rewardValue: number;
  startDate: Date;
  endDate: Date;
  isRecurring: boolean;
  recurringPeriod?: string;
  isActive: boolean;
  participants: IChallengeParticipant[];
}

// User Document Interface - COMPLETE WITH OAUTH SUPPORT
export interface IUserDocument extends Document {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  avatar?: string;
  addresses: IAddress[];
  emailVerified: boolean;
  phoneVerified: boolean;
  otp?: {
    code: string;
    expiresAt: Date;
  };
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  fcmTokens: string[];
  lastLogin?: Date;
  isAffiliate: boolean;
  affiliateCode?: string;
  referredBy?: Types.ObjectId;
  points?: number;
  badges?: string[];
  achievements?: string[];
  
  // Login streak tracking
  loginStreak?: {
    currentStreak: number;
    lastLoginDate: Date | null;
  };
  
  // OAuth fields
  oauthProvider?: 'google' | 'apple' | 'facebook';
  oauthId?: string;

  // Bank account for withdrawals (customers)
  payoutDetails?: {
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    bankCode?: string;
  };

  // Notification preferences
  notificationPreferences?: {
    pushEnabled: boolean;
    order: { id: string; enabled: boolean }[];
    promo: { id: string; enabled: boolean }[];
    social: { id: string; enabled: boolean }[];
  };

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

  // Methods
  comparePassword(candidatePassword: string): Promise<boolean>;
}