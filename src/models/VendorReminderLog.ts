import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IVendorReminderLog extends Document {
  vendor: Types.ObjectId;
  type: string;
  sentAt: Date;
}

const vendorReminderLogSchema = new Schema<IVendorReminderLog>({
  vendor: {
    type: Schema.Types.ObjectId,
    ref: 'VendorProfile',
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
});

vendorReminderLogSchema.index({ vendor: 1, type: 1 }, { unique: true });
vendorReminderLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const VendorReminderLog = mongoose.model<IVendorReminderLog>('VendorReminderLog', vendorReminderLogSchema);

export default VendorReminderLog;
