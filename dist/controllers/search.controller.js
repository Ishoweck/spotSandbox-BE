"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchController = exports.SearchController = void 0;
const Product_1 = __importDefault(require("../models/Product"));
const Category_1 = __importDefault(require("../models/Category"));
const helpers_1 = require("../utils/helpers");
class SearchController {
    /**
     * Advanced product search
     */
    async searchProducts(req, res) {
        const { q, // search query
        category, minPrice, maxPrice, rating, sort = 'relevance', page = '1', limit = '20', inStock = 'true', } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        // Build search filter
        const filter = { status: 'active' };
        // Text search
        if (q) {
            const safeQ = (0, helpers_1.escapeRegex)(q);
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
            if (minPrice)
                filter.price.$gte = parseFloat(minPrice);
            if (maxPrice)
                filter.price.$lte = parseFloat(maxPrice);
        }
        // Rating filter
        if (rating) {
            filter.averageRating = { $gte: parseFloat(rating) };
        }
        // Stock filter
        if (inStock === 'true') {
            filter.quantity = { $gt: 0 };
        }
        // Sort options
        let sortOption = {};
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
        const products = await Product_1.default.find(filter)
            .populate('vendor', 'firstName lastName')
            .populate('category', 'name slug')
            .sort(sortOption)
            .skip(skip)
            .limit(limitNum);
        const total = await Product_1.default.countDocuments(filter);
        // Get facets for filtering
        const priceRanges = await Product_1.default.aggregate([
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
        const categories = await Product_1.default.aggregate([
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
    async getSuggestions(req, res) {
        const { q } = req.query;
        if (!q || q.length < 2) {
            res.json({
                success: true,
                data: { suggestions: [] },
            });
            return;
        }
        const safeQ = (0, helpers_1.escapeRegex)(q);
        const products = await Product_1.default.find({
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
    async getTrendingSearches(req, res) {
        // This would ideally come from a search analytics collection
        // For now, return popular products
        const trending = await Product_1.default.find({ status: 'active' })
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
    async getCategoryFilters(req, res) {
        const { categoryId } = req.params;
        const category = await Category_1.default.findById(categoryId);
        if (!category) {
            res.json({
                success: true,
                data: { filters: [] },
            });
            return;
        }
        // Get price range in category
        const priceStats = await Product_1.default.aggregate([
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
        const vendors = await Product_1.default.aggregate([
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
exports.SearchController = SearchController;
exports.searchController = new SearchController();
//# sourceMappingURL=search.controller.js.map