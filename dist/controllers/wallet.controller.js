"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletController = exports.WalletController = void 0;
const types_1 = require("../types");
const Additional_1 = require("../models/Additional");
const User_1 = __importDefault(require("../models/User"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const error_1 = require("../middleware/error");
const paystack_service_1 = require("../services/paystack.service");
const helpers_1 = require("../utils/helpers");
const notification_service_1 = require("../services/notification.service");
const logger_1 = require("../utils/logger");
class WalletController {
    /**
     * Get wallet balance and transactions
     */
    async getWallet(req, res) {
        let wallet = await Additional_1.Wallet.findOne({ user: req.user?.id });
        if (!wallet) {
            // Create wallet if it doesn't exist
            wallet = await Additional_1.Wallet.create({
                user: req.user?.id,
            });
        }
        res.json({
            success: true,
            data: { wallet },
        });
    }
    /**
     * Get wallet transactions
     */
    async getTransactions(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const wallet = await Additional_1.Wallet.findOne({ user: req.user?.id });
        if (!wallet) {
            res.json({
                success: true,
                data: {
                    transactions: [],
                },
                meta: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 0,
                },
            });
            return;
        }
        // Sort transactions by most recent
        const allTransactions = wallet.transactions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        // Paginate
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const transactions = allTransactions.slice(startIndex, endIndex);
        res.json({
            success: true,
            data: { transactions },
            meta: {
                page,
                limit,
                total: allTransactions.length,
                totalPages: Math.ceil(allTransactions.length / limit),
            },
        });
    }
    /**
     * Initialize wallet top-up with Paystack
     */
    async topUpWallet(req, res) {
        const { amount } = req.body;
        if (!amount || amount < 100) {
            throw new error_1.AppError('Minimum top-up amount is ₦100', 400);
        }
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        // Generate reference
        const reference = `TOPUP-${(0, helpers_1.generateOrderNumber)()}`;
        try {
            // Initialize Paystack payment
            const paystackResponse = await paystack_service_1.paystackService.initializePayment({
                email: user.email,
                amount: amount * 100, // Convert to kobo
                reference,
                callback_url: `${process.env.FRONTEND_URL}/wallet/top-up-callback`,
                metadata: {
                    userId: user._id.toString(),
                    purpose: 'wallet_topup',
                },
            });
            res.json({
                success: true,
                message: 'Payment initialized',
                data: {
                    authorization_url: paystackResponse.data.authorization_url,
                    access_code: paystackResponse.data.access_code,
                    reference,
                },
            });
        }
        catch (error) {
            logger_1.logger.error('Top-up initialization error:', error);
            throw new error_1.AppError('Failed to initialize payment', 500);
        }
    }
    /**
     * Verify wallet top-up payment
     */
    async verifyTopUp(req, res) {
        const { reference } = req.params;
        try {
            // Verify with Paystack
            const verification = await paystack_service_1.paystackService.verifyPayment(reference);
            if (verification.data.status === 'success') {
                const amount = verification.data.amount / 100; // Convert from kobo
                // Atomic: credit only if this reference has not already been processed — prevents double-credit on concurrent verify calls
                const wallet = await Additional_1.Wallet.findOneAndUpdate({
                    user: req.user?.id,
                    $nor: [{ transactions: { $elemMatch: { reference, status: 'completed' } } }],
                }, {
                    $inc: { balance: amount, totalEarned: amount },
                    $push: {
                        transactions: {
                            type: types_1.TransactionType.CREDIT,
                            amount,
                            purpose: types_1.WalletPurpose.TOP_UP,
                            reference,
                            description: 'Wallet top-up via Paystack',
                            status: 'completed',
                            timestamp: new Date(),
                        },
                    },
                }, { new: true });
                if (!wallet) {
                    // Either wallet not found or reference already credited
                    const existingWallet = await Additional_1.Wallet.findOne({ user: req.user?.id });
                    if (!existingWallet)
                        throw new error_1.AppError('Wallet not found', 404);
                    res.json({ success: true, message: 'Payment already credited', data: { wallet: existingWallet } });
                    return;
                }
                logger_1.logger.info(`Wallet top-up verified: ${reference} - ₦${amount}`);
                // Notify user
                try {
                    await notification_service_1.notificationService.walletTopUp(req.user.id, amount, wallet.balance);
                }
                catch (error) {
                    logger_1.logger.error('Error sending top-up notification:', error);
                }
                res.json({
                    success: true,
                    message: 'Top-up successful',
                    data: { wallet },
                });
            }
            else {
                throw new error_1.AppError('Payment verification failed', 400);
            }
        }
        catch (error) {
            logger_1.logger.error('Top-up verification error:', error);
            throw new error_1.AppError('Failed to verify payment', 500);
        }
    }
    /**
     * Get customer bank account details
     */
    async getCustomerBankAccount(req, res) {
        const user = await User_1.default.findById(req.user?.id).select('payoutDetails');
        if (!user)
            throw new error_1.AppError('User not found', 404);
        res.json({
            success: true,
            data: { payoutDetails: user.payoutDetails || null },
        });
    }
    /**
     * Save / update customer bank account details
     */
    async updateCustomerBankAccount(req, res) {
        const { bankName, accountNumber, accountName, bankCode } = req.body;
        if (!bankName || !accountNumber || !accountName || !bankCode) {
            throw new error_1.AppError('All bank account fields are required', 400);
        }
        if (!/^\d{10}$/.test(accountNumber)) {
            throw new error_1.AppError('Account number must be exactly 10 digits', 400);
        }
        await User_1.default.findByIdAndUpdate(req.user?.id, {
            payoutDetails: { bankName, accountNumber, accountName, bankCode },
        });
        res.json({
            success: true,
            message: 'Bank account details saved successfully',
        });
    }
    /**
     * Request withdrawal
     */
    async requestWithdrawal(req, res) {
        const { amount } = req.body;
        if (!amount || amount < 1000) {
            throw new error_1.AppError('Minimum withdrawal amount is ₦1,000', 400);
        }
        // Check bank account — vendors store it on VendorProfile, customers on User
        const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id }).select('isActive payoutDetails');
        if (vendorProfile) {
            if (vendorProfile.isActive === false) {
                throw new error_1.AppError('Your account is currently inactive. Please contact support to withdraw funds.', 403);
            }
            if (!vendorProfile.payoutDetails?.accountNumber) {
                throw new error_1.AppError('Please set up your bank account details before withdrawing.', 400);
            }
        }
        else {
            // Customer — check User.payoutDetails
            const user = await User_1.default.findById(req.user?.id).select('payoutDetails');
            if (!user?.payoutDetails?.accountNumber) {
                throw new error_1.AppError('Please set up your bank account details before withdrawing.', 400);
            }
        }
        const reference = `WD-${(0, helpers_1.generateOrderNumber)()}`;
        // Atomic: deduct balance only if sufficient funds exist — prevents double-spend on concurrent clicks
        const wallet = await Additional_1.Wallet.findOneAndUpdate({ user: req.user?.id, balance: { $gte: amount } }, {
            $inc: { balance: -amount, pendingBalance: amount },
            $push: {
                transactions: {
                    type: types_1.TransactionType.DEBIT,
                    amount,
                    purpose: types_1.WalletPurpose.WITHDRAWAL,
                    reference,
                    description: 'Withdrawal request',
                    status: 'pending',
                    timestamp: new Date(),
                },
            },
        }, { new: true });
        if (!wallet) {
            throw new error_1.AppError('Insufficient wallet balance', 400);
        }
        logger_1.logger.info(`Withdrawal requested: ${req.user?.id} - ₦${amount}`);
        // Notify user
        try {
            await notification_service_1.notificationService.walletWithdrawalRequested(req.user.id, amount);
        }
        catch (error) {
            logger_1.logger.error('Error sending withdrawal notification:', error);
        }
        res.json({
            success: true,
            message: 'Withdrawal request submitted. It will be processed within 1-3 business days.',
            data: { wallet },
        });
    }
    /**
     * Process withdrawal (Admin only)
     */
    async processWithdrawal(req, res) {
        const { transactionId, status } = req.body;
        const { userId } = req.params;
        // Read first to get the transaction amount (needed for the atomic update)
        const walletRead = await Additional_1.Wallet.findOne({ user: userId });
        if (!walletRead) {
            throw new error_1.AppError('Wallet not found', 404);
        }
        const txn = walletRead.transactions.find((t) => t._id.toString() === transactionId);
        if (!txn) {
            throw new error_1.AppError('Transaction not found', 404);
        }
        if (txn.status !== 'pending') {
            throw new error_1.AppError('Transaction already processed', 400);
        }
        const txnAmount = txn.amount;
        // Atomic: only update if transaction is still 'pending' — prevents double-processing by concurrent admin requests
        const wallet = await Additional_1.Wallet.findOneAndUpdate({
            user: userId,
            transactions: { $elemMatch: { _id: txn._id, status: 'pending' } },
        }, {
            $set: { 'transactions.$.status': status },
            $inc: {
                pendingBalance: -txnAmount,
                ...(status === 'completed' ? { totalWithdrawn: txnAmount } : {}),
                ...(status === 'failed' ? { balance: txnAmount } : {}),
            },
        }, { new: true });
        if (!wallet) {
            throw new error_1.AppError('Transaction already processed', 400);
        }
        logger_1.logger.info(`Withdrawal ${status}: ${userId} - ₦${txnAmount}`);
        // Notify user about withdrawal status
        try {
            await notification_service_1.notificationService.walletWithdrawalProcessed(userId, txnAmount, status);
        }
        catch (error) {
            logger_1.logger.error('Error sending withdrawal status notification:', error);
        }
        res.json({
            success: true,
            message: `Withdrawal ${status}`,
            data: { wallet },
        });
    }
    /**
     * Get wallet summary
     */
    async getWalletSummary(req, res) {
        const wallet = await Additional_1.Wallet.findOne({ user: req.user?.id });
        if (!wallet) {
            res.json({
                success: true,
                data: {
                    summary: {
                        balance: 0,
                        vCredits: 0,
                        totalEarned: 0,
                        totalSpent: 0,
                        totalWithdrawn: 0,
                        pendingBalance: 0,
                    },
                },
            });
            return;
        }
        // Get recent transactions (last 10)
        const recentTransactions = wallet.transactions
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, 10);
        res.json({
            success: true,
            data: {
                summary: {
                    balance: wallet.balance,
                    vCredits: wallet.vCredits,
                    totalEarned: wallet.totalEarned,
                    totalSpent: wallet.totalSpent,
                    totalWithdrawn: wallet.totalWithdrawn,
                    pendingBalance: wallet.pendingBalance,
                },
                recentTransactions,
            },
        });
    }
    /**
     * Transfer funds between wallets (internal transfer)
     */
    async transferFunds(req, res) {
        const { recipientEmail, amount, description } = req.body;
        if (!amount || amount < 100) {
            throw new error_1.AppError('Minimum transfer amount is ₦100', 400);
        }
        // Get recipient first (needed for description)
        const recipient = await User_1.default.findOne({ email: recipientEmail });
        if (!recipient) {
            throw new error_1.AppError('Recipient not found', 404);
        }
        if (recipient._id.toString() === req.user?.id) {
            throw new error_1.AppError('Cannot transfer to yourself', 400);
        }
        const reference = `TF-${(0, helpers_1.generateOrderNumber)()}`;
        // Atomic: deduct from sender only if sufficient balance — prevents double-spend on concurrent transfers
        const senderWallet = await Additional_1.Wallet.findOneAndUpdate({ user: req.user?.id, balance: { $gte: amount } }, {
            $inc: { balance: -amount, totalSpent: amount },
            $push: {
                transactions: {
                    type: types_1.TransactionType.DEBIT,
                    amount,
                    purpose: types_1.WalletPurpose.WITHDRAWAL,
                    reference,
                    description: description || `Transfer to ${recipient.firstName} ${recipient.lastName}`,
                    status: 'completed',
                    timestamp: new Date(),
                },
            },
        }, { new: true });
        if (!senderWallet) {
            throw new error_1.AppError('Insufficient balance', 400);
        }
        // Credit recipient — refund sender atomically if this step fails
        let recipientWallet;
        try {
            recipientWallet = await Additional_1.Wallet.findOneAndUpdate({ user: recipient._id }, {
                $inc: { balance: amount, totalEarned: amount },
                $push: {
                    transactions: {
                        type: types_1.TransactionType.CREDIT,
                        amount,
                        purpose: types_1.WalletPurpose.REWARD,
                        reference,
                        description: description || `Transfer from ${req.user?.email}`,
                        status: 'completed',
                        timestamp: new Date(),
                    },
                },
            }, { upsert: true, new: true });
        }
        catch (recipientErr) {
            logger_1.logger.error('Transfer recipient credit failed — refunding sender:', recipientErr);
            await Additional_1.Wallet.findOneAndUpdate({ user: req.user?.id }, {
                $inc: { balance: amount, totalSpent: -amount },
                $push: {
                    transactions: {
                        type: types_1.TransactionType.CREDIT,
                        amount,
                        purpose: types_1.WalletPurpose.REWARD,
                        reference: `REFUND-${reference}`,
                        description: 'Transfer refunded (recipient credit failed)',
                        status: 'completed',
                        timestamp: new Date(),
                    },
                },
            });
            throw new error_1.AppError('Transfer failed. Your balance has been refunded.', 500);
        }
        logger_1.logger.info(`Fund transfer: ${req.user?.email} -> ${recipientEmail} - ₦${amount}`);
        // Notify both parties
        try {
            const sender = await User_1.default.findById(req.user?.id).select('firstName lastName');
            await notification_service_1.notificationService.walletTransfer(req.user.id, recipient._id.toString(), amount, sender ? `${sender.firstName} ${sender.lastName}` : 'Someone', `${recipient.firstName} ${recipient.lastName}`);
        }
        catch (error) {
            logger_1.logger.error('Error sending transfer notification:', error);
        }
        res.json({
            success: true,
            message: 'Transfer successful',
            data: {
                senderWallet,
                recipientWallet,
            },
        });
    }
}
exports.WalletController = WalletController;
exports.walletController = new WalletController();
//# sourceMappingURL=wallet.controller.js.map