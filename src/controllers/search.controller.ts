import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import Product from '../models/Product';
import Category from '../models/Category';
import { escapeRegex } from '../utils/helpers';

export class SearchController {
  /**
   * Advanced product search
   */
  async searchProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const {
      q, // search query
      category,
      minPrice,
      maxPrice,
      rating,
      sort = 'relevance',
      page = '1',
      limit = '20',
      inStock = 'true',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build search filter
    const filter: any = { status: 'active' };

    // Text search
    if (q) {
      const safeQ = escapeRegex(q as string);
      filter.$or = [
        { name: { $regex: safeQ, $options: 'i' } },
        { description: { $regex: safeQ, $options: 'i' } },
        { tags: { $in: [new RegExp(safeQ, 'i')] } },
      ];
    }

    // Category filter
    if (category) {
      filter.category = category;
    }

    // Price range
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice as string);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice as string);
    }

    // Rating filter
    if (rating) {
      filter.averageRating = { $gte: parseFloat(rating as string) };
    }

    // Stock filter
    if (inStock === 'true') {
      filter.quantity = { $gt: 0 };
    }

    // Sort options
    let sortOption: any = {};
    switch (sort) {
      case 'price-asc':
        sortOption = { price: 1 };
        break;
      case 'price-desc':
        sortOption = { price: -1 };
        break;
      case 'rating':
        sortOption = { averageRating: -1 };
        break;
      case 'newest':
        sortOption = { createdAt: -1 };
        break;
      case 'popular':
        sortOption = { totalSales: -1 };
        break;
      default:
        sortOption = { createdAt: -1 };
    }

    const products = await Product.find(filter)
      .populate('vendor', 'firstName lastName')
      .populate('category', 'name slug')
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum);

    const total = await Product.countDocuments(filter);

    // Get facets for filtering
    const priceRanges = await Product.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          avgPrice: { $avg: '$price' },
        },
      },
    ]);

    const categories = await Product.aggregate([
      { $match: filter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
      { $unwind: '$category' },
      { $project: { _id: '$category._id', name: '$category.name', count: 1 } },
    ]);

    res.json({
      success: true,
      data: {
        products,
        facets: {
          priceRange: priceRanges[0] || { minPrice: 0, maxPrice: 0, avgPrice: 0 },
          categories,
        },
      },
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  }

  /**
   * Get search suggestions
   */
  async getSuggestions(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      res.json({
        success: true,
        data: { suggestions: [] },
      });
      return;
    }

    const safeQ = escapeRegex(q as string);
    const products = await Product.find({
      status: 'active',
      $or: [
        { name: { $regex: safeQ, $options: 'i' } },
        { tags: { $in: [new RegExp(safeQ, 'i')] } },
      ],
    })
      .select('name slug')
      .limit(10);

    const suggestions = products.map((p) => ({
      name: p.name,
      slug: p.slug,
    }));

    res.json({
      success: true,
      data: { suggestions },
    });
  }

  /**
   * Get trending searches
   */
  async getTrendingSearches(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    // This would ideally come from a search analytics collection
    // For now, return popular products
    const trending = await Product.find({ status: 'active' })
      .sort({ views: -1 })
      .limit(10)
      .select('name slug');

    res.json({
      success: true,
      data: { trending },
    });
  }

  /**
   * Get filters for category
   */
  async getCategoryFilters(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { categoryId } = req.params;

    const category = await Category.findById(categoryId);
    if (!category) {
      res.json({
        success: true,
        data: { filters: [] },
      });
      return;
    }

    // Get price range in category
    const priceStats = await Product.aggregate([
      { $match: { category: categoryId, status: 'active' } },
      {
        $group: {
          _id: null,
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
        },
      },
    ]);

    // Get available brands/vendors
    const vendors = await Product.aggregate([
      { $match: { category: categoryId, status: 'active' } },
      { $group: { _id: '$vendor', count: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'vendor' } },
      { $unwind: '$vendor' },
      {
        $project: {
          _id: '$vendor._id',
          name: { $concat: ['$vendor.firstName', ' ', '$vendor.lastName'] },
          count: 1,
        },
      },
      { $limit: 20 },
    ]);

    res.json({
      success: true,
      data: {
        filters: {
          priceRange: priceStats[0] || { minPrice: 0, maxPrice: 0 },
          vendors,
        },
      },
    });
  }
}

export const searchController = new SearchController();
