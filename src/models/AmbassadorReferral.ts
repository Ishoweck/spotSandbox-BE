import mongoose, { Schema, Document, Types } from 'mongoose';

export type ReferredUserType = 'vendor' | 'customer';

export interface ICustomerOrderRecord {
  orderId: Types.ObjectId;
  orderAmount: number;
  commissionAmount: number;
  paidAt: Date;
}

export interface IAmbassadorReferral extends Document {
  ambassadorId: Types.ObjectId;
  referredUserId: Types.ObjectId;
  referredUserType: ReferredUserType;

  // Vendor-specific
  ordinalPosition?: number;
  tierRate?: number;
  partialCount: number;
  stage40Reached: boolean;
  stage60Reached: boolean;
  commission40Amount: number;
  commission60Amount: number;
  commission40PaidAt?: Date;
  commission60PaidAt?: Date;

  // Customer-specific
  customerOrdersTracked: ICustomerOrderRecord[];

  totalEarned: number;
  createdAt: Date;
  updatedAt: Date;
}

const customerOrderRecordSchema = new Schema<ICustomerOrderRecord>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderAmount: { type: Number, required: true },
    commissionAmount: { type: Number, required: true },
    paidAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ambassadorReferralSchema = new Schema<IAmbassadorReferral>(
  {
    ambassadorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referredUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    referredUserType: { type: String, enum: ['vendor', 'customer'], required: true },

    // Vendor fields
    ordinalPosition: Number,
    tierRate: Number,
    partialCount: { type: Number, default: 0 },
    stage40Reached: { type: Boolean, default: false },
    stage60Reached: { type: Boolean, default: false },
    commission40Amount: { type: Number, default: 0 },
    commission60Amount: { type: Number, default: 0 },
    commission40PaidAt: Date,
    commission60PaidAt: Date,

    // Customer fields
    customerOrdersTracked: { type: [customerOrderRecordSchema], default: [] },

    totalEarned: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ambassadorReferralSchema.index({ ambassadorId: 1, referredUserType: 1 });
ambassadorReferralSchema.index({ ambassadorId: 1, referredUserId: 1 }, { unique: true });
ambassadorReferralSchema.index({ referredUserId: 1 });

const AmbassadorReferral = mongoose.model<IAmbassadorReferral>('AmbassadorReferral', ambassadorReferralSchema);
export default AmbassadorReferral;
