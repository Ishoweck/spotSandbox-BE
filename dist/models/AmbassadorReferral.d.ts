import mongoose, { Document, Types } from 'mongoose';
export type ReferredUserType = 'vendor' | 'customer';
export interface ICustomerOrderRecord {
    orderId: Types.ObjectId;
    orderAmount: number;
    commissionAmount: number;
    paidAt: Date;
}
export interface IAmbassadorReferral extends Document {
    ambassadorId: Types.ObjectId;
    referredUserId: Types.ObjectId;
    referredUserType: ReferredUserType;
    ordinalPosition?: number;
    tierRate?: number;
    partialCount: number;
    stage40Reached: boolean;
    stage60Reached: boolean;
    commission40Amount: number;
    commission60Amount: number;
    commission40PaidAt?: Date;
    commission60PaidAt?: Date;
    customerOrdersTracked: ICustomerOrderRecord[];
    totalEarned: number;
    createdAt: Date;
    updatedAt: Date;
}
declare const AmbassadorReferral: mongoose.Model<IAmbassadorReferral, {}, {}, {}, mongoose.Document<unknown, {}, IAmbassadorReferral, {}, {}> & IAmbassadorReferral & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default AmbassadorReferral;
//# sourceMappingURL=AmbassadorReferral.d.ts.map