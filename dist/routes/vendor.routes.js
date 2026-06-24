"use strict";
// ============================================================
// COMPLETE VENDOR ROUTES
// File: routes/vendor.routes.ts
// Replace your vendor.routes.ts with this file
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const vendor_controller_1 = require("../controllers/vendor.controller");
const auth_1 = require("../middleware/auth");
const error_1 = require("../middleware/error");
const express_validator_1 = require("express-validator");
const validation_1 = require("../middleware/validation");
const types_1 = require("../types");
const router = (0, express_1.Router)();
// ============================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================
/**
 * GET /api/v1/vendor/banks
 * Get Nigerian banks list from Paystack
 */
router.get('/banks', (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getBanks.bind(vendor_controller_1.vendorController)));
/**
 * GET /api/v1/vendor/top
 * Get top vendors for home screen
 * Query: ?limit=10&sortBy=rating
 */
router.get('/top', auth_1.optionalAuth, (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getTopVendors.bind(vendor_controller_1.vendorController)));
/**
 * GET /api/v1/vendor/public/:vendorId
 * Get public vendor profile with products
 */
router.get('/public/:vendorId', auth_1.optionalAuth, (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getPublicVendorProfile.bind(vendor_controller_1.vendorController)));
// ============================================================
// AUTHENTICATED ROUTES
// ============================================================
router.use(auth_1.authenticate);
/**
 * POST /api/v1/vendor/:vendorId/follow
 * Follow a vendor
 */
router.post('/:vendorId/follow', (0, error_1.asyncHandler)(vendor_controller_1.vendorController.followVendor.bind(vendor_controller_1.vendorController)));
/**
 * DELETE /api/v1/vendor/:vendorId/follow
 * Unfollow a vendor
 */
router.delete('/:vendorId/follow', (0, error_1.asyncHandler)(vendor_controller_1.vendorController.unfollowVendor.bind(vendor_controller_1.vendorController)));
/**
 * GET /api/v1/vendor/following
 * Get user's followed vendors
 */
router.get('/following', (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getFollowedVendors.bind(vendor_controller_1.vendorController)));
// ============================================================
// VENDOR PROFILE MANAGEMENT
// ============================================================
const createProfileValidation = [
    (0, express_validator_1.body)('businessName').notEmpty().withMessage('Business name is required'),
    (0, express_validator_1.body)('businessAddress.street').notEmpty().withMessage('Street address is required'),
    (0, express_validator_1.body)('businessAddress.city').notEmpty().withMessage('City is required'),
    (0, express_validator_1.body)('businessAddress.state').notEmpty().withMessage('State is required'),
    (0, express_validator_1.body)('businessPhone').notEmpty().withMessage('Business phone is required'),
    (0, express_validator_1.body)('businessEmail').isEmail().withMessage('Valid business email is required'),
];
/**
 * POST /api/v1/vendor/profile
 * Create vendor profile
 */
router.post('/profile', (0, validation_1.validate)(createProfileValidation), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.createVendorProfile.bind(vendor_controller_1.vendorController)));
/**
 * GET /api/v1/vendor/profile
 * Get own vendor profile
 */
router.get('/profile', (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getVendorProfile.bind(vendor_controller_1.vendorController)));
/**
 * POST /api/v1/vendor/profile/set-referrer
 * Record who referred this vendor (one-time, before first sale)
 */
router.post('/profile/set-referrer', (0, error_1.asyncHandler)(vendor_controller_1.setVendorReferrer));
/**
 * POST /api/v1/vendor/profile/survey
 * Submit business onboarding survey
 */
router.post('/profile/survey', (0, error_1.asyncHandler)(vendor_controller_1.vendorController.submitBusinessSurvey.bind(vendor_controller_1.vendorController)));
/**
 * PUT /api/v1/vendor/profile
 * Update vendor profile
 */
router.put('/profile', (0, error_1.asyncHandler)(vendor_controller_1.vendorController.updateVendorProfile.bind(vendor_controller_1.vendorController)));
// ============================================================
// KYC AND PAYOUT
// ============================================================
const kycUploadValidation = [
    (0, express_validator_1.body)('documents').isArray({ min: 1 }).withMessage('At least one document is required'),
];
/**
 * POST /api/v1/vendor/kyc/upload
 * Upload KYC documents
 */
router.post('/kyc/upload', (0, validation_1.validate)(kycUploadValidation), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.uploadKYCDocuments.bind(vendor_controller_1.vendorController)));
const payoutDetailsValidation = [
    (0, express_validator_1.body)('bankName').notEmpty().withMessage('Bank name is required'),
    (0, express_validator_1.body)('accountNumber').notEmpty().withMessage('Account number is required'),
    (0, express_validator_1.body)('accountName').notEmpty().withMessage('Account name is required'),
    (0, express_validator_1.body)('bankCode').notEmpty().withMessage('Bank code is required'),
];
/**
 * PUT /api/v1/vendor/payout-details
 * Update payout/bank details
 */
router.put('/payout-details', (0, validation_1.validate)(payoutDetailsValidation), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.updatePayoutDetails.bind(vendor_controller_1.vendorController)));
// ============================================================
// ⭐ DASHBOARD AND ANALYTICS (Vendor only)
// ============================================================
/**
 * GET /api/v1/vendor/dashboard
 * Get vendor dashboard analytics with rewards tier
 */
router.get('/dashboard', (0, auth_1.authorize)(types_1.UserRole.VENDOR, types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getVendorDashboard.bind(vendor_controller_1.vendorController)));
/**
 * GET /api/v1/vendor/analytics
 * Get sales analytics
 * Query: ?period=7days|30days|90days|1year
 */
router.get('/analytics', (0, auth_1.authorize)(types_1.UserRole.VENDOR, types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getSalesAnalytics.bind(vendor_controller_1.vendorController)));
/**
 * GET /api/v1/vendor/leaderboard
 * Get vendor earnings leaderboard
 * Query: ?period=month|alltime&metric=revenue|orders&limit=20
 */
router.get('/leaderboard', (0, auth_1.authorize)(types_1.UserRole.VENDOR, types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getVendorLeaderboard.bind(vendor_controller_1.vendorController)));
// ============================================================
// ADMIN ROUTES
// ============================================================
/**
 * GET /api/v1/vendor/admin/all
 * Get all vendors (Admin only)
 */
router.get('/admin/all', (0, auth_1.authorize)(types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.getAllVendors.bind(vendor_controller_1.vendorController)));
const verifyKYCValidation = [
    (0, express_validator_1.body)('status').isIn(['verified', 'rejected']).withMessage('Invalid status'),
];
/**
 * PUT /api/v1/vendor/admin/verify/:vendorId
 * Verify vendor KYC (Admin only)
 */
router.put('/admin/verify/:vendorId', (0, auth_1.authorize)(types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, validation_1.validate)(verifyKYCValidation), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.verifyVendorKYC.bind(vendor_controller_1.vendorController)));
/**
 * PUT /api/v1/vendor/admin/toggle-status/:vendorId
 * Toggle vendor active status (Admin only)
 */
router.put('/admin/toggle-status/:vendorId', (0, auth_1.authorize)(types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.toggleVendorStatus.bind(vendor_controller_1.vendorController)));
/**
 * Vendor toggle their own store open/closed
 */
router.patch('/me/toggle-status', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.VENDOR), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.toggleMyStoreStatus.bind(vendor_controller_1.vendorController)));
/**
 * POST /api/v1/vendor/statement
 * Request account statement PDF — emailed to vendor's registered address
 */
router.post('/statement', auth_1.authenticate, (0, auth_1.authorize)(types_1.UserRole.VENDOR), (0, error_1.asyncHandler)(vendor_controller_1.vendorController.requestStatement.bind(vendor_controller_1.vendorController)));
exports.default = router;
//# sourceMappingURL=vendor.routes.js.map