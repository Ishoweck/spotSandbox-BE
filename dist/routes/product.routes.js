"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const product_controller_1 = require("../controllers/product.controller");
const auth_1 = require("../middleware/auth");
const error_1 = require("../middleware/error");
const types_1 = require("../types");
const router = (0, express_1.Router)();
// Public routes (no authentication required)
// Get all products with filters
router.get('/', (0, error_1.asyncHandler)(product_controller_1.productController.getProducts.bind(product_controller_1.productController)));
// Get recommended products (for home page)
router.get('/recommended', (0, error_1.asyncHandler)(product_controller_1.productController.getRecommendedProducts.bind(product_controller_1.productController)));
// Get featured products (for home page)
router.get('/featured', (0, error_1.asyncHandler)(product_controller_1.productController.getFeaturedProducts.bind(product_controller_1.productController)));
// Search products
router.get('/search', (0, error_1.asyncHandler)(product_controller_1.productController.searchProducts.bind(product_controller_1.productController)));
// Get new arrivals
router.get('/new-arrivals', (0, error_1.asyncHandler)(product_controller_1.productController.getNewArrivals.bind(product_controller_1.productController)));
// Get products on sale
router.get('/on-sale', (0, error_1.asyncHandler)(product_controller_1.productController.getProductsOnSale.bind(product_controller_1.productController)));
// Get flash sale products
router.get('/flash-sales', (0, error_1.asyncHandler)(product_controller_1.productController.getFlashSaleProducts.bind(product_controller_1.productController)));
// Get trending products
router.get('/trending', (0, error_1.asyncHandler)(product_controller_1.productController.getTrendingProducts.bind(product_controller_1.productController)));
router.get('/:id/similar', (0, error_1.asyncHandler)(product_controller_1.productController.getSimilarProducts.bind(product_controller_1.productController)));
// Get products by category
router.get('/category/:categoryId', (0, error_1.asyncHandler)(product_controller_1.productController.getProductsByCategory.bind(product_controller_1.productController)));
// Get products by vendor (public - for viewing vendor's storefront)
router.get('/vendor/:vendorId', (0, error_1.asyncHandler)(product_controller_1.productController.getVendorProducts.bind(product_controller_1.productController)));
// ============================================================
// Protected routes (authentication required)
// ============================================================
// ✅ CRITICAL: /my-products MUST come BEFORE /:id
router.get('/my-products', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.VENDOR, types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(product_controller_1.productController.getMyProducts.bind(product_controller_1.productController)));
// ============================================================
// Get single product - MUST BE AFTER /my-products
// ============================================================
router.get('/:id', (0, error_1.asyncHandler)(product_controller_1.productController.getProduct.bind(product_controller_1.productController)));
// Generate product title or description with AI
router.post('/generate-content', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.VENDOR, types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(product_controller_1.productController.generateProductContent.bind(product_controller_1.productController)));
// Create product (vendors, admins, super admins only)
router.post('/', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.VENDOR, types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(product_controller_1.productController.createProduct.bind(product_controller_1.productController)));
// Toggle flash sale on a product (admin only)
router.put('/:id/flash-sale', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(product_controller_1.productController.toggleFlashSale.bind(product_controller_1.productController)));
// Update product (vendors, admins, super admins only)
router.put('/:id', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.VENDOR, types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(product_controller_1.productController.updateProduct.bind(product_controller_1.productController)));
// Delete product (vendors, admins, super admins only)
router.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.VENDOR, types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(product_controller_1.productController.deleteProduct.bind(product_controller_1.productController)));
exports.default = router;
//# sourceMappingURL=product.routes.js.map