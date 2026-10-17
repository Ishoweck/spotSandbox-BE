import mongoose, { Schema, Document, Types } from 'mongoose';

// PAYMENT: buyer pays the vendor directly (fixed or open amount). Money skips
//          escrow and lands in the wallet after the hold window, minus a fee.
// PRODUCT: buyer checks out one of the vendor's products through the normal
//          escrow checkout, at the reduced checkout-link commission.
export type PaymentLinkType = 'PAYMENT' | 'PRODUCT';
export type PaymentLinkStatus = 'ACTIVE' | 'INACTIVE' | 'USED';

export interface IPaymentLink extends Document {
  vendor: Types.ObjectId; // User id of the vendor
  code: string;
  type: PaymentLinkType;
  title: string;
  description?: string;
  amount?: number; // PAYMENT only; empty means the buyer types the amount
  product?: Types.ObjectId; // PRODUCT only
  singleUse: boolean; // PAYMENT only; becomes USED after the first payment
  status: PaymentLinkStatus;
  paymentsCount: number;
  totalReceived: number; // gross naira paid through this link
  deactivatedBy?: Types.ObjectId;
  deactivatedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentLinkSchema = new Schema<IPaymentLink>(
  {
    vendor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    code: { type: String, required: true, unique: true, trim: true, lowercase: true },
    type: { type: String, enum: ['PAYMENT', 'PRODUCT'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    amount: { type: Number, min: 0 },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    singleUse: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'USED'], default: 'ACTIVE', index: true },
    paymentsCount: { type: Number, default: 0 },
    totalReceived: { type: Number, default: 0 },
    deactivatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deactivatedReason: String,
  },
  { timestamps: true }
);

paymentLinkSchema.index({ vendor: 1, createdAt: -1 });

const PaymentLink = mongoose.model<IPaymentLink>('PaymentLink', paymentLinkSchema);

export default PaymentLink;
