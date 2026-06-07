"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.productController = exports.ProductController = void 0;
const types_1 = require("../types");
const Product_1 = __importDefault(require("../models/Product"));
const Order_1 = __importDefault(require("../models/Order"));
const Category_1 = __importDefault(require("../models/Category"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const User_1 = __importDefault(require("../models/User"));
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const error_1 = require("../middleware/error");
const helpers_1 = require("../utils/helpers");
const cloudinary_1 = require("../utils/cloudinary");
const notification_service_1 = require("../services/notification.service");
class ProductController {
    async getActiveVendorIds() {
        const profiles = await VendorProfile_1.default.find({
            isActive: true,
            verificationStatus: types_1.VendorVerificationStatus.VERIFIED,
        }).select('user').lean();
        return profiles.map((p) => p.user);
    }
    // COMPLETE FIXED createProduct method for product.controller.ts
    async createProduct(req, res) {
        try {
            const productData = req.body;
            // Set vendor from authenticated user
            productData.vendor = req.user?.id;
            // Check if vendor has a profile
            const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
            if (!vendorProfile) {
                throw new error_1.AppError('Please complete your store setup before posting products.', 403);
            }
            if (vendorProfile.isActive === false) {
                throw new error_1.AppError('Your account is currently inactive. Please contact support to post products.', 403);
            }
            const isDraft = productData.status === 'draft';
            // Validate price and quantity
            if (productData.price !== undefined && productData.price <= 0) {
                throw new error_1.AppError('Price must be greater than 0', 400);
            }
            if (productData.compareAtPrice !== undefined &&
                productData.price !== undefined &&
                productData.compareAtPrice <= productData.price) {
                throw new error_1.AppError('Compare-at price must be greater than the selling price', 400);
            }
            if (productData.quantity !== undefined && productData.quantity < 0) {
                throw new error_1.AppError('Quantity cannot be negative', 400);
            }
            // Generate slug and SKU
            productData.slug = (0, helpers_1.generateSlug)(productData.name);
            if (!productData.sku) {
                productData.sku = (0, helpers_1.generateSKU)(productData.name);
            }
            // Enforce minimum 2 images only for published products
            if (!isDraft) {
                if (!productData.images || !Array.isArray(productData.images) || productData.images.length < 2) {
                    throw new error_1.AppError('Please upload at least 2 product images', 400);
                }
            }
            // Upload images to Cloudinary (only if images were provided)
            if (productData.images && Array.isArray(productData.images) && productData.images.length > 0) {
                console.log(`📸 Uploading ${productData.images.length} images to Cloudinary...`);
                const cloudinaryUrls = await (0, cloudinary_1.uploadMultipleToCloudinary)(productData.images, `products/${req.user?.id}`);
                productData.images = cloudinaryUrls;
                console.log(`✅ Images uploaded successfully:`, cloudinaryUrls);
            }
            else {
                productData.images = [];
            }
            // ✅ UPLOAD DIGITAL FILE FOR DIGITAL PRODUCTS (if provided)
            if (productData.productType === 'digital' && productData.digitalFileBase64) {
                console.log('📁 Uploading digital file to Cloudinary...');
                const digitalFileResult = await (0, cloudinary_1.uploadDigitalFileToCloudinary)(productData.digitalFileBase64, `digital-products/${req.user?.id}`);
                productData.digitalFile = {
                    url: digitalFileResult.url,
                    fileName: productData.digitalFileName || digitalFileResult.fileName || 'digital-file',
                    fileSize: digitalFileResult.fileSize,
                    fileType: digitalFileResult.fileType,
                    version: productData.digitalFileVersion || '1.0',
                    uploadedAt: new Date(),
                };
                // Remove temporary fields
                delete productData.digitalFileBase64;
                delete productData.digitalFileName;
                delete productData.digitalFileVersion;
                console.log('✅ Digital file uploaded successfully');
            }
            else if (productData.productType === 'digital' && productData.digitalExternalLink) {
                productData.digitalFile = {
                    url: productData.digitalExternalLink,
                    fileName: 'External Link',
                    fileSize: 0,
                    fileType: 'link',
                    version: '1.0',
                    uploadedAt: new Date(),
                    isExternalLink: true,
                };
                delete productData.digitalExternalLink;
                console.log('✅ External digital link set');
            }
            // Resolve pickupAddress _id → full address snapshot from vendor's saved addresses
            if (productData.pickupAddress && typeof productData.pickupAddress === 'string') {
                const addressId = productData.pickupAddress;
                const vendor = await User_1.default.findById(req.user?.id).select('addresses');
                const matched = vendor?.addresses?.find((a) => a._id.toString() === addressId);
                productData.pickupAddress = matched
                    ? { street: matched.street, city: matched.city, state: matched.state, country: matched.country || 'Nigeria', fullName: matched.fullName || '', phone: matched.phone || '', shipBubble: matched.shipBubble }
                    : undefined;
            }
            // Drafts keep their status; all other new products go to PENDING_APPROVAL
            productData.status = isDraft ? types_1.ProductStatus.DRAFT : types_1.ProductStatus.PENDING_APPROVAL;
            console.log('📦 Creating product in database...');
            // Create product in database
            const product = await Product_1.default.create(productData);
            console.log('✅ Product created:', product._id);
            // Update category product count
            if (product.category) {
                await Category_1.default.findByIdAndUpdate(product.category, {
                    $inc: { productCount: 1 },
                });
                console.log('✅ Category product count updated');
            }
            // Format product for response
            const formattedProduct = this.formatProduct(product);
            console.log('✅ Sending success response to frontend');
            // ✅ SEND RESPONSE
            res.status(201).json({
                success: true,
                message: 'Product created successfully',
                data: { product: formattedProduct },
            });
        }
        catch (error) {
            console.error('❌ Error creating product:', error);
            console.error('Error details:', error.message);
            console.error('Stack:', error.stack);
            // Send error response
            if (!res.headersSent) {
                res.status(error.statusCode || 500).json({
                    success: false,
                    message: error.message || 'Failed to create product',
                    error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                });
            }
        }
    }
    async getProducts(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const activeVendorIds = await this.getActiveVendorIds();
        const filter = { status: types_1.ProductStatus.ACTIVE, vendor: { $in: activeVendorIds } };
        // Filters
        if (req.query.category)
            filter.category = req.query.category;
        if (req.query.vendor)
            filter.vendor = req.query.vendor;
        if (req.query.productType)
            filter.productType = req.query.productType;
        if (req.query.inStock !== undefined) {
            filter.quantity = req.query.inStock === 'true' ? { $gt: 0 } : 0;
        }
        // Price range
        if (req.query.minPrice || req.query.maxPrice) {
            filter.price = {};
            if (req.query.minPrice)
                filter.price.$gte = Number(req.query.minPrice);
            if (req.query.maxPrice)
                filter.price.$lte = Number(req.query.maxPrice);
        }
        // Rating
        if (req.query.rating) {
            filter.averageRating = { $gte: Number(req.query.rating) };
        }
        // Search
        if (req.query.search) {
            filter.$text = { $search: req.query.search };
        }
        // Sort
        let sort = { createdAt: -1 };
        switch (req.query.sort) {
            case 'price_asc':
                sort = { price: 1 };
                break;
            case 'price_desc':
                sort = { price: -1 };
                break;
            case 'rating':
                sort = { averageRating: -1 };
                break;
            case 'newest':
                sort = { createdAt: -1 };
                break;
            case 'popular':
                sort = { totalSales: -1, views: -1 };
                break;
        }
        const products = await Product_1.default.find(filter)
            .populate('vendor', 'firstName lastName profileImage')
            .populate('category', 'name')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean();
        const total = await Product_1.default.countDocuments(filter);
        const meta = (0, helpers_1.getPaginationMeta)(total, page, limit);
        // Format products for frontend
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Products fetched successfully',
            data: {
                products: formattedProducts,
                total,
                page,
                limit,
                hasMore: skip + products.length < total
            },
            meta,
        });
    }
    async getProduct(req, res) {
        const { id } = req.params;
        const isObjectId = /^[a-f\d]{24}$/i.test(id);
        const product = await (isObjectId
            ? Product_1.default.findById(id)
            : Product_1.default.findOne({ slug: id }))
            .populate('vendor', 'firstName lastName email profileImage')
            .populate('category', 'name');
        if (!product || product.status !== 'active') {
            throw new error_1.AppError('Product not found', 404);
        }
        // Verify vendor is approved and active before exposing the product
        if (product.vendor?._id) {
            const VendorProfile = require('../models/VendorProfile').default;
            const vendorProfile = await VendorProfile.findOne({ user: product.vendor._id })
                .select('verificationStatus isActive isPremium businessName businessLogo');
            if (!vendorProfile || vendorProfile.verificationStatus !== 'verified' || !vendorProfile.isActive) {
                throw new error_1.AppError('Product not found', 404);
            }
            // Increment views only for valid, reachable products
            product.views += 1;
            await product.save();
            const formatted = this.formatProduct(product);
            formatted.vendor.verified = true;
            formatted.vendor.isPremium = vendorProfile.isPremium || false;
            if (vendorProfile.businessName)
                formatted.vendor.name = vendorProfile.businessName;
            if (vendorProfile.businessLogo)
                formatted.vendor.image = vendorProfile.businessLogo;
            res.json({
                success: true,
                message: 'Product fetched successfully',
                data: formatted,
            });
            return;
        }
        // No vendor info — treat as unavailable
        throw new error_1.AppError('Product not found', 404);
    }
    // Get single product owned by the authenticated vendor (regardless of status — needed for draft editing)
    async getMyProduct(req, res) {
        const { id } = req.params;
        const vendorId = req.user?.id;
        if (!vendorId)
            throw new error_1.AppError('User not authenticated', 401);
        const product = await Product_1.default.findOne({ _id: id, vendor: vendorId })
            .populate('vendor', 'firstName lastName email profileImage')
            .populate('category', 'name');
        if (!product)
            throw new error_1.AppError('Product not found', 404);
        res.json({
            success: true,
            message: 'Product fetched successfully',
            data: this.formatProduct(product),
        });
    }
    // NEW: Get My Products (for authenticated vendor)
    async getMyProducts(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        // Get authenticated vendor's ID
        const vendorId = req.user?.id;
        if (!vendorId) {
            throw new error_1.AppError('User not authenticated', 401);
        }
        // Build filter for vendor's products
        const filter = {
            vendor: vendorId
            // NOTE: We DON'T filter by status here so vendors can see all their products
            // including inactive/draft ones
        };
        // Optional filters
        if (req.query.status) {
            filter.status = req.query.status;
        }
        if (req.query.productType) {
            filter.productType = req.query.productType;
        }
        if (req.query.search) {
            const safeSearch = (0, helpers_1.escapeRegex)(req.query.search);
            filter.$or = [
                { name: { $regex: safeSearch, $options: 'i' } },
                { description: { $regex: safeSearch, $options: 'i' } },
            ];
        }
        // Sort options
        let sort = { createdAt: -1 };
        switch (req.query.sort) {
            case 'price_asc':
                sort = { price: 1 };
                break;
            case 'price_desc':
                sort = { price: -1 };
                break;
            case 'name':
                sort = { name: 1 };
                break;
            case 'stock':
                sort = { quantity: -1 };
                break;
            case 'newest':
                sort = { createdAt: -1 };
                break;
            case 'oldest':
                sort = { createdAt: 1 };
                break;
        }
        const products = await Product_1.default.find(filter)
            .populate('vendor', 'firstName lastName profileImage')
            .populate('category', 'name')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean();
        const total = await Product_1.default.countDocuments(filter);
        const meta = (0, helpers_1.getPaginationMeta)(total, page, limit);
        // Calculate stock statistics
        const allProducts = await Product_1.default.find({ vendor: vendorId }).lean();
        const stockStats = {
            total: allProducts.length,
            active: allProducts.filter(p => p.status === types_1.ProductStatus.ACTIVE).length,
            inactive: allProducts.filter(p => p.status === types_1.ProductStatus.INACTIVE).length,
            lowStock: allProducts.filter(p => p.quantity > 0 && p.quantity <= 10).length,
            outOfStock: allProducts.filter(p => p.quantity === 0).length,
        };
        // Format products for frontend
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Your products fetched successfully',
            data: {
                products: formattedProducts,
                total,
                page,
                limit,
                hasMore: skip + products.length < total,
                stats: stockStats
            },
            meta,
        });
    }
    // NEW: Get Recommended Products
    async getRecommendedProducts(req, res) {
        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        const userId = req.user?.id;
        let preferredCategoryIds = [];
        if (userId) {
            const recentOrders = await Order_1.default.find({ user: userId })
                .sort({ createdAt: -1 })
                .limit(20)
                .select('items')
                .lean();
            const productIds = recentOrders.flatMap((o) => (o.items || []).map((i) => i.product));
            if (productIds.length > 0) {
                const purchasedProducts = await Product_1.default.find({ _id: { $in: productIds } })
                    .select('category')
                    .lean();
                const categorySet = new Set(purchasedProducts
                    .map((p) => p.category?.toString())
                    .filter(Boolean));
                preferredCategoryIds = [...categorySet];
            }
        }
        const baseFilter = { status: types_1.ProductStatus.ACTIVE, quantity: { $gt: 0 } };
        if (preferredCategoryIds.length > 0) {
            baseFilter.category = { $in: preferredCategoryIds };
        }
        const [products, total] = await Promise.all([
            Product_1.default.find(baseFilter)
                .populate('vendor', 'firstName lastName profileImage')
                .populate('category', 'name')
                .sort({ averageRating: -1, totalSales: -1, views: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Product_1.default.countDocuments(baseFilter),
        ]);
        const formattedProducts = products.map(this.formatProduct);
        const totalPages = Math.ceil(total / limit);
        res.json({
            success: true,
            message: 'Recommended products fetched successfully',
            data: {
                products: formattedProducts,
                total,
                page,
                limit,
                totalPages,
                hasMore: page < totalPages,
            },
        });
    }
    // NEW: Get Featured Products
    async getFeaturedProducts(req, res) {
        const limit = parseInt(req.query.limit) || 10;
        const products = await Product_1.default.find({
            status: types_1.ProductStatus.ACTIVE,
            isFeatured: true,
            quantity: { $gt: 0 }
        })
            .populate('vendor', 'firstName lastName profileImage')
            .populate('category', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Featured products fetched successfully',
            data: {
                products: formattedProducts,
                total: products.length,
                page: 1,
                limit,
                hasMore: false
            }
        });
    }
    // NEW: Get Products by Category
    async getProductsByCategory(req, res) {
        const { categoryId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const activeVendorIds = await this.getActiveVendorIds();
        const categoryFilter = {
            status: types_1.ProductStatus.ACTIVE,
            category: categoryId,
            vendor: { $in: activeVendorIds },
        };
        const products = await Product_1.default.find(categoryFilter)
            .populate('vendor', 'firstName lastName profileImage')
            .populate('category', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
        const total = await Product_1.default.countDocuments(categoryFilter);
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Category products fetched successfully',
            data: {
                products: formattedProducts,
                total,
                page,
                limit,
                hasMore: skip + products.length < total
            }
        });
    }
    // NEW: Search Products
    async searchProducts(req, res) {
        const query = req.query.q;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        if (!query) {
            throw new error_1.AppError('Search query is required', 400);
        }
        const activeVendorIds = await this.getActiveVendorIds();
        const searchFilter = {
            status: types_1.ProductStatus.ACTIVE,
            $text: { $search: query },
            vendor: { $in: activeVendorIds },
        };
        const products = await Product_1.default.find(searchFilter)
            .populate('vendor', 'firstName lastName profileImage')
            .populate('category', 'name')
            .sort({ score: { $meta: 'textScore' } })
            .skip(skip)
            .limit(limit)
            .lean();
        const total = await Product_1.default.countDocuments(searchFilter);
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Search results fetched successfully',
            data: {
                products: formattedProducts,
                total,
                page,
                limit,
                hasMore: skip + products.length < total,
                query
            }
        });
    }
    // NEW: Get New Arrivals
    async getNewArrivals(req, res) {
        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const activeVendorIds = await this.getActiveVendorIds();
        const filter = {
            status: types_1.ProductStatus.ACTIVE,
            createdAt: { $gte: thirtyDaysAgo },
            quantity: { $gt: 0 },
            vendor: { $in: activeVendorIds },
        };
        const [products, total] = await Promise.all([
            Product_1.default.find(filter)
                .populate('vendor', 'firstName lastName profileImage')
                .populate('category', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Product_1.default.countDocuments(filter),
        ]);
        const formattedProducts = products.map(this.formatProduct);
        const totalPages = Math.ceil(total / limit);
        res.json({
            success: true,
            message: 'New arrivals fetched successfully',
            data: {
                products: formattedProducts,
                total,
                page,
                limit,
                totalPages,
                hasMore: page < totalPages,
            },
        });
    }
    // NEW: Get Products On Sale
    async getProductsOnSale(req, res) {
        const limit = parseInt(req.query.limit) || 10;
        const activeVendorIds = await this.getActiveVendorIds();
        // Products with compareAtPrice set (indicating discount)
        const products = await Product_1.default.find({
            status: types_1.ProductStatus.ACTIVE,
            compareAtPrice: { $exists: true, $gt: 0 },
            $expr: { $lt: ['$price', '$compareAtPrice'] },
            quantity: { $gt: 0 },
            vendor: { $in: activeVendorIds },
        })
            .populate('vendor', 'firstName lastName profileImage')
            .populate('category', 'name')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Sale products fetched successfully',
            data: {
                products: formattedProducts,
                total: products.length,
                page: 1,
                limit,
                hasMore: false
            }
        });
    }
    /**
     * Get discounted products — any active product where price < compareAtPrice.
     */
    async getFlashSaleProducts(req, res) {
        const limit = parseInt(req.query.limit) || 20;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;
        const activeVendorIds = await this.getActiveVendorIds();
        const filter = {
            status: types_1.ProductStatus.ACTIVE,
            quantity: { $gt: 0 },
            compareAtPrice: { $exists: true, $gt: 0 },
            $expr: { $lt: ['$price', '$compareAtPrice'] },
            vendor: { $in: activeVendorIds },
        };
        const [products, total] = await Promise.all([
            Product_1.default.find(filter)
                .populate('vendor', 'firstName lastName profileImage')
                .populate('category', 'name')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Product_1.default.countDocuments(filter),
        ]);
        const formattedProducts = products.map(this.formatProduct);
        const totalPages = Math.ceil(total / limit);
        res.json({
            success: true,
            message: 'Discounted products fetched',
            data: { products: formattedProducts, total, page, limit, totalPages, hasMore: page < totalPages },
        });
    }
    /**
     * Toggle flash sale on a product. Vendor must own the product and it must have >=10% discount.
     */
    async toggleFlashSale(req, res) {
        const { id } = req.params;
        const { enable, durationHours } = req.body; // enable: boolean, durationHours: number (optional, default 48)
        const product = await Product_1.default.findById(id);
        if (!product)
            throw new error_1.AppError('Product not found', 404);
        // Verify ownership
        if (product.vendor.toString() !== req.user?.id) {
            throw new error_1.AppError('You can only modify your own products', 403);
        }
        if (enable) {
            // Validate >=10% discount
            if (!product.compareAtPrice || product.compareAtPrice <= product.price) {
                throw new error_1.AppError('Product must have a compare-at price higher than the sale price', 400);
            }
            const discountPercent = ((product.compareAtPrice - product.price) / product.compareAtPrice) * 100;
            if (discountPercent < 10) {
                throw new error_1.AppError('Product must be at least 10% off to activate flash sale', 400);
            }
            product.isFlashSale = true;
            const hours = durationHours || 48;
            product.flashSaleEndsAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        }
        else {
            product.isFlashSale = false;
            product.flashSaleEndsAt = undefined;
        }
        await product.save();
        res.json({
            success: true,
            message: enable ? 'Flash sale activated' : 'Flash sale deactivated',
            data: { product: this.formatProduct(product) },
        });
    }
    // NEW: Get Vendor Products
    async getVendorProducts(req, res) {
        const { vendorId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const products = await Product_1.default.find({
            status: types_1.ProductStatus.ACTIVE,
            vendor: vendorId
        })
            .populate('vendor', 'firstName lastName profileImage')
            .populate('category', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
        const total = await Product_1.default.countDocuments({
            status: types_1.ProductStatus.ACTIVE,
            vendor: vendorId
        });
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Vendor products fetched successfully',
            data: {
                products: formattedProducts,
                total,
                page,
                limit,
                hasMore: skip + products.length < total
            }
        });
    }
    // NEW: Get Trending Products
    async getTrendingProducts(req, res) {
        const limit = parseInt(req.query.limit) || 10;
        // Step 1: Try products with actual engagement (sales or views > 0) from last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        let products = await Product_1.default.find({
            status: types_1.ProductStatus.ACTIVE,
            quantity: { $gt: 0 },
            $or: [
                { totalSales: { $gt: 0 } },
                { views: { $gt: 0 } }
            ],
            updatedAt: { $gte: thirtyDaysAgo }
        })
            .populate('vendor', 'firstName lastName profileImage')
            .populate('category', 'name')
            .sort({ totalSales: -1, views: -1, averageRating: -1 })
            .limit(limit)
            .lean();
        // Step 2: If still not enough, get products with any engagement (no time filter)
        if (products.length < limit) {
            products = await Product_1.default.find({
                status: types_1.ProductStatus.ACTIVE,
                quantity: { $gt: 0 },
                $or: [
                    { totalSales: { $gt: 0 } },
                    { views: { $gt: 0 } },
                    { averageRating: { $gt: 0 } }
                ]
            })
                .populate('vendor', 'firstName lastName profileImage')
                .populate('category', 'name')
                .sort({ totalSales: -1, views: -1, averageRating: -1 })
                .limit(limit)
                .lean();
        }
        // Step 3: Last resort - newest products (still better than nothing)
        if (products.length < limit) {
            products = await Product_1.default.find({
                status: types_1.ProductStatus.ACTIVE,
                quantity: { $gt: 0 }
            })
                .populate('vendor', 'firstName lastName profileImage')
                .populate('category', 'name')
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();
        }
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Trending products fetched successfully',
            data: {
                products: formattedProducts,
                total: products.length,
                page: 1,
                limit,
                hasMore: false
            }
        });
    }
    // Add this method to your ProductController class in product.controller.ts
    /**
     * Get Similar Products
     * Returns products from the same category and/or vendor, excluding the current product
     */
    async getSimilarProducts(req, res) {
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 10;
        // Get the current product to find its category and vendor
        const currentProduct = await Product_1.default.findById(id).lean();
        if (!currentProduct) {
            throw new error_1.AppError('Product not found', 404);
        }
        // Strategy: same category first, then same vendor, then fallback to popular
        let products = [];
        // 1. Same category products (excluding current)
        if (currentProduct.category) {
            const categoryProducts = await Product_1.default.find({
                _id: { $ne: id },
                status: types_1.ProductStatus.ACTIVE,
                category: currentProduct.category,
                quantity: { $gt: 0 },
            })
                .populate('vendor', 'firstName lastName profileImage')
                .populate('category', 'name')
                .sort({ averageRating: -1, totalSales: -1 })
                .limit(limit)
                .lean();
            products = categoryProducts;
        }
        // 2. If not enough, fill with same vendor products
        if (products.length < limit) {
            const existingIds = [id, ...products.map((p) => p._id.toString())];
            const remaining = limit - products.length;
            const vendorProducts = await Product_1.default.find({
                _id: { $nin: existingIds },
                status: types_1.ProductStatus.ACTIVE,
                vendor: currentProduct.vendor,
                quantity: { $gt: 0 },
            })
                .populate('vendor', 'firstName lastName profileImage')
                .populate('category', 'name')
                .sort({ averageRating: -1, totalSales: -1 })
                .limit(remaining)
                .lean();
            products = [...products, ...vendorProducts];
        }
        // 3. If still not enough, fill with popular products
        if (products.length < limit) {
            const existingIds = [id, ...products.map((p) => p._id.toString())];
            const remaining = limit - products.length;
            const popularProducts = await Product_1.default.find({
                _id: { $nin: existingIds },
                status: types_1.ProductStatus.ACTIVE,
                quantity: { $gt: 0 },
            })
                .populate('vendor', 'firstName lastName profileImage')
                .populate('category', 'name')
                .sort({ totalSales: -1, views: -1, averageRating: -1 })
                .limit(remaining)
                .lean();
            products = [...products, ...popularProducts];
        }
        const formattedProducts = products.map(this.formatProduct);
        res.json({
            success: true,
            message: 'Similar products fetched successfully',
            data: {
                products: formattedProducts,
                total: formattedProducts.length,
            },
        });
    }
    async updateProduct(req, res) {
        const product = await Product_1.default.findById(req.params.id);
        if (!product) {
            throw new error_1.AppError('Product not found', 404);
        }
        if (product.vendor.toString() !== req.user?.id) {
            throw new error_1.AppError('Not authorized', 403);
        }
        const oldPrice = product.price;
        // Validate price and quantity when supplied
        if (req.body.price !== undefined && req.body.price <= 0) {
            throw new error_1.AppError('Price must be greater than 0', 400);
        }
        if (req.body.quantity !== undefined && req.body.quantity < 0) {
            throw new error_1.AppError('Quantity cannot be negative', 400);
        }
        const effectivePrice = req.body.price ?? product.price;
        if (req.body.compareAtPrice !== undefined) {
            // Vendor is explicitly setting a new compare-at price — validate it
            if (req.body.compareAtPrice <= effectivePrice) {
                throw new error_1.AppError('Compare-at price must be greater than the selling price', 400);
            }
        }
        else if (req.body.price !== undefined && product.compareAtPrice && product.compareAtPrice <= req.body.price) {
            // Vendor is only updating price and the new price meets or exceeds the existing
            // compare-at price — auto-clear compareAtPrice so the product no longer shows as on sale
            req.body.compareAtPrice = null;
        }
        // Upload any new base64 images to Cloudinary before saving
        if (req.body.images && Array.isArray(req.body.images) && req.body.images.length > 0) {
            req.body.images = await Promise.all(req.body.images.map(async (img) => {
                if (typeof img === 'string' && img.startsWith('data:')) {
                    const result = await (0, cloudinary_1.uploadToCloudinary)(img, 'products');
                    return result.url;
                }
                return img;
            }));
        }
        // Resolve pickupAddress _id → full address snapshot
        if (req.body.pickupAddress && typeof req.body.pickupAddress === 'string') {
            const addressId = req.body.pickupAddress;
            const vendor = await User_1.default.findById(req.user?.id).select('addresses');
            const matched = vendor?.addresses?.find((a) => a._id.toString() === addressId);
            req.body.pickupAddress = matched
                ? { street: matched.street, city: matched.city, state: matched.state, country: matched.country || 'Nigeria', fullName: matched.fullName || '', phone: matched.phone || '', shipBubble: matched.shipBubble }
                : undefined;
        }
        Object.assign(product, req.body);
        await product.save();
        // Notify wishlisted users about price drop
        if (req.body.price && req.body.price < oldPrice) {
            try {
                const { Wishlist } = await Promise.resolve().then(() => __importStar(require('../models/Additional')));
                const wishlists = await Wishlist.find({ 'items.product': product._id }).select('user');
                const userIds = wishlists.map((w) => w.user.toString());
                if (userIds.length > 0) {
                    await notification_service_1.notificationService.priceDrop(userIds, product.name, oldPrice, req.body.price, product._id.toString());
                }
            }
            catch (error) {
                console.error('Error sending price drop notification:', error);
            }
        }
        res.json({
            success: true,
            message: 'Product updated successfully',
            data: { product },
        });
    }
    async deleteProduct(req, res) {
        const product = await Product_1.default.findById(req.params.id);
        if (!product) {
            throw new error_1.AppError('Product not found', 404);
        }
        if (product.vendor.toString() !== req.user?.id) {
            throw new error_1.AppError('Not authorized', 403);
        }
        await product.deleteOne();
        await Category_1.default.findByIdAndUpdate(product.category, {
            $inc: { productCount: -1 },
        });
        res.json({
            success: true,
            message: 'Product deleted successfully',
        });
    }
    // Add this to your ProductController class
    // Updated Helper method to format product for frontend
    formatProduct(product) {
        // Calculate discount percentage
        let discountPercentage = null;
        if (product.compareAtPrice && product.compareAtPrice > product.price) {
            const discount = Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100);
            discountPercentage = `-${discount}%`;
        }
        // Convert specifications Map to object if it exists
        let specifications = {};
        if (product.specifications) {
            if (product.specifications instanceof Map) {
                specifications = Object.fromEntries(product.specifications);
            }
            else {
                specifications = product.specifications;
            }
        }
        return {
            id: product._id.toString(),
            name: product.name,
            description: product.description,
            shortDescription: product.shortDescription,
            price: product.price,
            originalPrice: product.compareAtPrice,
            discount: product.compareAtPrice ? Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100) : 0,
            discountPercentage,
            rating: product.averageRating || 0,
            reviews: product.totalReviews || 0,
            images: product.images || [],
            thumbnail: product.images?.[0] || '',
            category: product.category?.name || 'Uncategorized',
            categoryId: product.category?._id?.toString() || '',
            vendor: {
                id: product.vendor?._id?.toString() || '',
                name: product.vendor ? `${product.vendor.firstName} ${product.vendor.lastName}` : 'Unknown',
                image: product.vendor?.profileImage || ''
            },
            stock: product.quantity || 0,
            inStock: (product.quantity || 0) > 0,
            tags: product.tags || [],
            productType: product.productType,
            isFeatured: product.isFeatured || false,
            isAffiliate: product.isAffiliate || false,
            affiliateCommission: product.affiliateCommission || 0,
            totalSales: product.totalSales || 0,
            views: product.views || 0,
            weight: product.weight,
            sku: product.sku || '',
            isFlashSale: product.isFlashSale || false,
            colors: product.colors || [],
            sizes: product.sizes || [],
            status: product.status || 'pending_approval',
            // NEW: Product details
            keyFeatures: product.keyFeatures || [],
            specifications: specifications,
            requiresLicense: product.requiresLicense || false,
            licenseType: product.licenseType,
            createdAt: product.createdAt,
            updatedAt: product.updatedAt
        };
    }
    async generateProductContent(req, res) {
        try {
            const { type, category, keywords, currentTitle, currentDescription } = req.body;
            if (!type || !['title', 'description'].includes(type)) {
                throw new error_1.AppError('type must be "title" or "description"', 400);
            }
            const groq = new groq_sdk_1.default({
                apiKey: process.env.GROQ_API_KEY,
            });
            let prompt = '';
            if (type === 'title') {
                prompt = `Generate a catchy, SEO-friendly product title for an e-commerce listing on a Nigerian marketplace.
${category ? `Category: ${category}` : ''}
${keywords ? `Keywords/details: ${keywords}` : ''}
${currentTitle ? `Current title to improve: ${currentTitle}` : ''}

Return ONLY the product title, nothing else. Keep it under 80 characters. Make it compelling and descriptive.`;
            }
            else {
                prompt = `Write a detailed, compelling product description for an e-commerce listing on a Nigerian marketplace.
${category ? `Category: ${category}` : ''}
${currentTitle ? `Product name: ${currentTitle}` : ''}
${keywords ? `Keywords/details: ${keywords}` : ''}
${currentDescription ? `Current description to improve: ${currentDescription}` : ''}

Write a professional product description that:
- Highlights key features and benefits
- Uses persuasive language
- Is 100-300 words
- Includes relevant details a buyer would want to know
- Sounds natural, not robotic

Return ONLY the description text, no headers or labels.`;
            }
            const completion = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: type === 'title' ? 100 : 500,
                temperature: 0.7,
            });
            const generatedContent = completion.choices[0]?.message?.content?.trim() || '';
            res.status(200).json({
                success: true,
                message: `Product ${type} generated successfully`,
                data: { content: generatedContent },
            });
        }
        catch (error) {
            if (error instanceof error_1.AppError)
                throw error;
            console.error('AI generation error:', error);
            throw new error_1.AppError('Failed to generate content. Please try again.', 500);
        }
    }
}
exports.ProductController = ProductController;
exports.productController = new ProductController();
//# sourceMappingURL=product.controller.js.map