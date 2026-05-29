// ============================================================
// ACCOUNT DELETION REQUEST MODEL
// File: models/AccountDeletionRequest.ts
// ============================================================

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAccountDeletionRequest extends Document {
  user: Types.ObjectId;
  userEmail?: string;
  userFullName?: string;
  reason: string; // free-form or one of the predefined user-facing values
  additionalDetails?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  userRole: 'customer' | 'vendor';
  hasPendingOrders?: boolean;
  pendingOrdersCount?: number;
  processedBy?: Types.ObjectId;
  processedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const accountDeletionRequestSchema = new Schema<IAccountDeletionRequest>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userEmail: { type: String },
    userFullName: { type: String },
    reason: {
      type: String,
      required: true,
    },
    additionalDetails: {
      type: String,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    userRole: {
      type: String,
      enum: ['customer', 'vendor'],
      required: true,
    },
    hasPendingOrders: {
      type: Boolean,
      default: false,
    },
    pendingOrdersCount: {
      type: Number,
      default: 0,
    },
    processedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    processedAt: Date,
    rejectionReason: String,
  },
  {
    timestamps: true,
  }
);

// Indexes
accountDeletionRequestSchema.index({ user: 1, status: 1 });
accountDeletionRequestSchema.index({ createdAt: -1 });
accountDeletionRequestSchema.index({ status: 1, createdAt: -1 });

const AccountDeletionRequest = mongoose.model<IAccountDeletionRequest>(
  'AccountDeletionRequest',
  accountDeletionRequestSchema
);

export default AccountDeletionRequest;