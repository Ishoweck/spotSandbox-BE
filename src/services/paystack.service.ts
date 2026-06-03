import axios from 'axios';
import { logger } from '../utils/logger';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface InitializePaymentData {
  email: string;
  amount: number; // in kobo
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

export class PaystackService {
  private headers = {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };

  /**
   * Initialize payment transaction
   */
  async initializePayment(data: InitializePaymentData) {
    try {
      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transaction/initialize`,
        data,
        { headers: this.headers }
      );

      logger.info('Paystack payment initialized:', data.reference);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack initialization error:', error.response?.data || error.message);
      throw new Error('Failed to initialize payment');
    }
  }

  /**
   * Verify payment transaction
   */
  async verifyPayment(reference: string): Promise<VerifyPaymentResponse> {
    try {
      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
        { headers: this.headers }
      );

      logger.info('Paystack payment verified:', reference);
      return response.data;
    } catch (error: any) {
      logger.error('Paystack verification error:', error.response?.data || error.message);
      throw new Error('Failed to verify payment');
    }
  }

  /**
   * Create transfer recipient
   */
  async createTransferRecipient(data: {
    type: string;
    name: string;
    account_number: string;
    bank_code: string;
  }) {
    try {
      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transferrecipient`,
        data,
        { headers: this.headers }
      );

      logger.info('Transfer recipient created:', data.account_number);
      return response.data;
    } catch (error: any) {
      logger.error('Create recipient error:', error.response?.data || error.message);
      throw new Error('Failed to create transfer recipient');
    }
  }

  /**
   * Initiate transfer
   */
  async initiateTransfer(data: {
    source: string;
    amount: number;
    recipient: string;
    reason?: string;
    reference?: string;
  }) {
    try {
      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transfer`,
        data,
        { headers: this.headers }
      );

      logger.info('Transfer initiated:', data.reference);
      return response.data;
    } catch (error: any) {
      logger.error('Transfer error:', error.response?.data || error.message);
      throw new Error('Failed to initiate transfer');
    }
  }

  /**
   * Resolve bank account
   */
  async resolveBankAccount(accountNumber: string, bankCode: string) {
    try {
      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        { headers: this.headers }
      );

      return response.data;
    } catch (error: any) {
      logger.error('Account resolution error:', error.response?.data || error.message);
      throw new Error('Failed to resolve bank account');
    }
  }

  /**
   * Get list of banks
   */
  async getBanks() {
    try {
      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/bank`,
        { headers: this.headers }
      );

      return response.data;
    } catch (error: any) {
      logger.error('Get banks error:', error.response?.data || error.message);
      throw new Error('Failed to get banks');
    }
  }
}

export const paystackService = new PaystackService();
