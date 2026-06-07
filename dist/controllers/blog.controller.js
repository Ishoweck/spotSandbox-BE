"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blogController = exports.BlogController = void 0;
const error_1 = require("../middleware/error");
const Blog_1 = __importDefault(require("../models/Blog"));
const cloudinary_1 = __importDefault(require("../utils/cloudinary"));
const logger_1 = require("../utils/logger");
function slugify(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}
class BlogController {
    /** GET /blogs — public, published posts, optional ?category=&page=&limit= */
    async getBlogs(req, res) {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const filter = { isPublished: true };
        if (req.query.category && req.query.category !== 'All') {
            filter.category = req.query.category;
        }
        const [blogs, total] = await Promise.all([
            Blog_1.default.find(filter).sort({ featured: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
            Blog_1.default.countDocuments(filter),
        ]);
        res.json({
            success: true,
            data: {
                blogs,
                total,
                page,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    /** GET /blogs/:slug — public */
    async getBlogBySlug(req, res) {
        const blog = await Blog_1.default.findOneAndUpdate({ slug: req.params.slug, isPublished: true }, { $inc: { views: 1 } }, { new: true }).lean();
        if (!blog)
            throw new error_1.AppError('Blog post not found', 404);
        // Related posts (same category, max 2)
        const related = await Blog_1.default.find({
            category: blog.category,
            isPublished: true,
            slug: { $ne: blog.slug },
        })
            .sort({ createdAt: -1 })
            .limit(2)
            .lean();
        res.json({ success: true, data: { blog, related } });
    }
    // ─── Admin endpoints ──────────────────────────────────────────────────────
    /** GET /admin/blogs — all posts (published + drafts) */
    async adminGetBlogs(req, res) {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const filter = {};
        if (req.query.category)
            filter.category = req.query.category;
        if (req.query.published !== undefined)
            filter.isPublished = req.query.published === 'true';
        const [blogs, total] = await Promise.all([
            Blog_1.default.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            Blog_1.default.countDocuments(filter),
        ]);
        res.json({ success: true, data: { blogs, total, page, totalPages: Math.ceil(total / limit) } });
    }
    /** POST /admin/blogs */
    async createBlog(req, res) {
        const { title, excerpt, content, category, author, coverImage, tags, featured, isPublished } = req.body;
        if (!title?.trim())
            throw new error_1.AppError('Title is required', 400);
        if (!excerpt?.trim())
            throw new error_1.AppError('Excerpt is required', 400);
        if (!content?.trim())
            throw new error_1.AppError('Content is required', 400);
        const slug = slugify(title);
        // Ensure slug is unique
        const existing = await Blog_1.default.findOne({ slug });
        const finalSlug = existing ? `${slug}-${Date.now()}` : slug;
        const blog = await Blog_1.default.create({
            title: title.trim(),
            slug: finalSlug,
            excerpt: excerpt.trim(),
            content: content.trim(),
            category: category || 'Updates',
            author: author?.trim() || 'Vendorspot Team',
            coverImage: coverImage || undefined,
            tags: Array.isArray(tags) ? tags : [],
            featured: !!featured,
            isPublished: !!isPublished,
        });
        logger_1.logger.info(`✅ Blog created: "${blog.title}" (${blog.slug})`);
        res.status(201).json({ success: true, message: 'Blog post created', data: { blog } });
    }
    /** PUT /admin/blogs/:id */
    async updateBlog(req, res) {
        const blog = await Blog_1.default.findById(req.params.id);
        if (!blog)
            throw new error_1.AppError('Blog post not found', 404);
        const { title, excerpt, content, category, author, coverImage, tags, featured, isPublished } = req.body;
        if (title !== undefined)
            blog.title = title.trim();
        if (excerpt !== undefined)
            blog.excerpt = excerpt.trim();
        if (content !== undefined)
            blog.content = content.trim();
        if (category !== undefined)
            blog.category = category;
        if (author !== undefined)
            blog.author = author.trim();
        if (coverImage !== undefined)
            blog.coverImage = coverImage || undefined;
        if (tags !== undefined)
            blog.tags = Array.isArray(tags) ? tags : [];
        if (featured !== undefined)
            blog.featured = !!featured;
        if (isPublished !== undefined)
            blog.isPublished = !!isPublished;
        await blog.save();
        logger_1.logger.info(`✅ Blog updated: "${blog.title}"`);
        res.json({ success: true, message: 'Blog post updated', data: { blog } });
    }
    /** DELETE /admin/blogs/:id */
    async deleteBlog(req, res) {
        const blog = await Blog_1.default.findByIdAndDelete(req.params.id);
        if (!blog)
            throw new error_1.AppError('Blog post not found', 404);
        logger_1.logger.info(`🗑️ Blog deleted: "${blog.title}"`);
        res.json({ success: true, message: 'Blog post deleted' });
    }
    /** POST /admin/blogs/upload-image — upload cover image to Cloudinary */
    async uploadImage(req, res) {
        if (!req.file)
            throw new error_1.AppError('No image file provided', 400);
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary_1.default.uploader.upload_stream({
                folder: 'blog/covers',
                transformation: [{ width: 1200, height: 630, crop: 'fill', quality: 'auto' }],
            }, (error, result) => { if (error)
                reject(error);
            else
                resolve(result); });
            stream.end(req.file.buffer);
        });
        res.json({
            success: true,
            message: 'Image uploaded',
            data: { url: result.secure_url, publicId: result.public_id },
        });
    }
}
exports.BlogController = BlogController;
exports.blogController = new BlogController();
//# sourceMappingURL=blog.controller.js.map