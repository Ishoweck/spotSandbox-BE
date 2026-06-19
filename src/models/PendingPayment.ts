import mongoose, { Document, Schema } from 'mongoose';

export interface IPendingPayment extends Document {
  reference: string;
  userId: string;
  type: 'order' | 'wallet_topup';
  amount: number;
  gateway: 'paystack' | 'flutterwave';
  status: 'pending' | 'completed' | 'failed';
  snapshotJson?: string;
  completedAt?: Date;
  createdAt: Date;
  expiresAt: Date;
}

const pendingPaymentSchema = new Schema<IPendingPayment>(
  {
    reference:    { type: String, required: true, unique: true, index: true },
    userId:       { type: String, required: true, index: true },
    type:         { type: String, enum: ['order', 'wallet_topup'], required: true },
    amount:       { type: Number, required: true },
    gateway:      { type: String, enum: ['paystack', 'flutterwave'], required: true },
    status:       { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending', index: true },
    snapshotJson: { type: String },
    completedAt:  { type: Date },
    // TTL: MongoDB auto-deletes after 48 hours regardless of status
    expiresAt:    { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export const PendingPayment = mongoose.model<IPendingPayment>('PendingPayment', pendingPaymentSchema);
