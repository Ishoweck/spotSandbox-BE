"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cartController = exports.CartController = void 0;
const Cart_1 = __importDefault(require("../models/Cart"));
const Product_1 = __importDefault(require("../models/Product"));
const Additional_1 = require("../models/Additional");
const error_1 = require("../middleware/error");
const helpers_1 = require("../utils/helpers");
class CartController {
    /**
     * Get user's cart
     */
    async getCart(req, res) {
        const cart = await Cart_1.default.findOne({ user: req.user?.id }).populate({
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
        // Filter out products that are no longer available
        const validItems = cart.items.filter((item) => {
            const product = item.product;
            return product && product.status === 'active' && product.quantity > 0;
        });
        if (validItems.length !== cart.items.length) {
            cart.items = validItems;
            await cart.save();
        }
        res.json({
            success: true,
            data: { cart },
        });
    }
    /**
     * Add item to cart
     */
    async addToCart(req, res) {
        const { productId, variant } = req.body;
        const quantity = parseInt(req.body.quantity, 10);
        if (!quantity || quantity < 1 || quantity > 1000) {
            throw new error_1.AppError('Quantity must be between 1 and 1000', 400);
        }
        // Validate product
        const product = await Product_1.default.findById(productId);
        if (!product) {
            throw new error_1.AppError('Product not found', 404);
        }
        if (product.status !== 'active') {
            throw new error_1.AppError('Product is not available', 400);
        }
        if (product.quantity < quantity) {
            throw new error_1.AppError('Insufficient stock', 400);
        }
        // Validate size/color selection for products that have them
        const hasSizes = product.sizes && product.sizes.length > 0;
        const hasColors = product.colors && product.colors.length > 0;
        if (hasSizes || hasColors) {
            if (!variant) {
                const missing = [hasSizes && 'size', hasColors && 'color'].filter(Boolean).join(' and ');
                throw new error_1.AppError(`Please select a ${missing} before adding to cart`, 400);
            }
            // Parse variant string format: "Size: M, Color: Red"
            const sizeMatch = variant.match(/Size:\s*([^,]+)/i);
            const colorMatch = variant.match(/Color:\s*([^,]+)/i);
            if (hasSizes) {
                if (!sizeMatch)
                    throw new error_1.AppError('Size selection is required', 400);
                const selectedSize = sizeMatch[1].trim();
                if (!product.sizes.includes(selectedSize)) {
                    throw new error_1.AppError(`Invalid size "${selectedSize}". Available: ${product.sizes.join(', ')}`, 400);
                }
            }
            if (hasColors) {
                if (!colorMatch)
                    throw new error_1.AppError('Color selection is required', 400);
                const selectedColor = colorMatch[1].trim();
                if (!product.colors.includes(selectedColor)) {
                    throw new error_1.AppError(`Invalid color "${selectedColor}". Available: ${product.colors.join(', ')}`, 400);
                }
            }
        }
        // Get or create cart
        let cart = await Cart_1.default.findOne({ user: req.user?.id });
        if (!cart) {
            cart = await Cart_1.default.create({
                user: req.user?.id,
                items: [],
            });
        }
        // Check if item already exists
        const existingItemIndex = cart.items.findIndex((item) => item.product.toString() === productId &&
            (!variant || item.variant === variant));
        if (existingItemIndex > -1) {
            // Update quantity
            const newQuantity = cart.items[existingItemIndex].quantity + quantity;
            if (newQuantity > product.quantity) {
                throw new error_1.AppError('Quantity exceeds available stock', 400);
            }
            cart.items[existingItemIndex].quantity = newQuantity;
        }
        else {
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
    async updateCartItem(req, res) {
        const { itemId } = req.params;
        const { quantity } = req.body;
        const cart = await Cart_1.default.findOne({ user: req.user?.id });
        if (!cart) {
            throw new error_1.AppError('Cart not found', 404);
        }
        const item = cart.items.find((item) => item._id.toString() === itemId);
        if (!item) {
            throw new error_1.AppError('Item not found in cart', 404);
        }
        // Validate product availability
        const product = await Product_1.default.findById(item.product);
        if (!product) {
            throw new error_1.AppError('Product not found', 404);
        }
        if (quantity > product.quantity) {
            throw new error_1.AppError('Quantity exceeds available stock', 400);
        }
        if (quantity <= 0) {
            // Remove item if quantity is 0 or less
            cart.items = cart.items.filter((i) => i._id.toString() !== itemId);
        }
        else {
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
    async removeFromCart(req, res) {
        const { itemId } = req.params;
        const cart = await Cart_1.default.findOne({ user: req.user?.id });
        if (!cart) {
            throw new error_1.AppError('Cart not found', 404);
        }
        cart.items = cart.items.filter((item) => item._id.toString() !== itemId);
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
    async clearCart(req, res) {
        const cart = await Cart_1.default.findOne({ user: req.user?.id });
        if (!cart) {
            throw new error_1.AppError('Cart not found', 404);
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
    async applyCoupon(req, res) {
        const { code } = req.body;
        const cart = await Cart_1.default.findOne({ user: req.user?.id }).populate('items.product');
        if (!cart || cart.items.length === 0) {
            throw new error_1.AppError('Cart is empty', 400);
        }
        // Find and validate coupon
        const coupon = await Additional_1.Coupon.findOne({
            code: code.toUpperCase(),
            isActive: true,
            validFrom: { $lte: new Date() },
            validUntil: { $gte: new Date() },
        });
        if (!coupon) {
            throw new error_1.AppError('Invalid or expired coupon', 400);
        }
        // Check usage limit
        if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
            throw new error_1.AppError('Coupon usage limit reached', 400);
        }
        // Check if user has already used this coupon
        if (coupon.usedBy.includes(req.user?.id)) {
            throw new error_1.AppError('You have already used this coupon', 400);
        }
        // Check minimum purchase
        if (coupon.minPurchase && cart.subtotal < coupon.minPurchase) {
            throw new error_1.AppError(`Minimum purchase of ₦${coupon.minPurchase.toLocaleString()} required`, 400);
        }
        // Calculate discount
        const discount = (0, helpers_1.calculateDiscount)(cart.subtotal, coupon.discountType, coupon.discountValue, coupon.maxDiscount);
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
    async removeCoupon(req, res) {
        const cart = await Cart_1.default.findOne({ user: req.user?.id });
        if (!cart) {
            throw new error_1.AppError('Cart not found', 404);
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
    async getCartSummary(req, res) {
        const cart = await Cart_1.default.findOne({ user: req.user?.id }).populate({
            path: 'items.product',
            populate: {
                path: 'vendor',
                select: 'firstName lastName email',
            },
        });
        if (!cart || cart.items.length === 0) {
            throw new error_1.AppError('Cart is empty', 400);
        }
        // Group items by vendor
        const itemsByVendor = {};
        cart.items.forEach((item) => {
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
exports.CartController = CartController;
exports.cartController = new CartController();
//# sourceMappingURL=cart.controller.js.map