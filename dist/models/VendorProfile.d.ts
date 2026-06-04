import mongoose, { Schema, Document, Types } from 'mongoose';
import { VendorVerificationStatus, IKYCDocument, IPayoutDetails } from '../types';
export interface IVendorProfile extends Document {
    user: Types.ObjectId;
    businessName: string;
    businessDescription?: string;
    businessLogo?: string;
    businessBanner?: string;
    businessAddress: {
        street: string;
        city: string;
        state: string;
        country: string;
        shipBubble?: {
            addressCode: number;
            formattedAddress: string;
            latitude?: number;
            longitude?: number;
            validatedAt: Date;
        };
    };
    businessPhone: string;
    businessEmail: string;
    businessWebsite?: string;
    kycDocuments: IKYCDocument[];
    verificationStatus: VendorVerificationStatus;
    verifiedAt?: Date;
    payoutDetails?: IPayoutDetails;
    followers: Schema.Types.ObjectId[];
    commissionRate: number;
    totalSales: number;
    totalOrders: number;
    averageRating: number;
    totalReviews: number;
    isPremium: boolean;
    isActive: boolean;
    storefront: {
        theme?: string;
        bannerImages?: string[];
        customMessage?: string;
    };
    socialMedia?: {
        facebook?: string;
        instagram?: string;
        twitter?: string;
        tiktok?: string;
    };
    referredBy?: Types.ObjectId;
    referralRewarded: boolean;
    responseRate: number;
    responseSpeed: number;
    statsComputedAt?: Date;
    rejectionReason?: string;
    statusHistory: {
        action: string;
        changedBy?: Types.ObjectId | string;
        reason?: string;
        at: Date;
    }[];
}
declare const VendorProfile: mongoose.Model<IVendorProfile, {}, {}, {}, mongoose.Document<unknown, {}, IVendorProfile, {}, {}> & IVendorProfile & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default VendorProfile;
//# sourceMappingURL=VendorProfile.d.ts.map