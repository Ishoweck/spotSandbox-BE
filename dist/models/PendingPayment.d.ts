import mongoose, { Document } from 'mongoose';
export interface IPendingPayment extends Document {
    reference: string;
    userId: string;
    type: 'order' | 'wallet_topup';
    amount: number;
    gateway: 'paystack' | 'flutterwave';
    status: 'pending' | 'completed' | 'failed';
    snapshotJson?: string;
    completedAt?: Date;
    createdAt: Date;
    expiresAt: Date;
}
export declare const PendingPayment: mongoose.Model<IPendingPayment, {}, {}, {}, mongoose.Document<unknown, {}, IPendingPayment, {}, {}> & IPendingPayment & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=PendingPayment.d.ts.map