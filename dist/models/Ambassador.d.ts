import mongoose, { Document, Types } from 'mongoose';
export type AmbassadorStatus = 'pending' | 'approved' | 'rejected';
export type AmbassadorRole = 'student' | 'state';
export interface IAmbassador extends Document {
    name: string;
    email: string;
    phone?: string;
    role: AmbassadorRole;
    location: string;
    social?: string;
    why: string;
    status: AmbassadorStatus;
    inviteToken?: string;
    inviteTokenExpires?: Date;
    ambassadorCode?: string;
    adminNotes: Array<{
        text: string;
        createdBy: Types.ObjectId;
        createdByName: string;
        createdAt: Date;
    }>;
    approvedBy?: Types.ObjectId;
    approvedAt?: Date;
    rejectedAt?: Date;
    rejectionReason?: string;
    userId?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}
declare const Ambassador: mongoose.Model<IAmbassador, {}, {}, {}, mongoose.Document<unknown, {}, IAmbassador, {}, {}> & IAmbassador & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default Ambassador;
//# sourceMappingURL=Ambassador.d.ts.map