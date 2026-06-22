interface EmailOptions {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: Array<{
        filename: string;
        content: Buffer;
    }>;
}
export declare const sendEmail: (options: EmailOptions) => Promise<void>;
export declare const sendOTPEmail: (email: string, otp: string, name?: string) => Promise<void>;
export declare const sendPasswordResetEmail: (email: string, resetCode: string, name?: string) => Promise<void>;
export declare const sendWelcomeEmail: (email: string, name: string) => Promise<void>;
interface OrderEmailItem {
    productName: string;
    productImage: string;
    quantity: number;
    price: number;
    vendorName?: string;
}
export declare const sendOrderConfirmationEmail: (email: string, orderNumber: string, total: number, name?: string, items?: OrderEmailItem[], receiptPdf?: Buffer) => Promise<void>;
export declare const sendVendorWelcomeEmail: (email: string, firstName?: string) => Promise<void>;
export declare const sendFounderWelcomeEmail: (email: string, firstName?: string) => Promise<void>;
export declare const sendBuyerFounderWelcomeEmail: (email: string, firstName: string) => Promise<void>;
export declare const sendProductPostingGuideEmail: (email: string) => Promise<void>;
export declare const sendActivationEmail: (email: string, name: string | undefined, activationLink: string) => Promise<void>;
export declare const sendAmbassadorApprovalEmail: (email: string, name: string, ambassadorCode: string, signupLink: string) => Promise<void>;
export {};
//# sourceMappingURL=email.d.ts.map