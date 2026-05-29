"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const wallet_controller_1 = require("../controllers/wallet.controller");
const auth_1 = require("../middleware/auth");
const error_1 = require("../middleware/error");
const express_validator_1 = require("express-validator");
const validation_1 = require("../middleware/validation");
const types_1 = require("../types");
const router = (0, express_1.Router)();
// All wallet routes require authentication
router.use(auth_1.authenticate);
const topUpValidation = [
    (0, express_validator_1.body)('amount').isFloat({ min: 100 }).withMessage('Minimum top-up amount is ₦100'),
];
const withdrawalValidation = [
    (0, express_validator_1.body)('amount').isFloat({ min: 1000 }).withMessage('Minimum withdrawal amount is ₦1,000'),
];
const transferValidation = [
    (0, express_validator_1.body)('recipientEmail').isEmail().withMessage('Valid recipient email is required'),
    (0, express_validator_1.body)('amount').isFloat({ min: 100 }).withMessage('Minimum transfer amount is ₦100'),
];
const processWithdrawalValidation = [
    (0, express_validator_1.body)('transactionId').notEmpty().withMessage('Transaction ID is required'),
    (0, express_validator_1.body)('status').isIn(['completed', 'failed']).withMessage('Invalid status'),
];
// Get wallet and transactions
router.get('/', (0, error_1.asyncHandler)(wallet_controller_1.walletController.getWallet.bind(wallet_controller_1.walletController)));
router.get('/summary', (0, error_1.asyncHandler)(wallet_controller_1.walletController.getWalletSummary.bind(wallet_controller_1.walletController)));
router.get('/transactions', (0, error_1.asyncHandler)(wallet_controller_1.walletController.getTransactions.bind(wallet_controller_1.walletController)));
// Top-up wallet
router.post('/top-up', (0, validation_1.validate)(topUpValidation), (0, error_1.asyncHandler)(wallet_controller_1.walletController.topUpWallet.bind(wallet_controller_1.walletController)));
router.get('/top-up/verify/:reference', (0, error_1.asyncHandler)(wallet_controller_1.walletController.verifyTopUp.bind(wallet_controller_1.walletController)));
const bankAccountValidation = [
    (0, express_validator_1.body)('bankName').notEmpty().withMessage('Bank name is required'),
    (0, express_validator_1.body)('accountNumber').matches(/^\d{10}$/).withMessage('Account number must be 10 digits'),
    (0, express_validator_1.body)('accountName').notEmpty().withMessage('Account name is required'),
    (0, express_validator_1.body)('bankCode').notEmpty().withMessage('Bank code is required'),
];
// Customer bank account
router.get('/bank-account', (0, error_1.asyncHandler)(wallet_controller_1.walletController.getCustomerBankAccount.bind(wallet_controller_1.walletController)));
router.put('/bank-account', (0, validation_1.validate)(bankAccountValidation), (0, error_1.asyncHandler)(wallet_controller_1.walletController.updateCustomerBankAccount.bind(wallet_controller_1.walletController)));
// Withdrawals
router.post('/withdraw', (0, validation_1.validate)(withdrawalValidation), (0, error_1.asyncHandler)(wallet_controller_1.walletController.requestWithdrawal.bind(wallet_controller_1.walletController)));
// Internal transfer
router.post('/transfer', (0, validation_1.validate)(transferValidation), (0, error_1.asyncHandler)(wallet_controller_1.walletController.transferFunds.bind(wallet_controller_1.walletController)));
// Admin routes for processing withdrawals
router.post('/admin/process-withdrawal/:userId', (0, auth_1.authorize)(types_1.UserRole.ADMIN, types_1.UserRole.SUPER_ADMIN), (0, validation_1.validate)(processWithdrawalValidation), (0, error_1.asyncHandler)(wallet_controller_1.walletController.processWithdrawal.bind(wallet_controller_1.walletController)));
exports.default = router;
//# sourceMappingURL=wallet.routes.js.map