import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import Cart from '../models/Cart';
import Product from '../models/Product';
import { Coupon } from '../models/Additional';
import { AppError } from '../middleware/error';
import { calculateDiscount } from '../utils/helpers';

export class CartController {
  /**
   * Get user's cart
   */
  async getCart(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const cart = await Cart.findOne({ user: req.user?.id }).populate({
      path: 'items.product',
      select: 'name slug price images status quantity vendor',
    });

    if (!cart) {
      res.json({
        success: true,
        data: {
          cart: {
            items: [],
            subtotal: 0,
            discount: 0,
            total: 0,
          },
        },
      });
      return;
    }

    // Filter out products that are no longer available (out of stock, vendor suspended, etc.)
    const removedNames: string[] = [];
    const validItems = cart.items.filter((item: any) => {
      const product = item.product;
      const available = product && product.status === 'active' && product.quantity > 0;
      if (!available && product?.name) removedNames.push(product.name);
      return available;
    });

    if (validItems.length !== cart.items.length) {
      cart.items = validItems;
    }

    // Sync stored item prices to current live product prices so the cart total
    // always reflects what the vendor is actually charging. Users see the updated
    // price here — on the cart screen — rather than getting a surprise at payment.
    const priceChanges: Array<{ name: string; oldPrice: number; newPrice: number }> = [];
    for (const item of cart.items as any[]) {
      const livePrice = item.product?.price;
      if (livePrice !== undefined && livePrice !== item.price) {
        priceChanges.push({ name: item.product.name, oldPrice: item.price, newPrice: livePrice });
        item.price = livePrice;
      }
    }

    if (validItems.length !== cart.items.length || priceChanges.length > 0) {
      await cart.save();
    }

    res.json({
      success: true,
      data: {
        cart,
        ...(removedNames.length > 0 && {
          removedItems: removedNames,
          removedItemsMessage: `${removedNames.length} item${removedNames.length > 1 ? 's were' : ' was'} removed from your cart because ${removedNames.length > 1 ? 'they are' : 'it is'} no longer available.`,
        }),
        ...(priceChanges.length > 0 && {
          priceUpdates: priceChanges,
          priceUpdatesMessage: `${priceChanges.length} item price${priceChanges.length > 1 ? 's have' : ' has'} been updated by the vendor. Please review your cart total.`,
        }),
      },
    });
  }

  /**
   * Add item to cart
   */
  async addToCart(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId, variant } = req.body;
    const quantity = parseInt(req.body.quantity, 10);

    if (!quantity || quantity < 1 || quantity > 1000) {
      throw new AppError('Quantity must be between 1 and 1000', 400);
    }

    // Validate product
    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    if (product.status !== 'active') {
      throw new AppError('Product is not available', 400);
    }

    if (product.quantity < quantity) {
      throw new AppError('Insufficient stock', 400);
    }

    // Validate size/color selection for products that have them
    const hasSizes = product.sizes && product.sizes.length > 0;
    const hasColors = product.colors && product.colors.length > 0;

    if (hasSizes || hasColors) {
      if (!variant) {
        const missing = [hasSizes && 'size', hasColors && 'color'].filter(Boolean).join(' and ');
        throw new AppError(`Please select a ${missing} before adding to cart`, 400);
      }

      // Parse variant string format: "Size: M, Color: Red"
      const sizeMatch = variant.match(/Size:\s*([^,]+)/i);
      const colorMatch = variant.match(/Color:\s*([^,]+)/i);

      if (hasSizes) {
        if (!sizeMatch) throw new AppError('Size selection is required', 400);
        const selectedSize = sizeMatch[1].trim();
        if (!product.sizes!.includes(selectedSize)) {
          throw new AppError(`Invalid size "${selectedSize}". Available: ${product.sizes!.join(', ')}`, 400);
        }
      }

      if (hasColors) {
        if (!colorMatch) throw new AppError('Color selection is required', 400);
        const selectedColor = colorMatch[1].trim();
        if (!product.colors!.includes(selectedColor)) {
          throw new AppError(`Invalid color "${selectedColor}". Available: ${product.colors!.join(', ')}`, 400);
        }
      }
    }

    // Get or create cart
    let cart = await Cart.findOne({ user: req.user?.id });
    if (!cart) {
      cart = await Cart.create({
        user: req.user?.id,
        items: [],
      });
    }

    // Check if item already exists
    const existingItemIndex = cart.items.findIndex(
      (item: any) => 
        item.product.toString() === productId && 
        (!variant || item.variant === variant)
    );

    if (existingItemIndex > -1) {
      // Update quantity
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;
      
      if (newQuantity > product.quantity) {
        throw new AppError('Quantity exceeds available stock', 400);
      }

      cart.items[existingItemIndex].quantity = newQuantity;
    } else {
      // Add new item
      cart.items.push({
        product: product._id,
        variant,
        quantity,
        price: product.price,
      });
    }

    await cart.save();
    await cart.populate('items.product', 'name slug price images');

    res.json({
      success: true,
      message: 'Item added to cart',
      data: { cart },
    });
  }

  /**
   * Update cart item quantity
   */
  async updateCartItem(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { itemId } = req.params;
    const { quantity } = req.body;

    const cart = await Cart.findOne({ user: req.user?.id });
    if (!cart) {
      throw new AppError('Cart not found', 404);
    }

    const item = cart.items.find((item: any) => item._id.toString() === itemId);
    if (!item) {
      throw new AppError('Item not found in cart', 404);
    }

    // Validate product availability
    const product = await Product.findById(item.product);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    if (quantity > product.quantity) {
      throw new AppError('Quantity exceeds available stock', 400);
    }

    if (quantity <= 0) {
      // Remove item if quantity is 0 or less
      cart.items = cart.items.filter((i: any) => i._id.toString() !== itemId);
    } else {
      item.quantity = quantity;
    }

    await cart.save();
    await cart.populate('items.product', 'name slug price images');

    res.json({
      success: true,
      message: 'Cart updated',
      data: { cart },
    });
  }

  /**
   * Remove item from cart
   */
  async removeFromCart(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { itemId } = req.params;

    const cart = await Cart.findOne({ user: req.user?.id });
    if (!cart) {
      throw new AppError('Cart not found', 404);
    }

    cart.items = cart.items.filter((item: any) => item._id.toString() !== itemId);
    await cart.save();

    res.json({
      success: true,
      message: 'Item removed from cart',
      data: { cart },
    });
  }

  /**
   * Clear cart
   */
  async clearCart(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const cart = await Cart.findOne({ user: req.user?.id });
    if (!cart) {
      throw new AppError('Cart not found', 404);
    }

    cart.items = [];
    cart.couponCode = undefined;
    cart.discount = 0;
    await cart.save();

    res.json({
      success: true,
      message: 'Cart cleared',
      data: { cart },
    });
  }

  /**
   * Apply coupon to cart
   */
  async applyCoupon(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { code } = req.body;

    const cart = await Cart.findOne({ user: req.user?.id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      throw new AppError('Cart is empty', 400);
    }

    // Find and validate coupon
    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() },
    });

    if (!coupon) {
      throw new AppError('Invalid or expired coupon', 400);
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      throw new AppError('Coupon usage limit reached', 400);
    }

    // Check if user has already used this coupon
    if (coupon.usedBy.includes(req.user?.id as any)) {
      throw new AppError('You have already used this coupon', 400);
    }

    // Check minimum purchase
    if (coupon.minPurchase && cart.subtotal < coupon.minPurchase) {
      throw new AppError(
        `Minimum purchase of ₦${coupon.minPurchase.toLocaleString()} required`,
        400
      );
    }

    // Calculate discount
    const discount = calculateDiscount(
      cart.subtotal,
      coupon.discountType,
      coupon.discountValue,
      coupon.maxDiscount
    );

    cart.couponCode = code.toUpperCase();
    cart.discount = discount;
    await cart.save();

    res.json({
      success: true,
      message: 'Coupon applied successfully',
      data: {
        cart,
        discount,
      },
    });
  }

  /**
   * Remove coupon from cart
   */
  async removeCoupon(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const cart = await Cart.findOne({ user: req.user?.id });
    if (!cart) {
      throw new AppError('Cart not found', 404);
    }

    cart.couponCode = undefined;
    cart.discount = 0;
    await cart.save();

    res.json({
      success: true,
      message: 'Coupon removed',
      data: { cart },
    });
  }

  /**
   * Get cart summary (for checkout)
   */
  async getCartSummary(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const cart = await Cart.findOne({ user: req.user?.id }).populate({
      path: 'items.product',
      populate: {
        path: 'vendor',
        select: 'firstName lastName email',
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new AppError('Cart is empty', 400);
    }

    // Group items by vendor
    const itemsByVendor: any = {};
    cart.items.forEach((item: any) => {
      const vendorId = item.product.vendor._id.toString();
      if (!itemsByVendor[vendorId]) {
        itemsByVendor[vendorId] = {
          vendor: item.product.vendor,
          items: [],
          subtotal: 0,
        };
      }
      itemsByVendor[vendorId].items.push(item);
      itemsByVendor[vendorId].subtotal += item.price * item.quantity;
    });

    res.json({
      success: true,
      data: {
        cart,
        summary: {
          subtotal: cart.subtotal,
          discount: cart.discount,
          total: cart.total,
          itemCount: cart.items.length,
          itemsByVendor: Object.values(itemsByVendor),
        },
      },
    });
  }
}

export const cartController = new CartController();
