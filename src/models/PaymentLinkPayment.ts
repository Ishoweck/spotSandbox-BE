import mongoose, { Schema, Document, Types } from 'mongoose';

// HELD:     paid, sitting out the hold window (not withdrawable yet)
// RELEASED: credited to the vendor's wallet balance
// REVERSED: pulled back by an admin (fraud / chargeback) before or after release
export type PaymentLinkPaymentStatus = 'HELD' | 'RELEASED' | 'REVERSED';

export interface IPaymentLinkPayment extends Document {
  link: Types.ObjectId;
  vendor: Types.ObjectId;
  payer: Types.ObjectId; // quietly-created or existing User
  payerName: string;
  payerEmail: string;
  payerPhone?: string;
  note?: string;
  amount: number; // naira the vendor asked for (our fee is taken from this)
  chargedAmount?: number; // what the customer was actually charged, incl. Paystack's passed-on fee
  fee: number;
  netAmount: number;
  reference: string;
  status: PaymentLinkPaymentStatus;
  paidAt: Date;
  releaseAt: Date;
  releasedAt?: Date;
  reversedAt?: Date;
  reversedBy?: Types.ObjectId;
  reversalReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentLinkPaymentSchema = new Schema<IPaymentLinkPayment>(
  {
    link: { type: Schema.Types.ObjectId, ref: 'PaymentLink', required: true, index: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    payer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    payerName: { type: String, required: true, trim: true },
    payerEmail: { type: String, required: true, trim: true, lowercase: true },
    payerPhone: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 300 },
    amount: { type: Number, required: true },
    chargedAmount: Number,
    fee: { type: Number, required: true },
    netAmount: { type: Number, required: true },
    // Unique: the webhook and the buyer's verify call can both try to record
    // the same payment; the second insert fails and is treated as a no-op.
    reference: { type: String, required: true, unique: true },
    status: { type: String, enum: ['HELD', 'RELEASED', 'REVERSED'], default: 'HELD', index: true },
    paidAt: { type: Date, required: true },
    releaseAt: { type: Date, required: true, index: true },
    releasedAt: Date,
    reversedAt: Date,
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reversalReason: String,
  },
  { timestamps: true }
);

paymentLinkPaymentSchema.index({ vendor: 1, paidAt: -1 });

const PaymentLinkPayment = mongoose.model<IPaymentLinkPayment>('PaymentLinkPayment', paymentLinkPaymentSchema);

export default PaymentLinkPayment;
