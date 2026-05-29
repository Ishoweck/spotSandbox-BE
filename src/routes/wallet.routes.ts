import { Router } from 'express';
import { walletController } from '../controllers/wallet.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { body } from 'express-validator';
import { validate } from '../middleware/validation';
import { UserRole } from '../types';

const router = Router();

// All wallet routes require authentication
router.use(authenticate);

const topUpValidation = [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum top-up amount is ₦100'),
];

const withdrawalValidation = [
  body('amount').isFloat({ min: 1000 }).withMessage('Minimum withdrawal amount is ₦1,000'),
];

const transferValidation = [
  body('recipientEmail').isEmail().withMessage('Valid recipient email is required'),
  body('amount').isFloat({ min: 100 }).withMessage('Minimum transfer amount is ₦100'),
];

const processWithdrawalValidation = [
  body('transactionId').notEmpty().withMessage('Transaction ID is required'),
  body('status').isIn(['completed', 'failed']).withMessage('Invalid status'),
];

// Get wallet and transactions
router.get('/', asyncHandler(walletController.getWallet.bind(walletController)));
router.get('/summary', asyncHandler(walletController.getWalletSummary.bind(walletController)));
router.get('/transactions', asyncHandler(walletController.getTransactions.bind(walletController)));

// Top-up wallet
router.post(
  '/top-up',
  validate(topUpValidation),
  asyncHandler(walletController.topUpWallet.bind(walletController))
);

router.get(
  '/top-up/verify/:reference',
  asyncHandler(walletController.verifyTopUp.bind(walletController))
);

const bankAccountValidation = [
  body('bankName').notEmpty().withMessage('Bank name is required'),
  body('accountNumber').matches(/^\d{10}$/).withMessage('Account number must be 10 digits'),
  body('accountName').notEmpty().withMessage('Account name is required'),
  body('bankCode').notEmpty().withMessage('Bank code is required'),
];

// Customer bank account
router.get('/bank-account', asyncHandler(walletController.getCustomerBankAccount.bind(walletController)));
router.put(
  '/bank-account',
  validate(bankAccountValidation),
  asyncHandler(walletController.updateCustomerBankAccount.bind(walletController))
);

// Withdrawals
router.post(
  '/withdraw',
  validate(withdrawalValidation),
  asyncHandler(walletController.requestWithdrawal.bind(walletController))
);

// Internal transfer
router.post(
  '/transfer',
  validate(transferValidation),
  asyncHandler(walletController.transferFunds.bind(walletController))
);

// Admin routes for processing withdrawals
router.post(
  '/admin/process-withdrawal/:userId',
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validate(processWithdrawalValidation),
  asyncHandler(walletController.processWithdrawal.bind(walletController))
);

export default router;
