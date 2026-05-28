import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../types';
import {
  // Dashboard & Analytics
  getDashboard,
  getRevenueAnalytics,
  getUserAnalytics,
  getOrderAnalytics,

  // Admin Management (Super Admin only)
  createAdmin,
  getAllAdmins,
  updateAdminRole,
  removeAdmin,

  // User Management
  getAllUsers,
  getUserDetails,
  updateUserStatus,
  updateUserRole,
  deleteUser,

  // Vendor Management
  getAllVendors,
  getVendorDetails,
  verifyVendor,
  toggleVendorStatus,
  toggleVendorPremium,
  updateVendorCommission,
  fixLegacyCommissionRates,

  // Product Management
  getAllProducts,
  getProductDetails,
  updateProductStatus,
  toggleProductFeatured,
  deleteProduct,

  // Order Management
  getAllOrders,
  getOrderDetails,
  updateOrderStatus,
  processRefund,
  addAdminNote,

  // Financial Management
  getFinancialOverview,
  getAllTransactions,
  getTransactionById,
  getPendingWithdrawals,
  processWithdrawal,

  // Review Management
  getAllReviews,
  getReviewById,
  updateReviewStatus,
  deleteReview,

  // Dispute Management
  getAllDisputes,
  getDisputeDetails,
  markDisputeUnderReview,
  resolveDispute,
  addDisputeMessage,
  closeDispute,

  // Coupon Management
  getAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  getCouponUsage,
  toggleCouponActive,

  // Category Management
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,

  // Notification Management
  broadcastNotification,
  getNotificationHistory,

  // Account Deletion Management
  getAccountDeletionRequests,
  approveAccountDeletion,
  rejectAccountDeletion,

  // Affiliate Management
  getAllAffiliates,
  toggleAffiliateStatus,
  getAffiliateLinks,

  // Challenge Management
  getAllChallenges,
  createChallenge,
  updateChallenge,
  deleteChallenge,

  // Reports
  getSalesReport,
  getVendorReport,
  getProductReport,

  // Misc
  getActivityLog,
  globalSearch,

  // App Version
  getAppVersionConfig,
  updateAppVersionConfig,

  // Rewards & Points
  getRewardsOverview,
  getRewardsUsers,
  adjustUserPoints,
  getPointsTransactions,

  // Challenge Leaderboard
  getChallengeLeaderboard,
} from '../controllers/admin.controller';
import { auditMiddleware } from '../middleware/audit';
import { asyncHandler } from '../middleware/error';
import { aiChatController } from '../controllers/ai-chat.controller';

const router = Router();

// All admin routes require authentication
router.use(authenticate);

// Audit all admin actions (POST, PUT, PATCH, DELETE)
router.use(auditMiddleware);

// Helper: all admin roles
const allAdmins = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCIAL_ADMIN];

// Helper: general admins (not financial-only)
const generalAdmins = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

// Helper: financial admins
const financialAdmins = [UserRole.FINANCIAL_ADMIN, UserRole.SUPER_ADMIN];

// ================================================================
// DASHBOARD & ANALYTICS
// ================================================================
router.get('/dashboard', authorize(...allAdmins), getDashboard);
router.get('/analytics/revenue', authorize(...financialAdmins, UserRole.ADMIN), getRevenueAnalytics);
router.get('/analytics/users', authorize(...allAdmins), getUserAnalytics);
router.get('/analytics/orders', authorize(...allAdmins), getOrderAnalytics);

// ================================================================
// ADMIN MANAGEMENT (SUPER_ADMIN ONLY)
// ================================================================
router.post('/admins/create', authorize(UserRole.SUPER_ADMIN), createAdmin);
router.get('/admins', authorize(UserRole.SUPER_ADMIN), getAllAdmins);
router.put('/admins/:id/role', authorize(UserRole.SUPER_ADMIN), updateAdminRole);
router.delete('/admins/:id', authorize(UserRole.SUPER_ADMIN), removeAdmin);

// ================================================================
// USER MANAGEMENT
// ================================================================
router.get('/users', authorize(...generalAdmins), getAllUsers);
router.get('/users/:id', authorize(...generalAdmins), getUserDetails);
router.put('/users/:id/status', authorize(...generalAdmins), updateUserStatus);
router.put('/users/:id/role', authorize(UserRole.SUPER_ADMIN), updateUserRole);
router.delete('/users/:id', authorize(UserRole.SUPER_ADMIN), deleteUser);

// ================================================================
// VENDOR MANAGEMENT
// ================================================================
router.get('/vendors', authorize(...generalAdmins), getAllVendors);
router.get('/vendors/:id', authorize(...generalAdmins), getVendorDetails);
router.put('/vendors/:id/verify', authorize(...generalAdmins), verifyVendor);
router.put('/vendors/:id/status', authorize(...generalAdmins), toggleVendorStatus);
router.put('/vendors/:id/premium', authorize(...generalAdmins), toggleVendorPremium);
router.put('/vendors/:id/commission', authorize(...allAdmins), updateVendorCommission);
router.post('/vendors/fix-commission-rates', authorize(UserRole.SUPER_ADMIN), fixLegacyCommissionRates);

// ================================================================
// PRODUCT MANAGEMENT
// ================================================================
router.get('/products', authorize(...generalAdmins), getAllProducts);
router.get('/products/:id', authorize(...generalAdmins), getProductDetails);
router.put('/products/:id/status', authorize(...generalAdmins), updateProductStatus);
router.put('/products/:id/featured', authorize(...generalAdmins), toggleProductFeatured);
router.delete('/products/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), deleteProduct);

// ================================================================
// ORDER MANAGEMENT
// ================================================================
router.get('/orders', authorize(...allAdmins), getAllOrders);
router.get('/orders/:id', authorize(...allAdmins), getOrderDetails);
router.put('/orders/:id/status', authorize(...generalAdmins), updateOrderStatus);
router.post('/orders/:id/refund', authorize(...financialAdmins, UserRole.ADMIN), processRefund);
router.put('/orders/:id/note', authorize(...generalAdmins), addAdminNote);

// ================================================================
// FINANCIAL MANAGEMENT
// ================================================================
router.get('/finance/overview', authorize(...financialAdmins, UserRole.ADMIN), getFinancialOverview);
router.get('/finance/transactions', authorize(...financialAdmins, UserRole.ADMIN), getAllTransactions);
router.get('/finance/transactions/:transactionId', authorize(...financialAdmins, UserRole.ADMIN), getTransactionById);
router.get('/finance/withdrawals', authorize(...financialAdmins, UserRole.ADMIN), getPendingWithdrawals);
router.post('/finance/withdrawals/:walletId/:transactionId/process', authorize(...financialAdmins), processWithdrawal);

// ================================================================
// REVIEW MANAGEMENT
// ================================================================
router.get('/reviews', authorize(...generalAdmins), getAllReviews);
router.get('/reviews/:id', authorize(...generalAdmins), getReviewById);
router.put('/reviews/:id/status', authorize(...generalAdmins), updateReviewStatus);
router.delete('/reviews/:id', authorize(...generalAdmins), deleteReview);

// ================================================================
// DISPUTE MANAGEMENT
// ================================================================
router.get('/disputes', authorize(...generalAdmins), getAllDisputes);
router.get('/disputes/:id', authorize(...generalAdmins), getDisputeDetails);
router.put('/disputes/:id/review', authorize(...generalAdmins), markDisputeUnderReview);
router.put('/disputes/:id/resolve', authorize(...generalAdmins), resolveDispute);
router.put('/disputes/:id/close', authorize(...generalAdmins), closeDispute);
router.post('/disputes/:id/message', authorize(...generalAdmins), addDisputeMessage);

// ================================================================
// COUPON MANAGEMENT
// ================================================================
router.get('/coupons', authorize(...allAdmins), getAllCoupons);
router.post('/coupons', authorize(...generalAdmins), createCoupon);
router.put('/coupons/:id', authorize(...generalAdmins), updateCoupon);
router.put('/coupons/:id/toggle', authorize(...generalAdmins), toggleCouponActive);
router.get('/coupons/:id/usage', authorize(...allAdmins), getCouponUsage);
router.delete('/coupons/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), deleteCoupon);

// ================================================================
// CATEGORY MANAGEMENT
// ================================================================
router.get('/categories', authorize(...allAdmins), getAllCategories);
router.post('/categories', authorize(...generalAdmins), createCategory);
router.put('/categories/:id', authorize(...generalAdmins), updateCategory);
router.put('/categories/:id/toggle', authorize(...generalAdmins), toggleCategoryStatus);
router.delete('/categories/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), deleteCategory);

// ================================================================
// NOTIFICATION MANAGEMENT
// ================================================================
router.post('/notifications/broadcast', authorize(...generalAdmins), broadcastNotification);
router.get('/notifications', authorize(...allAdmins), getNotificationHistory);

// ================================================================
// ACCOUNT DELETION MANAGEMENT
// ================================================================
router.get('/account-deletions', authorize(...generalAdmins), getAccountDeletionRequests);
router.post('/account-deletions/:id/approve', authorize(...generalAdmins), approveAccountDeletion);
router.post('/account-deletions/:id/reject', authorize(...generalAdmins), rejectAccountDeletion);

// ================================================================
// AFFILIATE MANAGEMENT
// ================================================================
router.get('/affiliates', authorize(...generalAdmins), getAllAffiliates);
router.get('/affiliates/:userId/links', authorize(...generalAdmins), getAffiliateLinks);
router.put('/affiliates/:userId/status', authorize(...generalAdmins), toggleAffiliateStatus);

// ================================================================
// CHALLENGE MANAGEMENT
// ================================================================
router.get('/challenges', authorize(...generalAdmins), getAllChallenges);
router.post('/challenges', authorize(...generalAdmins), createChallenge);
router.put('/challenges/:id', authorize(...generalAdmins), updateChallenge);
router.delete('/challenges/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), deleteChallenge);
router.get('/challenges/:id/leaderboard', authorize(...allAdmins), getChallengeLeaderboard);

// ================================================================
// REPORTS
// ================================================================
router.get('/reports/sales', authorize(...allAdmins), getSalesReport);
router.get('/reports/vendors', authorize(...allAdmins), getVendorReport);
router.get('/reports/products', authorize(...allAdmins), getProductReport);

// ================================================================
// MISC
// ================================================================
router.get('/activity-log', authorize(...allAdmins), getActivityLog);
router.get('/search', authorize(...allAdmins), globalSearch);

// ================================================================
// REWARDS & POINTS MANAGEMENT
// ================================================================
router.get('/rewards/overview', authorize(...allAdmins), getRewardsOverview);
router.get('/rewards/users', authorize(...generalAdmins), getRewardsUsers);
router.post('/rewards/users/:userId/adjust', authorize(...generalAdmins), adjustUserPoints);
router.get('/rewards/transactions', authorize(...allAdmins), getPointsTransactions);

// ================================================================
// APP VERSION MANAGEMENT
// ================================================================
router.get('/app-version', authorize(...allAdmins), getAppVersionConfig);
router.put('/app-version', authorize(...generalAdmins), updateAppVersionConfig);

// ================================================================
// AI SUPPORT SUGGESTIONS
// ================================================================
router.post('/ai/suggest', authorize(...allAdmins), asyncHandler(aiChatController.adminSuggest.bind(aiChatController)));

export default router;
