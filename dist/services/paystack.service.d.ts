interface InitializePaymentData {
    email: string;
    amount: number;
    reference: string;
    callback_url?: string;
    metadata?: any;
    bearer?: 'account' | 'subaccount';
}
interface VerifyPaymentResponse {
    status: boolean;
    message: string;
    data: {
        reference: string;
        amount: number;
        status: 'success' | 'failed';
        paid_at: string;
        channel: string;
        customer: {
            email: string;
        };
        metadata?: any;
    };
}
export declare class PaystackService {
    private headers;
    /**
     * Initialize payment transaction
     */
    initializePayment(data: InitializePaymentData): Promise<any>;
    /**
     * Verify payment transaction
     */
    verifyPayment(reference: string): Promise<VerifyPaymentResponse>;
    /**
     * Create transfer recipient
     */
    createTransferRecipient(data: {
        type: string;
        name: string;
        account_number: string;
        bank_code: string;
    }): Promise<any>;
    /**
     * Initiate transfer
     */
    initiateTransfer(data: {
        source: string;
        amount: number;
        recipient: string;
        reason?: string;
        reference?: string;
    }): Promise<any>;
    /**
     * Resolve bank account
     */
    resolveBankAccount(accountNumber: string, bankCode: string): Promise<any>;
    /**
     * Get list of banks
     */
    getBanks(): Promise<any>;
}
export declare const paystackService: PaystackService;
export {};
//# sourceMappingURL=paystack.service.d.ts.map