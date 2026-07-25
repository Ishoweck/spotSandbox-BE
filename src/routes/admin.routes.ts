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
  sendUserActivation,
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
  resolveVendorWallet,
  updateVendorAddress,
  validateVendorAddress,
  updateVendorKycDocument,

  // Outreach Management
  getOutreachList,
  updateVendorOutreach,

  // Product Management
  getAllProducts,
  getProductDetails,
  updateProductStatus,
  toggleProductFeatured,
  deleteProduct,
  updateProductPickupAddress,
  validateProductPickupAddress,

  // Order Management
  getAllOrders,
  getOrderDetails,
  updateOrderStatus,
  processRefund,
  addAdminNote,
  retryShipment,

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
  adminCreateDeletionRequest,

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

  // Address Management
  getAllAddresses,

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
import { webhookController } from '../controllers/webhook.controller';
import {
  getAllApplications as getAllAmbassadors,
  getApplication as getAmbassador,
  approveApplication as approveAmbassador,
  rejectApplication as rejectAmbassador,
  resendInvite as resendAmbassadorInvite,
  addNote as addAmbassadorNote,
  getAmbassadorReferrals,
  updateApplication as updateAmbassador,
  deleteApplication as deleteAmbassador,
} from '../controllers/ambassador.controller';
import {
  getExpenseSummary,
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  updateExpenseStatus,
  deleteExpense,
  exportExpensesPDF,
  exportExpensesCSV,
  uploadExpenseEvidence,
  deleteExpenseEvidence,
} from '../controllers/expense.controller';
import multer from 'multer';

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only images and PDFs are allowed'));
  },
});

const router = Router();

// All admin routes require authentication
router.use(authenticate);

// Never cache admin API responses — always return fresh data
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Audit all admin actions (POST, PUT, PATCH, DELETE)
router.use(auditMiddleware);

// ── Role groups ──────────────────────────────────────────────────────────────
const SA  = UserRole.SUPER_ADMIN;
const A   = UserRole.ADMIN;
const FA  = UserRole.FINANCIAL_ADMIN;
const SPA = UserRole.SUPPORT_ADMIN;
const CA  = UserRole.CONTENT_ADMIN;
const KA  = UserRole.KYC_ADMIN;
const MA  = UserRole.MARKETING_ADMIN;

const allAdmins     = [SA, A, FA, SPA, CA, KA, MA];
const generalAdmins = [SA, A];
const financialAdmins = [SA, FA];
const supportAdmins   = [SA, A, SPA];
const contentAdmins   = [SA, A, CA];
const kycAdmins       = [SA, A, KA];
const marketingAdmins = [SA, A, MA];

// ================================================================
// DASHBOARD & ANALYTICS
// ================================================================
router.get('/dashboard', authorize(...allAdmins), getDashboard);
router.get('/analytics/revenue', authorize(SA, A, FA), getRevenueAnalytics);
router.get('/analytics/users', authorize(SA, A, SPA), getUserAnalytics);
router.get('/analytics/orders', authorize(SA, A, FA, SPA), getOrderAnalytics);

// ================================================================
// ADMIN MANAGEMENT (SUPER_ADMIN ONLY)
// ================================================================
router.post('/admins/create', authorize(SA), createAdmin);
router.get('/admins', authorize(SA), getAllAdmins);
router.put('/admins/:id/role', authorize(SA), updateAdminRole);
router.delete('/admins/:id', authorize(SA), removeAdmin);

// ================================================================
// USER MANAGEMENT — general + support
// ================================================================
router.get('/users', authorize(SA, A, SPA), getAllUsers);
router.get('/users/:id', authorize(SA, A, SPA), getUserDetails);
router.put('/users/:id/status', authorize(SA, A, SPA), updateUserStatus);
router.post('/users/:id/send-activation', authorize(SA, A, SPA), sendUserActivation);
router.put('/users/:id/role', authorize(SA), updateUserRole);
router.delete('/users/:id', authorize(SA), deleteUser);

// ================================================================
// VENDOR MANAGEMENT — general + kyc
// ================================================================
router.get('/vendors', authorize(SA, A, KA), getAllVendors);
router.get('/vendors/:id', authorize(SA, A, KA), getVendorDetails);
router.put('/vendors/:id/verify', authorize(SA, A, KA), verifyVendor);
router.put('/vendors/:id/status', authorize(SA, A, KA), toggleVendorStatus);
router.put('/vendors/:id/premium', authorize(SA, A), toggleVendorPremium);
router.put('/vendors/:id/commission', authorize(SA, A, FA), updateVendorCommission);
router.put('/vendors/:id/address', authorize(SA, A, KA), updateVendorAddress);
router.post('/vendors/:id/address/validate', authorize(SA, A, KA), validateVendorAddress);
router.put('/vendors/:id/kyc/:docIndex', authorize(SA, A, KA), updateVendorKycDocument);
router.post('/vendors/:id/wallet/resolve', authorize(SA), resolveVendorWallet);
router.post('/vendors/fix-commission-rates', authorize(SA), fixLegacyCommissionRates);
router.put('/vendors/:id/outreach', authorize(...allAdmins), updateVendorOutreach);

// ================================================================
// PRODUCT MANAGEMENT — general + content
// ================================================================
router.get('/products', authorize(SA, A, CA), getAllProducts);
router.get('/products/:id', authorize(SA, A, CA), getProductDetails);
router.put('/products/:id/status', authorize(SA, A, CA), updateProductStatus);
router.put('/products/:id/featured', authorize(SA, A, CA), toggleProductFeatured);
router.delete('/products/:id', authorize(SA, A), deleteProduct);
router.put('/products/:id/pickup-address', authorize(SA, A, CA), updateProductPickupAddress);
router.post('/products/:id/pickup-address/validate', authorize(SA, A, CA), validateProductPickupAddress);

// ================================================================
// ORDER MANAGEMENT — general + support + financial
// ================================================================
router.get('/orders', authorize(SA, A, FA, SPA), getAllOrders);
router.get('/orders/:id', authorize(SA, A, FA, SPA), getOrderDetails);
router.put('/orders/:id/status', authorize(SA, A, SPA), updateOrderStatus);
router.post('/orders/:id/refund', authorize(SA, A, FA), processRefund);
router.put('/orders/:id/note', authorize(SA, A, SPA), addAdminNote);
router.post('/orders/:id/retry-shipment', authorize(SA, A, SPA), retryShipment);
router.post('/orders/:id/sync-shipment', authorize(SA, A, SPA), asyncHandler(webhookController.syncOrderShipment.bind(webhookController)));

// ================================================================
// FINANCIAL MANAGEMENT — financial + general
// ================================================================
router.get('/finance/overview', authorize(SA, A, FA), getFinancialOverview);
router.get('/finance/transactions', authorize(SA, A, FA), getAllTransactions);
router.get('/finance/transactions/:transactionId', authorize(SA, A, FA), getTransactionById);
router.get('/finance/withdrawals', authorize(SA, A, FA), getPendingWithdrawals);
router.post('/finance/withdrawals/:walletId/:transactionId/process', authorize(SA, FA), processWithdrawal);

// ================================================================
// COMPANY EXPENSE TRACKING — financial + super admin
// ================================================================
router.get('/expenses/summary',    authorize(SA, FA),        asyncHandler(getExpenseSummary));
router.get('/expenses/export/pdf', authorize(SA, FA),        asyncHandler(exportExpensesPDF));
router.get('/expenses/export/csv', authorize(SA, FA),        asyncHandler(exportExpensesCSV));
router.get('/expenses',            authorize(SA, FA),        asyncHandler(listExpenses));
router.post('/expenses',           authorize(SA, FA),        asyncHandler(createExpense));
router.get('/expenses/:id',        authorize(SA, FA),        asyncHandler(getExpense));
router.put('/expenses/:id',        authorize(SA, FA),        asyncHandler(updateExpense));
router.patch('/expenses/:id/status',   authorize(SA, FA),   asyncHandler(updateExpenseStatus));
router.post('/expenses/:id/evidence',  authorize(SA, FA),   evidenceUpload.single('file'), asyncHandler(uploadExpenseEvidence));
router.delete('/expenses/:id/evidence', authorize(SA, FA),  asyncHandler(deleteExpenseEvidence));
router.delete('/expenses/:id',         authorize(SA),        asyncHandler(deleteExpense));

// ================================================================
// REVIEW MANAGEMENT — general + content
// ================================================================
router.get('/reviews', authorize(...contentAdmins), getAllReviews);
router.get('/reviews/:id', authorize(...contentAdmins), getReviewById);
router.put('/reviews/:id/status', authorize(...contentAdmins), updateReviewStatus);
router.delete('/reviews/:id', authorize(SA, A), deleteReview);

// ================================================================
// DISPUTE MANAGEMENT — general + support
// ================================================================
router.get('/disputes', authorize(...supportAdmins), getAllDisputes);
router.get('/disputes/:id', authorize(...supportAdmins), getDisputeDetails);
router.put('/disputes/:id/review', authorize(...supportAdmins), markDisputeUnderReview);
router.put('/disputes/:id/resolve', authorize(...supportAdmins), resolveDispute);
router.put('/disputes/:id/close', authorize(...supportAdmins), closeDispute);
router.post('/disputes/:id/message', authorize(...supportAdmins), addDisputeMessage);

// ================================================================
// COUPON MANAGEMENT — general + marketing
// ================================================================
router.get('/coupons', authorize(...marketingAdmins), getAllCoupons);
router.post('/coupons', authorize(...marketingAdmins), createCoupon);
router.put('/coupons/:id', authorize(...marketingAdmins), updateCoupon);
router.put('/coupons/:id/toggle', authorize(...marketingAdmins), toggleCouponActive);
router.get('/coupons/:id/usage', authorize(...marketingAdmins), getCouponUsage);
router.delete('/coupons/:id', authorize(SA, A), deleteCoupon);

// ================================================================
// CATEGORY MANAGEMENT — general + content
// ================================================================
router.get('/categories', authorize(...contentAdmins), getAllCategories);
router.post('/categories', authorize(...contentAdmins), createCategory);
router.put('/categories/:id', authorize(...contentAdmins), updateCategory);
router.put('/categories/:id/toggle', authorize(...contentAdmins), toggleCategoryStatus);
router.delete('/categories/:id', authorize(SA, A), deleteCategory);

// ================================================================
// NOTIFICATION MANAGEMENT — general + marketing
// ================================================================
router.post('/notifications/broadcast', authorize(...marketingAdmins), broadcastNotification);
router.get('/notifications', authorize(...marketingAdmins), getNotificationHistory);

// ================================================================
// ACCOUNT DELETION MANAGEMENT — super admin only
// ================================================================
router.get('/account-deletions', authorize(SA), getAccountDeletionRequests);
router.post('/account-deletions', authorize(SA), adminCreateDeletionRequest);
router.post('/account-deletions/:id/approve', authorize(SA), approveAccountDeletion);
router.post('/account-deletions/:id/reject', authorize(SA), rejectAccountDeletion);

// ================================================================
// AMBASSADOR MANAGEMENT — general + marketing
// ================================================================
router.get('/ambassadors', authorize(SA, A, MA), getAllAmbassadors);
router.get('/ambassadors/:id', authorize(SA, A, MA), getAmbassador);
router.put('/ambassadors/:id', authorize(SA, A), updateAmbassador);
router.delete('/ambassadors/:id', authorize(SA, A), deleteAmbassador);
router.post('/ambassadors/resend-invite', authorize(SA, A), resendAmbassadorInvite);
router.post('/ambassadors/:id/approve', authorize(SA, A), approveAmbassador);
router.post('/ambassadors/:id/reject', authorize(SA, A), rejectAmbassador);
router.put('/ambassadors/:id/notes', authorize(SA, A, MA), addAmbassadorNote);
router.get('/ambassadors/:id/referrals', authorize(SA, A, MA), getAmbassadorReferrals);

// ================================================================
// AFFILIATE MANAGEMENT — general + financial
// ================================================================
router.get('/affiliates', authorize(SA, A, FA), getAllAffiliates);
router.get('/affiliates/:userId/links', authorize(SA, A, FA), getAffiliateLinks);
router.put('/affiliates/:userId/status', authorize(SA, A), toggleAffiliateStatus);

// ================================================================
// CHALLENGE MANAGEMENT — general + marketing
// ================================================================
router.get('/challenges', authorize(...marketingAdmins), getAllChallenges);
router.post('/challenges', authorize(...marketingAdmins), createChallenge);
router.put('/challenges/:id', authorize(...marketingAdmins), updateChallenge);
router.delete('/challenges/:id', authorize(SA, A), deleteChallenge);
router.get('/challenges/:id/leaderboard', authorize(...marketingAdmins), getChallengeLeaderboard);

// ================================================================
// REPORTS — general + financial
// ================================================================
router.get('/reports/sales', authorize(SA, A, FA), getSalesReport);
router.get('/reports/vendors', authorize(SA, A, FA), getVendorReport);
router.get('/reports/products', authorize(SA, A, FA, CA), getProductReport);

// ================================================================
// OUTREACH MANAGEMENT
// ================================================================
router.get('/outreach', authorize(...allAdmins), getOutreachList);

// ================================================================
// ADDRESS MANAGEMENT
// ================================================================
router.get('/addresses', authorize(...kycAdmins), getAllAddresses);

// ================================================================
// MISC
// ================================================================
router.get('/activity-log', authorize(...allAdmins), getActivityLog);
router.get('/search', authorize(...allAdmins), globalSearch);

// ================================================================
// REWARDS & POINTS MANAGEMENT — general + marketing
// ================================================================
router.get('/rewards/overview', authorize(...marketingAdmins), getRewardsOverview);
router.get('/rewards/users', authorize(...marketingAdmins), getRewardsUsers);
router.post('/rewards/users/:userId/adjust', authorize(SA, A), adjustUserPoints);
router.get('/rewards/transactions', authorize(...marketingAdmins), getPointsTransactions);

// ================================================================
// APP VERSION MANAGEMENT — super + general
// ================================================================
router.get('/app-version', authorize(SA), getAppVersionConfig);
router.put('/app-version', authorize(SA), updateAppVersionConfig);

// ================================================================
// AI SUPPORT SUGGESTIONS — support + general
// ================================================================
router.post('/ai/suggest', authorize(...supportAdmins), asyncHandler(aiChatController.adminSuggest.bind(aiChatController)));

// ================================================================
// PLANS & SUBSCRIPTIONS — super admin + admin + financial
// ================================================================
import {
  getPlansSettings,
  getPlansImpact,
  activatePlans,
  deactivatePlans,
  getSubscriptions as getPlanSubscriptions,
  assignVendorPlan,
  syncSubscriptions,
  getVendorSubscription,
} from '../controllers/adminPlan.controller';

router.get('/plans/settings',               authorize(SA, A, FA),         getPlansSettings);
router.get('/plans/impact',                  authorize(SA, A),              getPlansImpact);
router.post('/plans/activate',               authorize(SA),                 activatePlans);
router.post('/plans/deactivate',             authorize(SA),                 deactivatePlans);
router.post('/plans/sync',                   authorize(SA, A),              syncSubscriptions);
router.get('/plans/subscriptions',           authorize(SA, A, FA),         getPlanSubscriptions);
router.get('/plans/vendors/:vendorId',       authorize(SA, A, FA),         getVendorSubscription);
router.put('/plans/vendors/:vendorId',       authorize(SA, A),              assignVendorPlan);

export default router;
