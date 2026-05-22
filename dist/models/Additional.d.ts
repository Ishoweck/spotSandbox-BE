import mongoose, { Document, Types } from 'mongoose';
import { NotificationType, IChallenge } from '../types';
export interface ICoupon extends Document {
    code: string;
    description?: string;
    discountType: 'percentage' | 'fixed';
    discountValue: number;
    minPurchase?: number;
    maxDiscount?: number;
    usageLimit?: number;
    usageCount: number;
    validFrom: Date;
    validUntil: Date;
    isActive: boolean;
    applicableProducts?: Types.ObjectId[];
    applicableCategories?: Types.ObjectId[];
    excludedProducts?: Types.ObjectId[];
    usedBy: Types.ObjectId[];
}
export interface IAffiliateLink extends Document {
    user: Types.ObjectId;
    product?: Types.ObjectId;
    code: string;
    clicks: number;
    conversions: number;
    totalEarned: number;
    isActive: boolean;
}
export interface INotification extends Document {
    user: Types.ObjectId;
    type: NotificationType;
    title: string;
    message: string;
    data?: any;
    read: boolean;
    link?: string;
}
export interface IChatMessage extends Document {
    conversationId: string;
    sender: Types.ObjectId;
    receiver: Types.ObjectId;
    message: string;
    messageType: 'text' | 'image' | 'file' | 'system';
    fileUrl?: string;
    orderId?: Types.ObjectId;
    replyTo?: {
        messageId: Types.ObjectId;
        message: string;
        senderName: string;
        messageType: string;
    };
    read: boolean;
    readAt?: Date;
    deleted: boolean;
    deletedAt?: Date;
}
export interface IWishlist extends Document {
    user: Types.ObjectId;
    items: Array<{
        product: Types.ObjectId;
        addedAt?: Date;
    }>;
}
export declare const Coupon: mongoose.Model<ICoupon, {}, {}, {}, mongoose.Document<unknown, {}, ICoupon, {}, {}> & ICoupon & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export declare const AffiliateLink: mongoose.Model<IAffiliateLink, {}, {}, {}, mongoose.Document<unknown, {}, IAffiliateLink, {}, {}> & IAffiliateLink & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export declare const Challenge: mongoose.Model<IChallenge, {}, {}, {}, mongoose.Document<unknown, {}, IChallenge, {}, {}> & IChallenge & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export declare const Notification: mongoose.Model<INotification, {}, {}, {}, mongoose.Document<unknown, {}, INotification, {}, {}> & INotification & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export declare const ChatMessage: mongoose.Model<IChatMessage, {}, {}, {}, mongoose.Document<unknown, {}, IChatMessage, {}, {}> & IChatMessage & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export declare const Wishlist: mongoose.Model<IWishlist, {}, {}, {}, mongoose.Document<unknown, {}, IWishlist, {}, {}> & IWishlist & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export declare const Wallet: mongoose.Model<import("./Wallet").IWallet, {}, {}, {}, mongoose.Document<unknown, {}, import("./Wallet").IWallet, {}, {}> & import("./Wallet").IWallet & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=Additional.d.ts.map