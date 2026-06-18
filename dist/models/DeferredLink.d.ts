import mongoose, { Document } from 'mongoose';
export interface IDeferredLink extends Document {
    affiliateCode: string;
    ipAddress: string;
    platform: string;
    timezone: string;
    language: string;
    used: boolean;
    createdAt: Date;
}
export declare const DeferredLink: mongoose.Model<IDeferredLink, {}, {}, {}, mongoose.Document<unknown, {}, IDeferredLink, {}, {}> & IDeferredLink & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=DeferredLink.d.ts.map