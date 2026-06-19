import mongoose, { Document } from 'mongoose';
export interface INotificationTemplate extends Document {
    notificationType: string;
    channel: 'push' | 'inapp';
    locale: string;
    titleTemplate: string;
    bodyTemplate: string;
}
export declare const NotificationTemplate: mongoose.Model<INotificationTemplate, {}, {}, {}, mongoose.Document<unknown, {}, INotificationTemplate, {}, {}> & INotificationTemplate & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=NotificationTemplate.d.ts.map