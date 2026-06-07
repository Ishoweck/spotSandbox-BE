import { Request, Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class BlogController {
    /** GET /blogs — public, published posts, optional ?category=&page=&limit= */
    getBlogs(req: Request, res: Response<ApiResponse>): Promise<void>;
    /** GET /blogs/:slug — public */
    getBlogBySlug(req: Request, res: Response<ApiResponse>): Promise<void>;
    /** GET /admin/blogs — all posts (published + drafts) */
    adminGetBlogs(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /** POST /admin/blogs */
    createBlog(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /** PUT /admin/blogs/:id */
    updateBlog(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /** DELETE /admin/blogs/:id */
    deleteBlog(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /** POST /admin/blogs/upload-image — upload cover image to Cloudinary */
    uploadImage(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
}
export declare const blogController: BlogController;
//# sourceMappingURL=blog.controller.d.ts.map