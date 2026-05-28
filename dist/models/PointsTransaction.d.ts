import { Document, Types } from 'mongoose';
export interface IPointsTransaction extends Document {
    _id: Types.ObjectId;
    user: Types.ObjectId;
    type: 'earn' | 'spend' | 'expire';
    activity: 'login' | 'purchase' | 'review' | 'share' | 'referral' | 'redemption' | 'bonus' | 'other';
    points: number;
    description: string;
    reference?: string;
    status: 'active' | 'locked' | 'expired';
    expiresAt?: Date;
    lockedForVendor?: Types.ObjectId;
    remindersSent: number[];
    metadata?: {
        orderId?: string;
        productId?: string;
        streakDay?: number;
        [key: string]: any;
    };
    createdAt: Date;
    updatedAt: Date;
}
declare const PointsTransaction: import("mongoose").Model<IPointsTransaction, {}, {}, {}, Document<unknown, {}, IPointsTransaction, {}, {}> & IPointsTransaction & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default PointsTransaction;
//# sourceMappingURL=PointsTransaction.d.ts.map