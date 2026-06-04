import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class ProductController {
    private getActiveVendorIds;
    createProduct(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getProduct(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getMyProduct(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getMyProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getRecommendedProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getFeaturedProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getProductsByCategory(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    searchProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getNewArrivals(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getProductsOnSale(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get flash sale products (active, >=10% discount, isFlashSale=true, not expired)
     */
    getFlashSaleProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Toggle flash sale on a product. Vendor must own the product and it must have >=10% discount.
     */
    toggleFlashSale(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getVendorProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    getTrendingProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get Similar Products
     * Returns products from the same category and/or vendor, excluding the current product
     */
    getSimilarProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    updateProduct(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    deleteProduct(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    private formatProduct;
    generateProductContent(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
}
export declare const productController: ProductController;
//# sourceMappingURL=product.controller.d.ts.map