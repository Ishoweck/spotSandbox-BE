import mongoose, { Document, Types } from 'mongoose';
import { ProductType, ProductStatus, IProductVariant } from '../types';
export interface IProduct extends Document {
    name: string;
    slug: string;
    description: string;
    shortDescription?: string;
    vendor: Types.ObjectId;
    category: Types.ObjectId;
    subcategory?: Types.ObjectId;
    productType: ProductType;
    price: number;
    compareAtPrice?: number;
    costPrice?: number;
    sku: string;
    quantity: number;
    lowStockThreshold: number;
    images: string[];
    videos?: string[];
    variants: IProductVariant[];
    tags: string[];
    status: ProductStatus;
    isFlashSale: boolean;
    flashSaleEndsAt?: Date;
    isFeatured: boolean;
    isAffiliate: boolean;
    affiliateCommission: number;
    weight?: number;
    dimensions?: {
        length: number;
        width: number;
        height: number;
    };
    pickupAddress?: {
        street: string;
        city: string;
        state: string;
        country: string;
        fullName?: string;
        phone?: string;
        shipBubble?: {
            addressCode?: number;
            formattedAddress?: string;
            latitude?: number;
            longitude?: number;
        };
    };
    digitalFile?: {
        url: string;
        fileName: string;
        fileSize: number;
        fileType: string;
        version: string;
        uploadedAt: Date;
        isExternalLink?: boolean;
    };
    requiresLicense?: boolean;
    licenseType?: 'lifetime' | 'subscription' | 'trial';
    licenses?: Array<{
        key: string;
        userId: Types.ObjectId;
        orderId: Types.ObjectId;
        activatedAt?: Date;
        expiresAt?: Date;
        isActive: boolean;
        deviceInfo?: any;
    }>;
    colors?: string[];
    sizes?: string[];
    keyFeatures?: string[];
    specifications?: {
        [key: string]: string;
    };
    averageRating: number;
    totalReviews: number;
    totalSales: number;
    views: number;
    metaTitle?: string;
    metaDescription?: string;
    seo: {
        keywords?: string[];
    };
}
declare const Product: mongoose.Model<IProduct, {}, {}, {}, mongoose.Document<unknown, {}, IProduct, {}, {}> & IProduct & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default Product;
//# sourceMappingURL=Product.d.ts.map