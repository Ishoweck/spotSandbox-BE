import { Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
export declare class WalletController {
    /**
     * Get wallet balance and transactions
     */
    getWallet(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get wallet transactions
     */
    getTransactions(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Initialize wallet top-up with Paystack
     */
    topUpWallet(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Verify wallet top-up payment
     */
    verifyTopUp(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get customer bank account details
     */
    getCustomerBankAccount(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Save / update customer bank account details
     */
    updateCustomerBankAccount(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Request withdrawal
     */
    requestWithdrawal(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Process withdrawal (Admin only)
     */
    processWithdrawal(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Get wallet summary
     */
    getWalletSummary(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
    /**
     * Transfer funds between wallets (internal transfer)
     */
    transferFunds(req: AuthRequest, res: Response<ApiResponse>): Promise<void>;
}
export declare const walletController: WalletController;
//# sourceMappingURL=wallet.controller.d.ts.map