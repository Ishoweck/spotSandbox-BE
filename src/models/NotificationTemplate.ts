import mongoose, { Schema, Document } from 'mongoose';
import { NotificationType } from '../types';

export interface INotificationTemplate extends Document {
  notificationType: string;
  channel: 'push' | 'inapp';
  locale: string;
  titleTemplate: string;
  bodyTemplate: string;
}

const notificationTemplateSchema = new Schema<INotificationTemplate>(
  {
    notificationType: { type: String, required: true },
    channel: { type: String, enum: ['push', 'inapp'], required: true },
    locale: { type: String, default: 'en' },
    titleTemplate: { type: String, required: true },
    bodyTemplate: { type: String, required: true },
  },
  { timestamps: true },
);

notificationTemplateSchema.index(
  { notificationType: 1, channel: 1, locale: 1 },
  { unique: true },
);

export const NotificationTemplate = mongoose.model<INotificationTemplate>(
  'NotificationTemplate',
  notificationTemplateSchema,
);
