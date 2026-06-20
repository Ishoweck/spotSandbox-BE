// ============================================================
// COMPLETE VENDOR ROUTES
// File: routes/vendor.routes.ts
// Replace your vendor.routes.ts with this file
// ============================================================

import { Router } from 'express';
import { vendorController, setVendorReferrer } from '../controllers/vendor.controller';
import { authenticate, authorize, optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { body } from 'express-validator';
import { validate } from '../middleware/validation';
import { UserRole } from '../types';

const router = Router();

// ============================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================

/**
 * GET /api/v1/vendor/banks
 * Get Nigerian banks list from Paystack
 */
router.get(
  '/banks',
  asyncHandler(vendorController.getBanks.bind(vendorController))
);

/**
 * GET /api/v1/vendor/top
 * Get top vendors for home screen
 * Query: ?limit=10&sortBy=rating
 */
router.get(
  '/top',
  optionalAuth,
  asyncHandler(vendorController.getTopVendors.bind(vendorController))
);

/**
 * GET /api/v1/vendor/public/:vendorId
 * Get public vendor profile with products
 */
router.get(
  '/public/:vendorId',
  optionalAuth,
  asyncHandler(vendorController.getPublicVendorProfile.bind(vendorController))
);

// ============================================================
// AUTHENTICATED ROUTES
// ============================================================

router.use(authenticate);

/**
 * POST /api/v1/vendor/:vendorId/follow
 * Follow a vendor
 */
router.post(
  '/:vendorId/follow',
  asyncHandler(vendorController.followVendor.bind(vendorController))
);

/**
 * DELETE /api/v1/vendor/:vendorId/follow
 * Unfollow a vendor
 */
router.delete(
  '/:vendorId/follow',
  asyncHandler(vendorController.unfollowVendor.bind(vendorController))
);

/**
 * GET /api/v1/vendor/following
 * Get user's followed vendors
 */
router.get(
  '/following',
  asyncHandler(vendorController.getFollowedVendors.bind(vendorController))
);

// ============================================================
// VENDOR PROFILE MANAGEMENT
// ============================================================

const createProfileValidation = [
  body('businessName').notEmpty().withMessage('Business name is required'),
  body('businessAddress.street').notEmpty().withMessage('Street address is required'),
  body('businessAddress.city').notEmpty().withMessage('City is required'),
  body('businessAddress.state').notEmpty().withMessage('State is required'),
  body('businessPhone').notEmpty().withMessage('Business phone is required'),
  body('businessEmail').isEmail().withMessage('Valid business email is required'),
];

/**
 * POST /api/v1/vendor/profile
 * Create vendor profile
 */
router.post(
  '/profile',
  validate(createProfileValidation),
  asyncHandler(vendorController.createVendorProfile.bind(vendorController))
);

/**
 * GET /api/v1/vendor/profile
 * Get own vendor profile
 */
router.get(
  '/profile',
  asyncHandler(vendorController.getVendorProfile.bind(vendorController))
);

/**
 * POST /api/v1/vendor/profile/set-referrer
 * Record who referred this vendor (one-time, before first sale)
 */
router.post(
  '/profile/set-referrer',
  asyncHandler(setVendorReferrer)
);

/**
 * PUT /api/v1/vendor/profile
 * Update vendor profile
 */
router.put(
  '/profile',
  asyncHandler(vendorController.updateVendorProfile.bind(vendorController))
);

// ============================================================
// KYC AND PAYOUT
// ============================================================

const kycUploadValidation = [
  body('documents').isArray({ min: 1 }).withMessage('At least one document is required'),
];

/**
 * POST /api/v1/vendor/kyc/upload
 * Upload KYC documents
 */
router.post(
  '/kyc/upload',
  validate(kycUploadValidation),
  asyncHandler(vendorController.uploadKYCDocuments.bind(vendorController))
);

const payoutDetailsValidation = [
  body('bankName').notEmpty().withMessage('Bank name is required'),
  body('accountNumber').notEmpty().withMessage('Account number is required'),
  body('accountName').notEmpty().withMessage('Account name is required'),
  body('bankCode').notEmpty().withMessage('Bank code is required'),
];

/**
 * PUT /api/v1/vendor/payout-details
 * Update payout/bank details
 */
router.put(
  '/payout-details',
  validate(payoutDetailsValidation),
  asyncHandler(vendorController.updatePayoutDetails.bind(vendorController))
);

// ============================================================
// ⭐ DASHBOARD AND ANALYTICS (Vendor only)
// ============================================================

/**
 * GET /api/v1/vendor/dashboard
 * Get vendor dashboard analytics with rewards tier
 */
router.get(
  '/dashboard',
  authorize(UserRole.VENDOR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(vendorController.getVendorDashboard.bind(vendorController))
);

/**
 * GET /api/v1/vendor/analytics
 * Get sales analytics
 * Query: ?period=7days|30days|90days|1year
 */
router.get(
  '/analytics',
  authorize(UserRole.VENDOR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(vendorController.getSalesAnalytics.bind(vendorController))
);

// ============================================================
// ADMIN ROUTES
// ============================================================

/**
 * GET /api/v1/vendor/admin/all
 * Get all vendors (Admin only)
 */
router.get(
  '/admin/all',
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(vendorController.getAllVendors.bind(vendorController))
);

const verifyKYCValidation = [
  body('status').isIn(['verified', 'rejected']).withMessage('Invalid status'),
];

/**
 * PUT /api/v1/vendor/admin/verify/:vendorId
 * Verify vendor KYC (Admin only)
 */
router.put(
  '/admin/verify/:vendorId',
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validate(verifyKYCValidation),
  asyncHandler(vendorController.verifyVendorKYC.bind(vendorController))
);

/**
 * PUT /api/v1/vendor/admin/toggle-status/:vendorId
 * Toggle vendor active status (Admin only)
 */
router.put(
  '/admin/toggle-status/:vendorId',
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(vendorController.toggleVendorStatus.bind(vendorController))
);

/**
 * Vendor toggle their own store open/closed
 */
router.patch(
  '/me/toggle-status',
  authenticate,
  authorize(UserRole.VENDOR),
  asyncHandler(vendorController.toggleMyStoreStatus.bind(vendorController))
);

/**
 * POST /api/v1/vendor/statement
 * Request account statement PDF — emailed to vendor's registered address
 */
router.post(
  '/statement',
  authenticate,
  authorize(UserRole.VENDOR),
  asyncHandler(vendorController.requestStatement.bind(vendorController))
);

export default router;