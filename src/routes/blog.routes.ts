import { Router } from 'express';
import multer from 'multer';
import { blogController } from '../controllers/blog.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { UserRole } from '../types';

const router = Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ── Public ────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(blogController.getBlogs.bind(blogController)));
router.get('/:slug', asyncHandler(blogController.getBlogBySlug.bind(blogController)));

// ── Admin ─────────────────────────────────────────────────────────────────
router.use(authenticate, authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN));

router.get('/admin/all', asyncHandler(blogController.adminGetBlogs.bind(blogController)));
router.post('/', asyncHandler(blogController.createBlog.bind(blogController)));
router.put('/:id', asyncHandler(blogController.updateBlog.bind(blogController)));
router.delete('/:id', asyncHandler(blogController.deleteBlog.bind(blogController)));
router.post('/upload-image', imageUpload.single('image'), asyncHandler(blogController.uploadImage.bind(blogController)));

export default router;
