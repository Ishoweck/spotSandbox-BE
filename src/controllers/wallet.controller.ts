import { Response } from 'express';
import { AuthRequest, ApiResponse, TransactionType, WalletPurpose } from '../types';
import { Wallet } from '../models/Additional';
import User from '../models/User';
import VendorProfile from '../models/VendorProfile';
import { AppError } from '../middleware/error';
import { paystackService } from '../services/paystack.service';
import { generateOrderNumber } from '../utils/helpers';
import { notificationService } from '../services/notification.service';
import { logger } from '../utils/logger';

export class WalletController {
  /**
   * Get wallet balance and transactions
   */
  async getWallet(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    let wallet = await Wallet.findOne({ user: req.user?.id });

    if (!wallet) {
      // Create wallet if it doesn't exist
      wallet = await Wallet.create({
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
  async getTransactions(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const wallet = await Wallet.findOne({ user: req.user?.id });
    
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
    const allTransactions = wallet.transactions.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );

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
  async topUpWallet(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { amount } = req.body;

    if (!amount || amount < 100) {
      throw new AppError('Minimum top-up amount is ₦100', 400);
    }

    const user = await User.findById(req.user?.id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Generate reference
    const reference = `TOPUP-${generateOrderNumber()}`;

    try {
      // Initialize Paystack payment
      const paystackResponse = await paystackService.initializePayment({
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
    } catch (error) {
      logger.error('Top-up initialization error:', error);
      throw new AppError('Failed to initialize payment', 500);
    }
  }

  /**
   * Verify wallet top-up payment
   */
  async verifyTopUp(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { reference } = req.params;

    try {
      // Verify with Paystack
      const verification = await paystackService.verifyPayment(reference);

      if (verification.data.status === 'success') {
        const amount = verification.data.amount / 100; // Convert from kobo

        // Atomic: credit only if this reference has not already been processed — prevents double-credit on concurrent verify calls
        const wallet = await Wallet.findOneAndUpdate(
          {
            user: req.user?.id,
            $nor: [{ transactions: { $elemMatch: { reference, status: 'completed' } } }],
          },
          {
            $inc: { balance: amount, totalEarned: amount },
            $push: {
              transactions: {
                type: TransactionType.CREDIT,
                amount,
                purpose: WalletPurpose.TOP_UP,
                reference,
                description: 'Wallet top-up via Paystack',
                status: 'completed',
                timestamp: new Date(),
              },
            },
          },
          { new: true }
        );

        if (!wallet) {
          // Either wallet not found or reference already credited
          const existingWallet = await Wallet.findOne({ user: req.user?.id });
          if (!existingWallet) throw new AppError('Wallet not found', 404);
          res.json({ success: true, message: 'Payment already credited', data: { wallet: existingWallet } });
          return;
        }

        logger.info(`Wallet top-up verified: ${reference} - ₦${amount}`);

        // Notify user
        try {
          await notificationService.walletTopUp(req.user!.id, amount, wallet.balance);
        } catch (error) {
          logger.error('Error sending top-up notification:', error);
        }

        res.json({
          success: true,
          message: 'Top-up successful',
          data: { wallet },
        });
      } else {
        throw new AppError('Payment verification failed', 400);
      }
    } catch (error) {
      logger.error('Top-up verification error:', error);
      throw new AppError('Failed to verify payment', 500);
    }
  }

  /**
   * Request withdrawal
   */
  async requestWithdrawal(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { amount, bankDetails } = req.body;

    if (!amount || amount < 1000) {
      throw new AppError('Minimum withdrawal amount is ₦1,000', 400);
    }

    const vendorProfile = await VendorProfile.findOne({ user: req.user?.id }).select('isActive');
    if (vendorProfile && vendorProfile.isActive === false) {
      throw new AppError('Your account is currently inactive. Please contact support to withdraw funds.', 403);
    }

    const reference = `WD-${generateOrderNumber()}`;

    // Atomic: deduct balance only if sufficient funds exist — prevents double-spend on concurrent clicks
    const wallet = await Wallet.findOneAndUpdate(
      { user: req.user?.id, balance: { $gte: amount } },
      {
        $inc: { balance: -amount, pendingBalance: amount },
        $push: {
          transactions: {
            type: TransactionType.DEBIT,
            amount,
            purpose: WalletPurpose.WITHDRAWAL,
            reference,
            description: 'Withdrawal request',
            status: 'pending',
            timestamp: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!wallet) {
      throw new AppError('Insufficient wallet balance', 400);
    }

    logger.info(`Withdrawal requested: ${req.user?.id} - ₦${amount}`);

    // Notify user
    try {
      await notificationService.walletWithdrawalRequested(req.user!.id, amount);
    } catch (error) {
      logger.error('Error sending withdrawal notification:', error);
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
  async processWithdrawal(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { transactionId, status } = req.body;
    const { userId } = req.params;

    // Read first to get the transaction amount (needed for the atomic update)
    const walletRead = await Wallet.findOne({ user: userId });
    if (!walletRead) {
      throw new AppError('Wallet not found', 404);
    }

    const txn = walletRead.transactions.find((t: any) => t._id.toString() === transactionId);
    if (!txn) {
      throw new AppError('Transaction not found', 404);
    }

    if (txn.status !== 'pending') {
      throw new AppError('Transaction already processed', 400);
    }

    const txnAmount = (txn as any).amount;

    // Atomic: only update if transaction is still 'pending' — prevents double-processing by concurrent admin requests
    const wallet = await Wallet.findOneAndUpdate(
      {
        user: userId,
        transactions: { $elemMatch: { _id: (txn as any)._id, status: 'pending' } },
      },
      {
        $set: { 'transactions.$.status': status },
        $inc: {
          pendingBalance: -txnAmount,
          ...(status === 'completed' ? { totalWithdrawn: txnAmount } : {}),
          ...(status === 'failed' ? { balance: txnAmount } : {}),
        },
      },
      { new: true }
    );

    if (!wallet) {
      throw new AppError('Transaction already processed', 400);
    }

    logger.info(`Withdrawal ${status}: ${userId} - ₦${txnAmount}`);

    // Notify user about withdrawal status
    try {
      await notificationService.walletWithdrawalProcessed(
        userId,
        txnAmount,
        status as 'completed' | 'failed'
      );
    } catch (error) {
      logger.error('Error sending withdrawal status notification:', error);
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
  async getWalletSummary(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const wallet = await Wallet.findOne({ user: req.user?.id });

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
  async transferFunds(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { recipientEmail, amount, description } = req.body;

    if (!amount || amount < 100) {
      throw new AppError('Minimum transfer amount is ₦100', 400);
    }

    // Get recipient first (needed for description)
    const recipient = await User.findOne({ email: recipientEmail });
    if (!recipient) {
      throw new AppError('Recipient not found', 404);
    }

    if (recipient._id.toString() === req.user?.id) {
      throw new AppError('Cannot transfer to yourself', 400);
    }

    const reference = `TF-${generateOrderNumber()}`;

    // Atomic: deduct from sender only if sufficient balance — prevents double-spend on concurrent transfers
    const senderWallet = await Wallet.findOneAndUpdate(
      { user: req.user?.id, balance: { $gte: amount } },
      {
        $inc: { balance: -amount, totalSpent: amount },
        $push: {
          transactions: {
            type: TransactionType.DEBIT,
            amount,
            purpose: WalletPurpose.WITHDRAWAL,
            reference,
            description: description || `Transfer to ${recipient.firstName} ${recipient.lastName}`,
            status: 'completed',
            timestamp: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!senderWallet) {
      throw new AppError('Insufficient balance', 400);
    }

    // Credit recipient — refund sender atomically if this step fails
    let recipientWallet: any;
    try {
      recipientWallet = await Wallet.findOneAndUpdate(
        { user: recipient._id },
        {
          $inc: { balance: amount, totalEarned: amount },
          $push: {
            transactions: {
              type: TransactionType.CREDIT,
              amount,
              purpose: WalletPurpose.REWARD,
              reference,
              description: description || `Transfer from ${req.user?.email}`,
              status: 'completed',
              timestamp: new Date(),
            },
          },
        },
        { upsert: true, new: true }
      );
    } catch (recipientErr) {
      logger.error('Transfer recipient credit failed — refunding sender:', recipientErr);
      await Wallet.findOneAndUpdate(
        { user: req.user?.id },
        {
          $inc: { balance: amount, totalSpent: -amount },
          $push: {
            transactions: {
              type: TransactionType.CREDIT,
              amount,
              purpose: WalletPurpose.REWARD,
              reference: `REFUND-${reference}`,
              description: 'Transfer refunded (recipient credit failed)',
              status: 'completed',
              timestamp: new Date(),
            },
          },
        }
      );
      throw new AppError('Transfer failed. Your balance has been refunded.', 500);
    }

    logger.info(`Fund transfer: ${req.user?.email} -> ${recipientEmail} - ₦${amount}`);

    // Notify both parties
    try {
      const sender = await User.findById(req.user?.id).select('firstName lastName');
      await notificationService.walletTransfer(
        req.user!.id,
        recipient._id.toString(),
        amount,
        sender ? `${sender.firstName} ${sender.lastName}` : 'Someone',
        `${recipient.firstName} ${recipient.lastName}`
      );
    } catch (error) {
      logger.error('Error sending transfer notification:', error);
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

export const walletController = new WalletController();
