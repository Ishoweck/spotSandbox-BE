import mongoose, { Schema, Document } from 'mongoose';

export interface IAppSettings extends Document {
  key: string;
  plansEnforced: boolean;
  plansActivatedAt?: Date;
  plansActivatedBy?: mongoose.Types.ObjectId;
  plansDeactivatedAt?: Date;
  plansDeactivatedBy?: mongoose.Types.ObjectId;
  freeProductLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

const AppSettingsSchema = new Schema<IAppSettings>(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    plansEnforced: { type: Boolean, default: false },
    plansActivatedAt: { type: Date },
    plansActivatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    plansDeactivatedAt: { type: Date },
    plansDeactivatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    freeProductLimit: { type: Number, default: 6 },
  },
  { timestamps: true }
);

export default mongoose.model<IAppSettings>('AppSettings', AppSettingsSchema);
