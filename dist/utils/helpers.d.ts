/**
 * Generate OTP code
 */
export declare const generateOTP: () => string;
/**
 * Generate 6-character alphanumeric reset code (uppercase letters and numbers)
 * Example: ABC123, XY7Z4K, etc.
 */
export declare const generateResetCode: () => string;
/**
 * Generate unique order number
 */
export declare const generateOrderNumber: () => string;
/**
 * Generate unique affiliate code
 */
export declare const generateAffiliateCode: (email: string) => string;
/**
 * Generate SKU
 */
export declare const generateSKU: (productName: string) => string;
/**
 * Generate slug from string
 */
export declare const generateSlug: (text: string) => string;
/**
 * Calculate pagination metadata
 */
export declare const getPaginationMeta: (total: number, page: number, limit: number) => {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
};
/**
 * Generate random token
 */
export declare const generateToken: (length?: number) => string;
/**
 * Calculate discount amount
 */
export declare const calculateDiscount: (subtotal: number, discountType: "percentage" | "fixed", discountValue: number, maxDiscount?: number) => number;
/**
 * Calculate commission
 */
export declare const calculateCommission: (amount: number, rate: number) => number;
/**
 * Format currency
 */
export declare const formatCurrency: (amount: number) => string;
/**
 * Validate email format
 */
export declare const isValidEmail: (email: string) => boolean;
/**
 * Validate phone number (Nigerian format)
 */
export declare const isValidPhone: (phone: string) => boolean;
/**
 * Sanitize user input
 */
export declare const sanitizeInput: (input: string) => string;
/**
 * Generate conversation ID for chat
 */
export declare const generateConversationId: (userId1: string, userId2: string) => string;
export declare const escapeRegex: (str: string) => string;
/**
 * Calculate average rating
 */
export declare const calculateAverageRating: (ratings: number[]) => number;
/**
 * Get time difference in human readable format
 */
export declare const getTimeAgo: (date: Date) => string;
/**
 * Validate password strength
 */
export declare const isStrongPassword: (password: string) => {
    valid: boolean;
    message?: string;
};
/**
 * Generate unique license key
 */
export declare const generateLicenseKey: () => string;
//# sourceMappingURL=helpers.d.ts.map