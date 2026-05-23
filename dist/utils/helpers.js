"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLicenseKey = exports.isStrongPassword = exports.getTimeAgo = exports.calculateAverageRating = exports.escapeRegex = exports.generateConversationId = exports.sanitizeInput = exports.isValidPhone = exports.isValidEmail = exports.formatCurrency = exports.calculateCommission = exports.calculateDiscount = exports.generateToken = exports.getPaginationMeta = exports.generateSlug = exports.generateSKU = exports.generateAffiliateCode = exports.generateOrderNumber = exports.generateResetCode = exports.generateOTP = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generate OTP code
 */
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};
exports.generateOTP = generateOTP;
/**
 * Generate 6-character alphanumeric reset code (uppercase letters and numbers)
 * Example: ABC123, XY7Z4K, etc.
 */
const generateResetCode = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
};
exports.generateResetCode = generateResetCode;
/**
 * Generate unique order number
 */
const generateOrderNumber = () => {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `VS${timestamp.slice(-8)}${random}`;
};
exports.generateOrderNumber = generateOrderNumber;
/**
 * Generate unique affiliate code
 */
const generateAffiliateCode = (email) => {
    const hash = crypto_1.default.createHash('md5').update(email + Date.now()).digest('hex');
    return hash.substring(0, 8).toUpperCase();
};
exports.generateAffiliateCode = generateAffiliateCode;
/**
 * Generate SKU
 */
const generateSKU = (productName) => {
    const prefix = productName
        .substring(0, 3)
        .toUpperCase()
        .replace(/[^A-Z]/g, '');
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${timestamp}-${random}`;
};
exports.generateSKU = generateSKU;
/**
 * Generate slug from string
 */
const generateSlug = (text) => {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
};
exports.generateSlug = generateSlug;
/**
 * Calculate pagination metadata
 */
const getPaginationMeta = (total, page, limit) => {
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
exports.getPaginationMeta = getPaginationMeta;
/**
 * Generate random token
 */
const generateToken = (length = 32) => {
    return crypto_1.default.randomBytes(length).toString('hex');
};
exports.generateToken = generateToken;
/**
 * Calculate discount amount
 */
const calculateDiscount = (subtotal, discountType, discountValue, maxDiscount) => {
    let discount = 0;
    if (discountType === 'percentage') {
        discount = (subtotal * discountValue) / 100;
        if (maxDiscount && discount > maxDiscount) {
            discount = maxDiscount;
        }
    }
    else {
        discount = discountValue;
    }
    return Math.min(discount, subtotal);
};
exports.calculateDiscount = calculateDiscount;
/**
 * Calculate commission
 */
const calculateCommission = (amount, rate) => {
    return (amount * rate) / 100;
};
exports.calculateCommission = calculateCommission;
/**
 * Format currency
 */
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
    }).format(amount);
};
exports.formatCurrency = formatCurrency;
/**
 * Validate email format
 */
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};
exports.isValidEmail = isValidEmail;
/**
 * Validate phone number (Nigerian format)
 */
const isValidPhone = (phone) => {
    const phoneRegex = /^(\+234|0)[789]\d{9}$/;
    return phoneRegex.test(phone);
};
exports.isValidPhone = isValidPhone;
/**
 * Sanitize user input
 */
const sanitizeInput = (input) => {
    return input.trim().replace(/<[^>]*>/g, '');
};
exports.sanitizeInput = sanitizeInput;
/**
 * Generate conversation ID for chat
 */
const generateConversationId = (userId1, userId2) => {
    const sorted = [userId1, userId2].sort();
    return `${sorted[0]}_${sorted[1]}`;
};
exports.generateConversationId = generateConversationId;
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
exports.escapeRegex = escapeRegex;
/**
 * Calculate average rating
 */
const calculateAverageRating = (ratings) => {
    if (ratings.length === 0)
        return 0;
    const sum = ratings.reduce((acc, rating) => acc + rating, 0);
    return Math.round((sum / ratings.length) * 10) / 10;
};
exports.calculateAverageRating = calculateAverageRating;
/**
 * Get time difference in human readable format
 */
const getTimeAgo = (date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1)
        return Math.floor(interval) + ' years ago';
    interval = seconds / 2592000;
    if (interval > 1)
        return Math.floor(interval) + ' months ago';
    interval = seconds / 86400;
    if (interval > 1)
        return Math.floor(interval) + ' days ago';
    interval = seconds / 3600;
    if (interval > 1)
        return Math.floor(interval) + ' hours ago';
    interval = seconds / 60;
    if (interval > 1)
        return Math.floor(interval) + ' minutes ago';
    return Math.floor(seconds) + ' seconds ago';
};
exports.getTimeAgo = getTimeAgo;
/**
 * Validate password strength
 */
const isStrongPassword = (password) => {
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
exports.isStrongPassword = isStrongPassword;
/**
 * Generate unique license key
 */
const generateLicenseKey = () => {
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
exports.generateLicenseKey = generateLicenseKey;
//# sourceMappingURL=helpers.js.map