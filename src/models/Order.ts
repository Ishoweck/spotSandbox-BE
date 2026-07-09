// models/Order.ts - UPDATED FOR DIGITAL PRODUCTS
import mongoose, { Schema, Document, Types } from 'mongoose';
import { OrderStatus, PaymentStatus, PaymentMethod, IOrderItem, IShippingDetails, IAddress } from '../types';

// Vendor shipment interface
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
  requestedCourier?: string;
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
  shippingAddress?: IAddress; // ✅ MADE OPTIONAL
  billingAddress?: IAddress;
  shippingDetails?: IShippingDetails;
  couponCode?: string;
  notes?: string;
  adminNote?: string;
  deliveryType?: string;
  isPickup: boolean;
  isDigital?: boolean; // ✅ ADDED
  
  // Multi-vendor shipping
  vendorShipments?: IVendorShipment[];
  
  // Legacy fields (backward compatibility)
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
  cashbackAwarded?: boolean;
  pointsAwarded?: boolean;
  statusHistory: {
    status: OrderStatus;
    timestamp: Date;
    note?: string;
  }[];
  createdAt: Date; // ✅ ADDED (Mongoose adds this automatically with timestamps)
  updatedAt: Date; // ✅ ADDED (Mongoose adds this automatically with timestamps)
}

const orderItemSchema = new Schema<IOrderItem>({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  productName: {
    type: String,
    required: true,
  },
  productImage: {
    type: String,
    required: true,
  },
  productType: String, // ✅ ADDED for digital/physical/service
  variant: String,
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
  },
  vendor: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, { _id: false });

const shippingDetailsSchema = new Schema<IShippingDetails>({
  method: String,
  cost: Number,
  estimatedDelivery: Date,
  trackingNumber: String,
  carrier: String,
}, { _id: false });

const addressSchema = new Schema<IAddress>({
  street: { type: String }, // ✅ REMOVED required: true
  city: { type: String }, // ✅ REMOVED required: true
  state: { type: String }, // ✅ REMOVED required: true
  country: { type: String }, // ✅ REMOVED required: true
  zipCode: String,
  postalCode: String,
  fullName: String,
  phone: String,
  isDefault: Boolean,
  label: String,
}, { _id: false });

const vendorShipmentSchema = new Schema<IVendorShipment>({
  vendor: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  vendorName: {
    type: String,
    required: true,
  },
  items: [{
    type: Schema.Types.ObjectId,
    ref: 'Product',
  }],
  origin: {
    street: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
  },
  shippingCost: {
    type: Number,
    required: true,
    default: 0,
  },
  trackingNumber: String,
  trackingUrl: String,
  shipmentId: String,
  courier: String,
  requestedCourier: String,
  estimatedDelivery: Date,
  paidAt: Date,
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'created', 'shipped', 'in_transit', 'delivered', 'cancelled'],
    default: 'pending',
  },
}, { _id: false });

const orderSchema = new Schema<IOrder>({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  items: [orderItemSchema],
  subtotal: {
    type: Number,
    required: true,
  },
  discount: {
    type: Number,
    default: 0,
  },
  shippingCost: {
    type: Number,
    default: 0,
  },
  tax: {
    type: Number,
    default: 0,
  },
  serviceCharge: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: Object.values(OrderStatus),
    default: OrderStatus.PENDING,
  },
  paymentStatus: {
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING,
  },
  paymentMethod: {
    type: String,
    enum: Object.values(PaymentMethod),
    required: true,
  },
  paymentReference: String,
  shippingAddress: {
    type: addressSchema,
    required: false, // ✅ CHANGED to false (not required for digital products)
  },
  billingAddress: addressSchema,
  shippingDetails: shippingDetailsSchema,
  couponCode: String,
  notes: String,
  adminNote: String,

  deliveryType: {
    type: String,
    default: 'standard',
  },
  isPickup: {
    type: Boolean,
    default: false,
  },
  isDigital: { // ✅ ADDED
    type: Boolean,
    default: false,
  },
  
  // Multi-vendor shipments
  vendorShipments: [vendorShipmentSchema],
  
  // Legacy fields
  trackingNumber: String,
  shipmentId: String,
  courier: String,
  estimatedDelivery: Date,
  
  cancelReason: String,
  refundAmount: Number,
  refundReason: String,
  deliveredAt: Date,
  fundsReleased: { type: Boolean, default: false },
  affiliateUser: { type: Schema.Types.ObjectId, ref: 'User' },
  affiliateCommission: Number,
  affiliateLinkId: { type: Schema.Types.ObjectId, ref: 'AffiliateLink' },
  affiliateCommissionPaid: { type: Boolean, default: false },
  cashbackAwarded: { type: Boolean, default: false },
  pointsAwarded: { type: Boolean, default: false },
  statusHistory: [{
    status: {
      type: String,
      enum: Object.values(OrderStatus),
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    note: String,
  }],
}, {
  timestamps: true, // ✅ This adds createdAt and updatedAt automatically
});

// Add status to history before saving
orderSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date(),
    });
  }
  next();
});

// Indexes
orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ 'items.vendor': 1 });
orderSchema.index({ trackingNumber: 1 });
orderSchema.index({ shipmentId: 1 });
orderSchema.index({ 'vendorShipments.vendor': 1 });
orderSchema.index({ 'vendorShipments.trackingNumber': 1 });
orderSchema.index({ isDigital: 1 }); // ✅ ADDED index

const Order = mongoose.model<IOrder>('Order', orderSchema);

export default Order;