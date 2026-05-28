import { Schema, model, Document, Types } from 'mongoose';

export interface IPointsTransaction extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: 'earn' | 'spend' | 'expire';
  activity: 'login' | 'purchase' | 'review' | 'share' | 'referral' | 'redemption' | 'bonus' | 'other';
  points: number;
  description: string;
  reference?: string;
  status: 'active' | 'locked' | 'expired';
  expiresAt?: Date;
  lockedForVendor?: Types.ObjectId;
  remindersSent: number[]; // tracks which day-windows (14, 7, 3, 1) have been notified
  metadata?: {
    orderId?: string;
    productId?: string;
    streakDay?: number;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const pointsTransactionSchema = new Schema<IPointsTransaction>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['earn', 'spend', 'expire'],
      required: true,
    },
    activity: {
      type: String,
      enum: ['login', 'purchase', 'review', 'share', 'referral', 'redemption', 'bonus', 'other'],
      required: true,
    },
    points: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    reference: {
      type: String,
      sparse: true,
    },
    status: {
      type: String,
      enum: ['active', 'locked', 'expired'],
      default: 'active',
    },
    expiresAt: {
      type: Date,
    },
    lockedForVendor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    remindersSent: {
      type: [Number],
      default: [],
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

pointsTransactionSchema.index({ user: 1, createdAt: -1 });
pointsTransactionSchema.index({ user: 1, activity: 1 });
pointsTransactionSchema.index({ type: 1, createdAt: -1 });
pointsTransactionSchema.index({ status: 1, expiresAt: 1 });
pointsTransactionSchema.index({ lockedForVendor: 1, status: 1 });

const PointsTransaction = model<IPointsTransaction>('PointsTransaction', pointsTransactionSchema);

export default PointsTransaction;
