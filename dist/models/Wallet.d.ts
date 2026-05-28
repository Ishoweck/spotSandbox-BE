import mongoose, { Document, Types } from 'mongoose';
import { TransactionType, WalletPurpose } from '../types';
export interface IWalletTransaction {
    type: TransactionType;
    amount: number;
    purpose: WalletPurpose;
    reference: string;
    description?: string;
    relatedOrder?: Types.ObjectId;
    status: 'pending' | 'completed' | 'failed';
    timestamp: Date;
}
export interface IWallet extends Document {
    user: Types.ObjectId;
    balance: number;
    vCredits: number;
    vCreditsExpiresAt?: Date;
    vCreditsRemindersSent: number[];
    totalEarned: number;
    totalSpent: number;
    totalWithdrawn: number;
    pendingBalance: number;
    transactions: IWalletTransaction[];
}
declare const Wallet: mongoose.Model<IWallet, {}, {}, {}, mongoose.Document<unknown, {}, IWallet, {}, {}> & IWallet & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default Wallet;
//# sourceMappingURL=Wallet.d.ts.map