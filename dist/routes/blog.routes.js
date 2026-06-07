"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const blog_controller_1 = require("../controllers/blog.controller");
const auth_1 = require("../middleware/auth");
const error_1 = require("../middleware/error");
const types_1 = require("../types");
const router = (0, express_1.Router)();
const imageUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/'))
            cb(null, true);
        else
            cb(new Error('Only image files are allowed'));
    },
});
// ── Public ────────────────────────────────────────────────────────────────
router.get('/', (0, error_1.asyncHandler)(blog_controller_1.blogController.getBlogs.bind(blog_controller_1.blogController)));
router.get('/:slug', (0, error_1.asyncHandler)(blog_controller_1.blogController.getBlogBySlug.bind(blog_controller_1.blogController)));
// ── Admin ─────────────────────────────────────────────────────────────────
router.use(auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN));
router.get('/admin/all', (0, error_1.asyncHandler)(blog_controller_1.blogController.adminGetBlogs.bind(blog_controller_1.blogController)));
router.post('/', (0, error_1.asyncHandler)(blog_controller_1.blogController.createBlog.bind(blog_controller_1.blogController)));
router.put('/:id', (0, error_1.asyncHandler)(blog_controller_1.blogController.updateBlog.bind(blog_controller_1.blogController)));
router.delete('/:id', (0, error_1.asyncHandler)(blog_controller_1.blogController.deleteBlog.bind(blog_controller_1.blogController)));
router.post('/upload-image', imageUpload.single('image'), (0, error_1.asyncHandler)(blog_controller_1.blogController.uploadImage.bind(blog_controller_1.blogController)));
exports.default = router;
//# sourceMappingURL=blog.routes.js.map