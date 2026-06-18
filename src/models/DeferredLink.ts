import mongoose, { Document, Schema } from 'mongoose';

export interface IDeferredLink extends Document {
  affiliateCode: string;
  ipAddress: string;
  platform: string;
  timezone: string;
  language: string;
  used: boolean;
  createdAt: Date;
}

const DeferredLinkSchema = new Schema<IDeferredLink>({
  affiliateCode: { type: String, required: true },
  ipAddress:     { type: String, required: true },
  platform:      { type: String, default: 'unknown' },
  timezone:      { type: String, default: '' },
  language:      { type: String, default: '' },
  used:          { type: Boolean, default: false },
  createdAt:     { type: Date, default: Date.now, expires: 172800 }, // 48 h TTL
});

// Fast lookup on IP + used flag (the hot path for resolve)
DeferredLinkSchema.index({ ipAddress: 1, used: 1 });

export const DeferredLink = mongoose.model<IDeferredLink>('DeferredLink', DeferredLinkSchema);
