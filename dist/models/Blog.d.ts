import mongoose, { Document } from 'mongoose';
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
declare const Blog: mongoose.Model<IBlog, {}, {}, {}, mongoose.Document<unknown, {}, IBlog, {}, {}> & IBlog & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export default Blog;
//# sourceMappingURL=Blog.d.ts.map