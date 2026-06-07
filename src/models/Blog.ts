import mongoose, { Schema, Document } from 'mongoose';

export interface IBlog extends Document {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage?: string;
  category: string;
  author: string;
  readTime: string;
  featured: boolean;
  isPublished: boolean;
  tags: string[];
  views: number;
}

const CATEGORIES = ['Tips & Guides', 'Vendor Stories', 'Updates', 'Safety'];

const blogSchema = new Schema<IBlog>(
  {
    title:       { type: String, required: true, trim: true },
    slug:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    excerpt:     { type: String, required: true, maxlength: 500 },
    content:     { type: String, required: true },
    coverImage:  { type: String },
    category:    { type: String, required: true, default: 'Updates', enum: CATEGORIES },
    author:      { type: String, required: true, default: 'Vendorspot Team' },
    readTime:    { type: String, default: '3 min read' },
    featured:    { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
    tags:        [{ type: String, trim: true }],
    views:       { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Auto-calculate read time before saving
blogSchema.pre('save', function (next) {
  if (this.isModified('content')) {
    const words = this.content.trim().split(/\s+/).length;
    const minutes = Math.max(1, Math.round(words / 220));
    this.readTime = `${minutes} min read`;
  }
  next();
});

blogSchema.index({ slug: 1 });
blogSchema.index({ isPublished: 1, createdAt: -1 });
blogSchema.index({ category: 1, isPublished: 1 });

const Blog = mongoose.model<IBlog>('Blog', blogSchema);
export default Blog;
