import mongoose, { Document, Types } from 'mongoose';
import { OrderStatus, PaymentStatus, PaymentMethod, IOrderItem, IShippingDetails, IAddress } from '../types';
export interface IVendorShipment {
    vendor: Types.ObjectId;
    vendorName: string;
    items: Types.ObjectId[];
    origin: {
        street: string;
        city: string;
        state: string;
        country: string;
    };
    shippingCost: number;
    trackingNumber?: string;
    shipmentId?: string;
    courier?: string;
    estimatedDelivery?: Date;
    trackingUrl?: string;
    paidAt?: Date;
    status: 'pending' | 'confirmed' | 'processing' | 'created' | 'shipped' | 'in_transit' | 'delivered' | 'cancelled';
}
export interface IOrder extends Document {
    orderNumber: string;
    user: Types.ObjectId;
    items: IOrderItem[];
    subtotal: number;
    discount: number;
    shippingCost: number;
    tax: number;
    serviceCharge: number;
    total: number;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod;
    paymentReference?: string;
    shippingAddress?: IAddress;
    billingAddress?: IAddress;
    shippingDetails?: IShippingDetails;
    couponCode?: string;
    notes?: string;
    deliveryType?: string;
    isPickup: boolean;
    isDigital?: boolean;
    vendorShipments?: IVendorShipment[];
    trackingNumber?: string;
    shipmentId?: string;
    courier?: string;
    estimatedDelivery?: Date;
    cancelReason?: string;
    refundAmount?: number;
    refundReason?: string;
    deliveredAt?: Date;
    fundsReleased?: boolean;
    affiliateUser?: Types.ObjectId;
    affiliateCommission?: number;
    affiliateLinkId?: Types.ObjectId;
    affiliateCommissionPaid?: boolean;
    statusHistory: {
        status: OrderStatus;
        timestamp: Date;
        note?: string;
    }[];
    createdAt: Date;
    updatedAt: Date;
}
declare const Order: mongoose.Model<IOrder, {}, {}, {}, mongoose.Document<unknown, {}, IOrder, {}, {}> & IOrder & Required<{
    _id: Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default Order;
//# sourceMappingURL=Order.d.ts.map