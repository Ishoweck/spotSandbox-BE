import crypto from 'crypto';

/**
 * Generate OTP code
 */
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Generate 6-character alphanumeric reset code (uppercase letters and numbers)
 * Example: ABC123, XY7Z4K, etc.
 */
export const generateResetCode = (): string => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
};

/**
 * Generate unique order number
 */
export const generateOrderNumber = (): string => {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `VS${timestamp.slice(-8)}${random}`;
};

/**
 * Generate unique affiliate code
 */
export const generateAffiliateCode = (email: string): string => {
  const hash = crypto.createHash('md5').update(email + Date.now()).digest('hex');
  return hash.substring(0, 8).toUpperCase();
};

/**
 * Generate SKU
 */
export const generateSKU = (productName: string): string => {
  const prefix = productName
    .substring(0, 3)
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Generate slug from string
 */
export const generateSlug = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
};

/**
 * Calculate pagination metadata
 */
export const getPaginationMeta = (total: number, page: number, limit: number) => {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

/**
 * Generate random token
 */
export const generateToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Calculate discount amount
 */
export const calculateDiscount = (
  subtotal: number,
  discountType: 'percentage' | 'fixed',
  discountValue: number,
  maxDiscount?: number
): number => {
  let discount = 0;
  
  if (discountType === 'percentage') {
    discount = (subtotal * discountValue) / 100;
    if (maxDiscount && discount > maxDiscount) {
      discount = maxDiscount;
    }
  } else {
    discount = discountValue;
  }
  
  return Math.min(discount, subtotal);
};

/**
 * Calculate commission
 */
export const calculateCommission = (amount: number, rate: number): number => {
  return (amount * rate) / 100;
};

/**
 * Format currency
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amount);
};

/**
 * Validate email format
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number (Nigerian format)
 */
export const isValidPhone = (phone: string): boolean => {
  const phoneRegex = /^(\+234|0)[789]\d{9}$/;
  return phoneRegex.test(phone);
};

/**
 * Sanitize user input
 */
export const sanitizeInput = (input: string): string => {
  return input.trim().replace(/<[^>]*>/g, '');
};

/**
 * Generate conversation ID for chat
 */
export const generateConversationId = (userId1: string, userId2: string): string => {
  const sorted = [userId1, userId2].sort();
  return `${sorted[0]}_${sorted[1]}`;
};

export const escapeRegex = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Calculate average rating
 */
export const calculateAverageRating = (ratings: number[]): number => {
  if (ratings.length === 0) return 0;
  const sum = ratings.reduce((acc, rating) => acc + rating, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
};

/**
 * Get time difference in human readable format
 */
export const getTimeAgo = (date: Date): string => {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' years ago';
  
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' months ago';
  
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' days ago';
  
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' hours ago';
  
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' minutes ago';
  
  return Math.floor(seconds) + ' seconds ago';
};

/**
 * Validate password strength
 */
export const isStrongPassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  
  return { valid: true };
};

/**
 * Generate unique license key
 */
export const generateLicenseKey = (): string => {
  const segments = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
  // Generate 5 segments of 5 characters each
  for (let i = 0; i < 5; i++) {
    let segment = '';
    for (let j = 0; j < 5; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }
  
  return segments.join('-'); // Format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
};