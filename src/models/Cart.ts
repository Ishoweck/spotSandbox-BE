// In your Cart model
import mongoose, { Schema, Document } from 'mongoose';

interface ICartItem {
  product: mongoose.Types.ObjectId;
  quantity: number;
  price: number;
  variant?: string;
}

interface ICart extends Document {
  user: mongoose.Types.ObjectId;
  items: ICartItem[];
  couponCode?: string;
  discount: number;
  subtotal: number;
  total: number;
}

const cartItemSchema = new Schema({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
  },
  variant: String,
}, { _id: true }); // Make sure this is true to generate _id for subdocuments

const cartSchema = new Schema<ICart>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  items: [cartItemSchema],
  couponCode: String,
  discount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Calculate subtotal
cartSchema.virtual('subtotal').get(function() {
  return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
});

// Calculate total
cartSchema.virtual('total').get(function() {
  return Math.max(0, this.subtotal - this.discount);
});

const Cart = mongoose.model<ICart>('Cart', cartSchema);

export default Cart;