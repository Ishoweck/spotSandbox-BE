import mongoose, { Schema, Document, Types } from 'mongoose';

export type AmbassadorStatus = 'pending' | 'approved' | 'rejected';
export type AmbassadorRole = 'student' | 'state';

export interface IAmbassador extends Document {
  name: string;
  email: string;
  phone?: string;
  role: AmbassadorRole;
  location: string;
  social?: string;
  why: string;
  status: AmbassadorStatus;
  inviteToken?: string;
  inviteTokenExpires?: Date;
  ambassadorCode?: string;
  adminNotes: Array<{
    text: string;
    createdBy: Types.ObjectId;
    createdByName: string;
    createdAt: Date;
  }>;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  userId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ambassadorSchema = new Schema<IAmbassador>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    role: { type: String, enum: ['student', 'state'], required: true },
    location: { type: String, required: true, trim: true },
    social: { type: String, trim: true },
    why: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    inviteToken: { type: String, select: false },
    inviteTokenExpires: { type: Date },
    ambassadorCode: { type: String, unique: true, sparse: true, uppercase: true },
    adminNotes: [
      {
        text: { type: String, required: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        createdByName: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedAt: Date,
    rejectionReason: String,
    userId: { type: Schema.Types.ObjectId, ref: 'User', sparse: true },
  },
  { timestamps: true }
);

ambassadorSchema.index({ email: 1 });
ambassadorSchema.index({ status: 1 });
ambassadorSchema.index({ ambassadorCode: 1 });
ambassadorSchema.index({ inviteToken: 1 });
ambassadorSchema.index({ userId: 1 });

const Ambassador = mongoose.model<IAmbassador>('Ambassador', ambassadorSchema);
export default Ambassador;
