import mongoose, { Schema, Document, Types } from 'mongoose';
import { TransactionType, WalletPurpose } from '../types';

export interface IWalletTransaction {
  type: TransactionType;
  amount: number;
  purpose: WalletPurpose;
  reference: string;
  description?: string;
  relatedOrder?: Types.ObjectId;
  status: 'pending' | 'completed' | 'failed';
  timestamp: Date;
}

export interface IWallet extends Document {
  user: Types.ObjectId;
  balance: number;
  vCredits: number;
  vCreditsExpiresAt?: Date;
  vCreditsRemindersSent: number[];
  totalEarned: number;
  totalSpent: number;
  totalWithdrawn: number;
  pendingBalance: number;
  transactions: IWalletTransaction[];
}

const walletTransactionSchema = new Schema<IWalletTransaction>({
  type: {
    type: String,
    enum: Object.values(TransactionType),
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  purpose: {
    type: String,
    enum: Object.values(WalletPurpose),
    required: true,
  },
  reference: {
    type: String,
    required: true,
    // REMOVED: unique: true - This was causing the error
    // Uniqueness will be enforced by the sparse index below
  },
  description: String,
  relatedOrder: {
    type: Schema.Types.ObjectId,
    ref: 'Order',
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed',
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

const walletSchema = new Schema<IWallet>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  vCredits: {
    type: Number,
    default: 0,
    min: 0,
  },
  vCreditsExpiresAt: {
    type: Date,
  },
  vCreditsRemindersSent: {
    type: [Number],
    default: [],
  },
  totalEarned: {
    type: Number,
    default: 0,
  },
  totalSpent: {
    type: Number,
    default: 0,
  },
  totalWithdrawn: {
    type: Number,
    default: 0,
  },
  pendingBalance: {
    type: Number,
    default: 0,
  },
  transactions: [walletTransactionSchema],
}, {
  timestamps: true,
});

// Indexes
walletSchema.index({ user: 1 });
// FIXED: Added sparse: true to allow empty transaction arrays
// This ensures uniqueness only for actual transaction references
walletSchema.index({ 'transactions.reference': 1 }, { unique: true, sparse: true });

const Wallet = mongoose.model<IWallet>('Wallet', walletSchema);

export default Wallet;