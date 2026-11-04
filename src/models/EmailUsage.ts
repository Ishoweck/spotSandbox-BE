import mongoose, { Schema, Document } from 'mongoose';

export type EmailProvider = 'resend' | 'brevo';

// One row per provider per UTC day. `units` is what the provider bills against its daily
// quota: every To/BCC recipient counts (sendEmail no longer adds BCC copies, so normally 1).
export interface IEmailUsage extends Document {
  day: string; // YYYY-MM-DD (UTC)
  provider: EmailProvider;
  sent: number;
  units: number;
  failed: number;
  exhaustedAt?: Date;
}

const emailUsageSchema = new Schema<IEmailUsage>(
  {
    day: { type: String, required: true },
    provider: { type: String, enum: ['resend', 'brevo'], required: true },
    sent: { type: Number, default: 0 },
    units: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    exhaustedAt: { type: Date },
  },
  { timestamps: true }
);

emailUsageSchema.index({ day: 1, provider: 1 }, { unique: true });

export const EmailUsage = mongoose.model<IEmailUsage>('EmailUsage', emailUsageSchema);
