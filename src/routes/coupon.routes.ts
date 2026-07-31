import { Router } from 'express';
import { couponController } from '../controllers/coupon.controller';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { body } from 'express-validator';
import { validate } from '../middleware/validation';
import { UserRole } from '../types';

const router = Router();

const createCouponValidation = [
  body('code').notEmpty().withMessage('Coupon code is required'),
  body('discountType').isIn(['percentage', 'fixed']).withMessage('Invalid discount type'),
  body('discountValue').isFloat({ min: 0 }).withMessage('Discount value must be positive'),
  body('validFrom').isISO8601().withMessage('Valid from date is required'),
  body('validUntil').isISO8601().withMessage('Valid until date is required'),
];

// Public route - validate coupon
router.get(
  '/validate/:code',
  optionalAuth,
  asyncHandler(couponController.validateCoupon.bind(couponController))
);

// Authenticated user route — get my assigned coupons
router.get(
  '/my',
  authenticate,
  asyncHandler(couponController.getMyCoupons.bind(couponController))
);

// Vendor-scoped coupon management
const vendorCouponValidation = [
  body('code').notEmpty().withMessage('Coupon code is required'),
  body('discountType').isIn(['percentage', 'fixed']).withMessage('Invalid discount type'),
  body('discountValue').isFloat({ min: 0 }).withMessage('Discount value must be positive'),
  body('validFrom').isISO8601().withMessage('Valid from date is required'),
  body('validUntil').isISO8601().withMessage('Valid until date is required'),
];

router.get(
  '/vendor',
  authenticate,
  authorize(UserRole.VENDOR),
  asyncHandler(couponController.getVendorCoupons.bind(couponController))
);

router.post(
  '/vendor',
  authenticate,
  authorize(UserRole.VENDOR),
  validate(vendorCouponValidation),
  asyncHandler(couponController.createVendorCoupon.bind(couponController))
);

router.put(
  '/vendor/:id',
  authenticate,
  authorize(UserRole.VENDOR),
  asyncHandler(couponController.updateVendorCoupon.bind(couponController))
);

router.delete(
  '/vendor/:id',
  authenticate,
  authorize(UserRole.VENDOR),
  asyncHandler(couponController.deleteVendorCoupon.bind(couponController))
);

// Admin/Vendor routes
router.use(authenticate);
router.use(authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN));

router.get('/', asyncHandler(couponController.getCoupons.bind(couponController)));
router.get('/:id', asyncHandler(couponController.getCoupon.bind(couponController)));
router.get('/:id/stats', asyncHandler(couponController.getCouponStats.bind(couponController)));

router.post(
  '/',
  validate(createCouponValidation),
  asyncHandler(couponController.createCoupon.bind(couponController))
);

router.put('/:id', asyncHandler(couponController.updateCoupon.bind(couponController)));

router.delete('/:id', asyncHandler(couponController.deleteCoupon.bind(couponController)));

export default router;
