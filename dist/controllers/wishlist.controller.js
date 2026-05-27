"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.wishlistController = exports.WishlistController = void 0;
const Additional_1 = require("../models/Additional");
const Product_1 = __importDefault(require("../models/Product"));
const error_1 = require("../middleware/error");
const reward_controller_1 = require("./reward.controller");
class WishlistController {
    /**
     * Get user's wishlist
     */
    async getWishlist(req, res) {
        let wishlist = await Additional_1.Wishlist.findOne({ user: req.user?.id }).populate('items.product', 'name slug price compareAtPrice images averageRating status quantity');
        if (!wishlist) {
            wishlist = await Additional_1.Wishlist.create({ user: req.user?.id, items: [] });
        }
        // Filter out products that are no longer available
        const availableItems = wishlist.items.filter((item) => {
            return item.product && item.product.status === 'active';
        });
        res.json({
            success: true,
            data: {
                wishlist: {
                    items: availableItems,
                    count: availableItems.length,
                },
            },
        });
    }
    /**
     * Add to wishlist
     */
    async addToWishlist(req, res) {
        const { productId } = req.body;
        // Verify product exists
        const product = await Product_1.default.findById(productId);
        if (!product) {
            throw new error_1.AppError('Product not found', 404);
        }
        let wishlist = await Additional_1.Wishlist.findOne({ user: req.user?.id });
        if (!wishlist) {
            wishlist = await Additional_1.Wishlist.create({
                user: req.user?.id,
                items: [{ product: productId }],
            });
        }
        else {
            // Check if already in wishlist
            const exists = wishlist.items.some((item) => item.product.toString() === productId);
            if (exists) {
                throw new error_1.AppError('Product already in wishlist', 400);
            }
            wishlist.items.push({ product: productId });
            await wishlist.save();
        }
        // Check wishlist-collector badge in background
        reward_controller_1.rewardController.checkBadges(req.user.id).catch(() => { });
        res.json({
            success: true,
            message: 'Product added to wishlist',
            data: { wishlist },
        });
    }
    /**
     * Remove from wishlist
     */
    async removeFromWishlist(req, res) {
        const { productId } = req.params;
        const wishlist = await Additional_1.Wishlist.findOne({ user: req.user?.id });
        if (!wishlist) {
            throw new error_1.AppError('Wishlist not found', 404);
        }
        wishlist.items = wishlist.items.filter((item) => item.product.toString() !== productId);
        await wishlist.save();
        res.json({
            success: true,
            message: 'Product removed from wishlist',
        });
    }
    /**
     * Clear wishlist
     */
    async clearWishlist(req, res) {
        const wishlist = await Additional_1.Wishlist.findOne({ user: req.user?.id });
        if (!wishlist) {
            throw new error_1.AppError('Wishlist not found', 404);
        }
        wishlist.items = [];
        await wishlist.save();
        res.json({
            success: true,
            message: 'Wishlist cleared',
        });
    }
    /**
     * Check if product is in wishlist
     */
    async isInWishlist(req, res) {
        const { productId } = req.params;
        const wishlist = await Additional_1.Wishlist.findOne({ user: req.user?.id });
        const inWishlist = wishlist
            ? wishlist.items.some((item) => item.product.toString() === productId)
            : false;
        res.json({
            success: true,
            data: { inWishlist },
        });
    }
    /**
     * Move wishlist item to cart
     */
    async moveToCart(req, res) {
        const { productId } = req.body;
        // This would integrate with cart controller
        // For now, just remove from wishlist
        await this.removeFromWishlist(req, res);
    }
}
exports.WishlistController = WishlistController;
exports.wishlistController = new WishlistController();
//# sourceMappingURL=wishlist.controller.js.map