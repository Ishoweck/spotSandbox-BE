"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const types_1 = require("../types");
const admin_controller_1 = require("../controllers/admin.controller");
const audit_1 = require("../middleware/audit");
const error_1 = require("../middleware/error");
const ai_chat_controller_1 = require("../controllers/ai-chat.controller");
const router = (0, express_1.Router)();
// All admin routes require authentication
router.use(auth_1.authenticate);
// Audit all admin actions (POST, PUT, PATCH, DELETE)
router.use(audit_1.auditMiddleware);
// Helper: all admin roles
const allAdmins = [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN, types_1.UserRole.FINANCIAL_ADMIN];
// Helper: general admins (not financial-only)
const generalAdmins = [types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN];
// Helper: financial admins
const financialAdmins = [types_1.UserRole.FINANCIAL_ADMIN, types_1.UserRole.SUPER_ADMIN];
// ================================================================
// DASHBOARD & ANALYTICS
// ================================================================
router.get('/dashboard', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getDashboard);
router.get('/analytics/revenue', (0, auth_1.authorize)(...financialAdmins, types_1.UserRole.ADMIN), admin_controller_1.getRevenueAnalytics);
router.get('/analytics/users', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getUserAnalytics);
router.get('/analytics/orders', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getOrderAnalytics);
// ================================================================
// ADMIN MANAGEMENT (SUPER_ADMIN ONLY)
// ================================================================
router.post('/admins/create', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN), admin_controller_1.createAdmin);
router.get('/admins', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN), admin_controller_1.getAllAdmins);
router.put('/admins/:id/role', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN), admin_controller_1.updateAdminRole);
router.delete('/admins/:id', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN), admin_controller_1.removeAdmin);
// ================================================================
// USER MANAGEMENT
// ================================================================
router.get('/users', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAllUsers);
router.get('/users/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getUserDetails);
router.put('/users/:id/status', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.updateUserStatus);
router.put('/users/:id/role', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN), admin_controller_1.updateUserRole);
router.delete('/users/:id', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN), admin_controller_1.deleteUser);
// ================================================================
// VENDOR MANAGEMENT
// ================================================================
router.get('/vendors', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAllVendors);
router.get('/vendors/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getVendorDetails);
router.put('/vendors/:id/verify', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.verifyVendor);
router.put('/vendors/:id/status', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.toggleVendorStatus);
router.put('/vendors/:id/premium', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.toggleVendorPremium);
router.put('/vendors/:id/commission', (0, auth_1.authorize)(...allAdmins), admin_controller_1.updateVendorCommission);
router.post('/vendors/fix-commission-rates', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN), admin_controller_1.fixLegacyCommissionRates);
// ================================================================
// PRODUCT MANAGEMENT
// ================================================================
router.get('/products', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAllProducts);
router.get('/products/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getProductDetails);
router.put('/products/:id/status', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.updateProductStatus);
router.put('/products/:id/featured', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.toggleProductFeatured);
router.delete('/products/:id', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN), admin_controller_1.deleteProduct);
// ================================================================
// ORDER MANAGEMENT
// ================================================================
router.get('/orders', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getAllOrders);
router.get('/orders/:id', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getOrderDetails);
router.put('/orders/:id/status', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.updateOrderStatus);
router.post('/orders/:id/refund', (0, auth_1.authorize)(...financialAdmins, types_1.UserRole.ADMIN), admin_controller_1.processRefund);
router.put('/orders/:id/note', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.addAdminNote);
// ================================================================
// FINANCIAL MANAGEMENT
// ================================================================
router.get('/finance/overview', (0, auth_1.authorize)(...financialAdmins, types_1.UserRole.ADMIN), admin_controller_1.getFinancialOverview);
router.get('/finance/transactions', (0, auth_1.authorize)(...financialAdmins, types_1.UserRole.ADMIN), admin_controller_1.getAllTransactions);
router.get('/finance/transactions/:transactionId', (0, auth_1.authorize)(...financialAdmins, types_1.UserRole.ADMIN), admin_controller_1.getTransactionById);
router.get('/finance/withdrawals', (0, auth_1.authorize)(...financialAdmins, types_1.UserRole.ADMIN), admin_controller_1.getPendingWithdrawals);
router.post('/finance/withdrawals/:walletId/:transactionId/process', (0, auth_1.authorize)(...financialAdmins), admin_controller_1.processWithdrawal);
// ================================================================
// REVIEW MANAGEMENT
// ================================================================
router.get('/reviews', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAllReviews);
router.get('/reviews/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getReviewById);
router.put('/reviews/:id/status', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.updateReviewStatus);
router.delete('/reviews/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.deleteReview);
// ================================================================
// DISPUTE MANAGEMENT
// ================================================================
router.get('/disputes', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAllDisputes);
router.get('/disputes/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getDisputeDetails);
router.put('/disputes/:id/review', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.markDisputeUnderReview);
router.put('/disputes/:id/resolve', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.resolveDispute);
router.put('/disputes/:id/close', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.closeDispute);
router.post('/disputes/:id/message', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.addDisputeMessage);
// ================================================================
// COUPON MANAGEMENT
// ================================================================
router.get('/coupons', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getAllCoupons);
router.post('/coupons', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.createCoupon);
router.put('/coupons/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.updateCoupon);
router.put('/coupons/:id/toggle', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.toggleCouponActive);
router.get('/coupons/:id/usage', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getCouponUsage);
router.delete('/coupons/:id', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN), admin_controller_1.deleteCoupon);
// ================================================================
// CATEGORY MANAGEMENT
// ================================================================
router.get('/categories', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getAllCategories);
router.post('/categories', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.createCategory);
router.put('/categories/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.updateCategory);
router.put('/categories/:id/toggle', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.toggleCategoryStatus);
router.delete('/categories/:id', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN), admin_controller_1.deleteCategory);
// ================================================================
// NOTIFICATION MANAGEMENT
// ================================================================
router.post('/notifications/broadcast', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.broadcastNotification);
router.get('/notifications', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getNotificationHistory);
// ================================================================
// ACCOUNT DELETION MANAGEMENT
// ================================================================
router.get('/account-deletions', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAccountDeletionRequests);
router.post('/account-deletions', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.adminCreateDeletionRequest);
router.post('/account-deletions/:id/approve', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.approveAccountDeletion);
router.post('/account-deletions/:id/reject', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.rejectAccountDeletion);
// ================================================================
// AFFILIATE MANAGEMENT
// ================================================================
router.get('/affiliates', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAllAffiliates);
router.get('/affiliates/:userId/links', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAffiliateLinks);
router.put('/affiliates/:userId/status', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.toggleAffiliateStatus);
// ================================================================
// CHALLENGE MANAGEMENT
// ================================================================
router.get('/challenges', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getAllChallenges);
router.post('/challenges', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.createChallenge);
router.put('/challenges/:id', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.updateChallenge);
router.delete('/challenges/:id', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN), admin_controller_1.deleteChallenge);
router.get('/challenges/:id/leaderboard', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getChallengeLeaderboard);
// ================================================================
// REPORTS
// ================================================================
router.get('/reports/sales', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getSalesReport);
router.get('/reports/vendors', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getVendorReport);
router.get('/reports/products', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getProductReport);
// ================================================================
// MISC
// ================================================================
router.get('/activity-log', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getActivityLog);
router.get('/search', (0, auth_1.authorize)(...allAdmins), admin_controller_1.globalSearch);
// ================================================================
// REWARDS & POINTS MANAGEMENT
// ================================================================
router.get('/rewards/overview', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getRewardsOverview);
router.get('/rewards/users', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.getRewardsUsers);
router.post('/rewards/users/:userId/adjust', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.adjustUserPoints);
router.get('/rewards/transactions', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getPointsTransactions);
// ================================================================
// APP VERSION MANAGEMENT
// ================================================================
router.get('/app-version', (0, auth_1.authorize)(...allAdmins), admin_controller_1.getAppVersionConfig);
router.put('/app-version', (0, auth_1.authorize)(...generalAdmins), admin_controller_1.updateAppVersionConfig);
// ================================================================
// AI SUPPORT SUGGESTIONS
// ================================================================
router.post('/ai/suggest', (0, auth_1.authorize)(...allAdmins), (0, error_1.asyncHandler)(ai_chat_controller_1.aiChatController.adminSuggest.bind(ai_chat_controller_1.aiChatController)));
exports.default = router;
//# sourceMappingURL=admin.routes.js.map