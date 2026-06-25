import mongoose, { Schema, Document } from 'mongoose';

export type SubscriptionPlan = 'free' | 'growth' | 'pro';
export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'past_due';

export interface IVendorSubscription extends Document {
  vendor: mongoose.Types.ObjectId;   // ref VendorProfile
  user: mongoose.Types.ObjectId;     // ref User (for quick product lookups — Product.vendor = User._id)
  plan: SubscriptionPlan;
  billingCycle: BillingCycle | null;
  status: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  paystackSubscriptionCode?: string;
  paystackCustomerCode?: string;
  paystackPlanCode?: string;
  amount: number;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: Date;
  assignedByAdmin: boolean;
  assignedBy?: mongoose.Types.ObjectId;
  history: Array<{
    plan: SubscriptionPlan;
    billingCycle: BillingCycle | null;
    startDate: Date;
    endDate?: Date;
    amount: number;
    reason?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const VendorSubscriptionSchema = new Schema<IVendorSubscription>(
  {
    vendor:   { type: Schema.Types.ObjectId, ref: 'VendorProfile', required: true, unique: true },
    user:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    plan:     { type: String, enum: ['free', 'growth', 'pro'], default: 'free' },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], default: null },
    status:   { type: String, enum: ['active', 'cancelled', 'expired', 'past_due'], default: 'active' },
    currentPeriodStart: { type: Date },
    currentPeriodEnd:   { type: Date },
    paystackSubscriptionCode: { type: String },
    paystackCustomerCode:     { type: String },
    paystackPlanCode:         { type: String },
    amount:            { type: Number, default: 0 },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt:       { type: Date },
    assignedByAdmin:   { type: Boolean, default: false },
    assignedBy:        { type: Schema.Types.ObjectId, ref: 'User' },
    history: [
      {
        plan:         { type: String, enum: ['free', 'growth', 'pro'] },
        billingCycle: { type: String, enum: ['monthly', 'yearly', null] },
        startDate:    { type: Date },
        endDate:      { type: Date },
        amount:       { type: Number, default: 0 },
        reason:       { type: String },
      },
    ],
  },
  { timestamps: true }
);

VendorSubscriptionSchema.index({ vendor: 1 }, { unique: true });
VendorSubscriptionSchema.index({ user: 1 });
VendorSubscriptionSchema.index({ plan: 1, status: 1 });
VendorSubscriptionSchema.index({ paystackSubscriptionCode: 1 }, { sparse: true });

export default mongoose.model<IVendorSubscription>('VendorSubscription', VendorSubscriptionSchema);
