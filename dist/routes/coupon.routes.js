"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const coupon_controller_1 = require("../controllers/coupon.controller");
const auth_1 = require("../middleware/auth");
const error_1 = require("../middleware/error");
const express_validator_1 = require("express-validator");
const validation_1 = require("../middleware/validation");
const types_1 = require("../types");
const router = (0, express_1.Router)();
const createCouponValidation = [
    (0, express_validator_1.body)('code').notEmpty().withMessage('Coupon code is required'),
    (0, express_validator_1.body)('discountType').isIn(['percentage', 'fixed']).withMessage('Invalid discount type'),
    (0, express_validator_1.body)('discountValue').isFloat({ min: 0 }).withMessage('Discount value must be positive'),
    (0, express_validator_1.body)('validFrom').isISO8601().withMessage('Valid from date is required'),
    (0, express_validator_1.body)('validUntil').isISO8601().withMessage('Valid until date is required'),
];
// Public route - validate coupon
router.get('/validate/:code', auth_1.optionalAuth, (0, error_1.asyncHandler)(coupon_controller_1.couponController.validateCoupon.bind(coupon_controller_1.couponController)));
// Authenticated user route — get my assigned coupons
router.get('/my', auth_1.authenticate, (0, error_1.asyncHandler)(coupon_controller_1.couponController.getMyCoupons.bind(coupon_controller_1.couponController)));
// Admin/Vendor routes
router.use(auth_1.authenticate);
router.use((0, auth_1.authorize)(types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN));
router.get('/', (0, error_1.asyncHandler)(coupon_controller_1.couponController.getCoupons.bind(coupon_controller_1.couponController)));
router.get('/:id', (0, error_1.asyncHandler)(coupon_controller_1.couponController.getCoupon.bind(coupon_controller_1.couponController)));
router.get('/:id/stats', (0, error_1.asyncHandler)(coupon_controller_1.couponController.getCouponStats.bind(coupon_controller_1.couponController)));
router.post('/', (0, validation_1.validate)(createCouponValidation), (0, error_1.asyncHandler)(coupon_controller_1.couponController.createCoupon.bind(coupon_controller_1.couponController)));
router.put('/:id', (0, error_1.asyncHandler)(coupon_controller_1.couponController.updateCoupon.bind(coupon_controller_1.couponController)));
router.delete('/:id', (0, error_1.asyncHandler)(coupon_controller_1.couponController.deleteCoupon.bind(coupon_controller_1.couponController)));
exports.default = router;
//# sourceMappingURL=coupon.routes.js.map