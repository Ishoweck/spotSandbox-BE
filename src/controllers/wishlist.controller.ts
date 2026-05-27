import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import { Wishlist } from '../models/Additional';
import Product from '../models/Product';
import { AppError } from '../middleware/error';
import { rewardController } from './reward.controller';

export class WishlistController {
  /**
   * Get user's wishlist
   */
  async getWishlist(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    let wishlist = await Wishlist.findOne({ user: req.user?.id }).populate(
      'items.product',
      'name slug price compareAtPrice images averageRating status quantity'
    );

    if (!wishlist) {
      wishlist = await Wishlist.create({ user: req.user?.id, items: [] });
    }

    // Filter out products that are no longer available
    const availableItems = wishlist.items.filter((item: any) => {
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
  async addToWishlist(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.body;

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    let wishlist = await Wishlist.findOne({ user: req.user?.id });

    if (!wishlist) {
      wishlist = await Wishlist.create({
        user: req.user?.id,
        items: [{ product: productId }],
      });
    } else {
      // Check if already in wishlist
      const exists = wishlist.items.some(
        (item: any) => item.product.toString() === productId
      );

      if (exists) {
        throw new AppError('Product already in wishlist', 400);
      }

      wishlist.items.push({ product: productId } as any);
      await wishlist.save();
    }

    // Check wishlist-collector badge in background
    rewardController.checkBadges(req.user!.id).catch(() => {});

    res.json({
      success: true,
      message: 'Product added to wishlist',
      data: { wishlist },
    });
  }

  /**
   * Remove from wishlist
   */
  async removeFromWishlist(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.params;

    const wishlist = await Wishlist.findOne({ user: req.user?.id });
    if (!wishlist) {
      throw new AppError('Wishlist not found', 404);
    }

    wishlist.items = wishlist.items.filter(
      (item: any) => item.product.toString() !== productId
    );

    await wishlist.save();

    res.json({
      success: true,
      message: 'Product removed from wishlist',
    });
  }

  /**
   * Clear wishlist
   */
  async clearWishlist(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const wishlist = await Wishlist.findOne({ user: req.user?.id });
    if (!wishlist) {
      throw new AppError('Wishlist not found', 404);
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
  async isInWishlist(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.params;

    const wishlist = await Wishlist.findOne({ user: req.user?.id });

    const inWishlist = wishlist
      ? wishlist.items.some((item: any) => item.product.toString() === productId)
      : false;

    res.json({
      success: true,
      data: { inWishlist },
    });
  }

  /**
   * Move wishlist item to cart
   */
  async moveToCart(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { productId } = req.body;

    // This would integrate with cart controller
    // For now, just remove from wishlist
    await this.removeFromWishlist(req, res);
  }
}

export const wishlistController = new WishlistController();
