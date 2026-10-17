// routes/payment-link.routes.ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import { paymentLinkController } from '../controllers/payment-link.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validate } from '../middleware/validation';
import { UserRole } from '../types';

const router = Router();
const c = paymentLinkController;

// Buyers hit the pay endpoint without an account, so cap attempts per IP
const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many payment attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

const payValidation = [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Enter your full name'),
  body('email').trim().isEmail().withMessage('Enter a valid email address'),
  body('phone').optional({ checkFalsy: true }).matches(/^(\+234|0)[789]\d{9}$/).withMessage('Enter a valid Nigerian phone number'),
  body('amount').optional({ checkFalsy: true }).isFloat({ gt: 0 }).withMessage('Enter a valid amount'),
  body('note').optional().isString().isLength({ max: 300 }),
];

const createValidation = [
  body('type').isIn(['PAYMENT', 'PRODUCT']).withMessage('type must be PAYMENT or PRODUCT'),
  body('title').optional().isString().isLength({ max: 120 }),
  body('description').optional().isString().isLength({ max: 500 }),
  body('singleUse').optional().isBoolean(),
];

// ─── Public (buyer) ──────────────────────────────────────────────────────────
router.get('/public/:code', asyncHandler(c.getPublicLink.bind(c)));
router.post('/public/:code/pay', payLimiter, validate(payValidation), asyncHandler(c.initializePublicPayment.bind(c)));
router.get('/public/verify/:reference', asyncHandler(c.verifyPublicPayment.bind(c)));

// ─── Admin ───────────────────────────────────────────────────────────────────
const admins = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANCIAL_ADMIN, UserRole.SUPPORT_ADMIN];
const moneyAdmins = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANCIAL_ADMIN];
router.get('/admin/links', authenticate, authorize(...admins), asyncHandler(c.adminListLinks.bind(c)));
router.get('/admin/payments', authenticate, authorize(...admins), asyncHandler(c.adminListPayments.bind(c)));
router.patch('/admin/links/:id/status', authenticate, authorize(...admins), asyncHandler(c.adminSetLinkStatus.bind(c)));
router.post('/admin/payments/:id/reverse', authenticate, authorize(...moneyAdmins), asyncHandler(c.adminReversePayment.bind(c)));

// ─── Vendor ──────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorize(UserRole.VENDOR), validate(createValidation), asyncHandler(c.createLink.bind(c)));
router.get('/', authenticate, authorize(UserRole.VENDOR), asyncHandler(c.getMyLinks.bind(c)));
router.get('/payments', authenticate, authorize(UserRole.VENDOR), asyncHandler(c.getMyPayments.bind(c)));
router.patch('/:id', authenticate, authorize(UserRole.VENDOR), asyncHandler(c.updateMyLink.bind(c)));

export default router;
