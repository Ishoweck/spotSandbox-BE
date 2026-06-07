import { Request, Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import { AppError } from '../middleware/error';
import Blog from '../models/Blog';
import cloudinary from '../utils/cloudinary';
import { logger } from '../utils/logger';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export class BlogController {
  /** GET /blogs — public, published posts, optional ?category=&page=&limit= */
  async getBlogs(req: Request, res: Response<ApiResponse>): Promise<void> {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const skip  = (page - 1) * limit;

    const filter: Record<string, unknown> = { isPublished: true };
    if (req.query.category && req.query.category !== 'All') {
      filter.category = req.query.category;
    }

    const [blogs, total] = await Promise.all([
      Blog.find(filter).sort({ featured: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Blog.countDocuments(filter),
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
  async getBlogBySlug(req: Request, res: Response<ApiResponse>): Promise<void> {
    const blog = await Blog.findOneAndUpdate(
      { slug: req.params.slug, isPublished: true },
      { $inc: { views: 1 } },
      { new: true }
    ).lean();

    if (!blog) throw new AppError('Blog post not found', 404);

    // Related posts (same category, max 2)
    const related = await Blog.find({
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
  async adminGetBlogs(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const skip  = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.published !== undefined) filter.isPublished = req.query.published === 'true';

    const [blogs, total] = await Promise.all([
      Blog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Blog.countDocuments(filter),
    ]);

    res.json({ success: true, data: { blogs, total, page, totalPages: Math.ceil(total / limit) } });
  }

  /** POST /admin/blogs */
  async createBlog(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { title, excerpt, content, category, author, coverImage, tags, featured, isPublished } = req.body;

    if (!title?.trim())   throw new AppError('Title is required', 400);
    if (!excerpt?.trim()) throw new AppError('Excerpt is required', 400);
    if (!content?.trim()) throw new AppError('Content is required', 400);

    const slug = slugify(title);

    // Ensure slug is unique
    const existing = await Blog.findOne({ slug });
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    const blog = await Blog.create({
      title:       title.trim(),
      slug:        finalSlug,
      excerpt:     excerpt.trim(),
      content:     content.trim(),
      category:    category || 'Updates',
      author:      author?.trim() || 'Vendorspot Team',
      coverImage:  coverImage || undefined,
      tags:        Array.isArray(tags) ? tags : [],
      featured:    !!featured,
      isPublished: !!isPublished,
    });

    logger.info(`✅ Blog created: "${blog.title}" (${blog.slug})`);
    res.status(201).json({ success: true, message: 'Blog post created', data: { blog } });
  }

  /** PUT /admin/blogs/:id */
  async updateBlog(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const blog = await Blog.findById(req.params.id);
    if (!blog) throw new AppError('Blog post not found', 404);

    const { title, excerpt, content, category, author, coverImage, tags, featured, isPublished } = req.body;

    if (title !== undefined)       blog.title       = title.trim();
    if (excerpt !== undefined)     blog.excerpt     = excerpt.trim();
    if (content !== undefined)     blog.content     = content.trim();
    if (category !== undefined)    blog.category    = category;
    if (author !== undefined)      blog.author      = author.trim();
    if (coverImage !== undefined)  blog.coverImage  = coverImage || undefined;
    if (tags !== undefined)        blog.tags        = Array.isArray(tags) ? tags : [];
    if (featured !== undefined)    blog.featured    = !!featured;
    if (isPublished !== undefined) blog.isPublished = !!isPublished;

    await blog.save();
    logger.info(`✅ Blog updated: "${blog.title}"`);
    res.json({ success: true, message: 'Blog post updated', data: { blog } });
  }

  /** DELETE /admin/blogs/:id */
  async deleteBlog(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) throw new AppError('Blog post not found', 404);

    logger.info(`🗑️ Blog deleted: "${blog.title}"`);
    res.json({ success: true, message: 'Blog post deleted' });
  }

  /** POST /admin/blogs/upload-image — upload cover image to Cloudinary */
  async uploadImage(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    if (!req.file) throw new AppError('No image file provided', 400);

    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'blog/covers',
          transformation: [{ width: 1200, height: 630, crop: 'fill', quality: 'auto' }],
        },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file!.buffer);
    });

    res.json({
      success: true,
      message: 'Image uploaded',
      data: { url: result.secure_url, publicId: result.public_id },
    });
  }
}

export const blogController = new BlogController();
