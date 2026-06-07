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
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const CATEGORIES = ['Tips & Guides', 'Vendor Stories', 'Updates', 'Safety'];
const blogSchema = new mongoose_1.Schema({
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    excerpt: { type: String, required: true, maxlength: 500 },
    content: { type: String, required: true },
    coverImage: { type: String },
    category: { type: String, required: true, default: 'Updates', enum: CATEGORIES },
    author: { type: String, required: true, default: 'Vendorspot Team' },
    readTime: { type: String, default: '3 min read' },
    featured: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
    tags: [{ type: String, trim: true }],
    views: { type: Number, default: 0 },
}, { timestamps: true });
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
const Blog = mongoose_1.default.model('Blog', blogSchema);
exports.default = Blog;
//# sourceMappingURL=Blog.js.map