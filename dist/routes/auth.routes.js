"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const oauthController_1 = require("../controllers/oauthController");
const auth_1 = require("../middleware/auth");
const error_1 = require("../middleware/error");
const express_validator_1 = require("express-validator");
const validation_1 = require("../middleware/validation");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// 10 attempts per 15 minutes per IP — covers login, OTP, forgot-password
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many attempts. Please try again in 15 minutes.',
    skipSuccessfulRequests: false,
    standardHeaders: true,
    legacyHeaders: false,
});
const router = (0, express_1.Router)();
// Validation rules
// Replace the registerValidation array
const registerValidation = [
    (0, express_validator_1.body)('firstName').optional().trim(),
    (0, express_validator_1.body)('lastName').optional().trim(),
    (0, express_validator_1.body)('fullName').optional().trim(),
    (0, express_validator_1.body)('email').isEmail().withMessage('Valid email is required'),
    (0, express_validator_1.body)('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    (0, express_validator_1.body)().custom((_, { req }) => {
        const { firstName, lastName, fullName } = req.body;
        if (!fullName && (!firstName || !lastName)) {
            throw new Error('Either fullName or both firstName and lastName are required');
        }
        return true;
    }),
];
const loginValidation = [
    (0, express_validator_1.body)('email').isEmail().withMessage('Valid email is required'),
    (0, express_validator_1.body)('password').notEmpty().withMessage('Password is required'),
];
const googleLoginValidation = [
    (0, express_validator_1.body)('idToken').notEmpty().withMessage('Google ID token is required'),
    (0, express_validator_1.body)('role').optional().isIn(['customer', 'vendor', 'affiliate']).withMessage('Invalid role'),
];
const appleLoginValidation = [
    (0, express_validator_1.body)('identityToken').notEmpty().withMessage('Apple identity token is required'),
    (0, express_validator_1.body)('role').optional().isIn(['customer', 'vendor', 'affiliate']).withMessage('Invalid role'),
];
const guestRegisterValidation = [
    (0, express_validator_1.body)('email').isEmail().withMessage('Valid email is required'),
];
// Standard auth routes
router.post('/guest-register', authLimiter, (0, validation_1.validate)(guestRegisterValidation), (0, error_1.asyncHandler)(auth_controller_1.authController.guestRegister.bind(auth_controller_1.authController)));
router.post('/register', authLimiter, (0, validation_1.validate)(registerValidation), (0, error_1.asyncHandler)(auth_controller_1.authController.register.bind(auth_controller_1.authController)));
router.post('/verify-email', authLimiter, (0, error_1.asyncHandler)(auth_controller_1.authController.verifyEmail.bind(auth_controller_1.authController)));
router.post('/resend-otp', authLimiter, (0, error_1.asyncHandler)(auth_controller_1.authController.resendOTP.bind(auth_controller_1.authController)));
router.post('/resend-activation', authLimiter, (0, error_1.asyncHandler)(auth_controller_1.authController.resendActivation.bind(auth_controller_1.authController)));
router.post('/activate', (0, error_1.asyncHandler)(auth_controller_1.authController.activateAccount.bind(auth_controller_1.authController)));
router.post('/login', authLimiter, (0, validation_1.validate)(loginValidation), (0, error_1.asyncHandler)(auth_controller_1.authController.login.bind(auth_controller_1.authController)));
router.post('/forgot-password', authLimiter, (0, error_1.asyncHandler)(auth_controller_1.authController.forgotPassword.bind(auth_controller_1.authController)));
router.post('/reset-password', authLimiter, (0, error_1.asyncHandler)(auth_controller_1.authController.resetPassword.bind(auth_controller_1.authController)));
router.post('/refresh-token', authLimiter, (0, error_1.asyncHandler)(auth_controller_1.authController.refreshToken.bind(auth_controller_1.authController)));
// OAuth routes
router.post('/oauth/google', (0, validation_1.validate)(googleLoginValidation), (0, error_1.asyncHandler)(oauthController_1.oauthController.googleLogin.bind(oauthController_1.oauthController)));
router.post('/oauth/apple', (0, validation_1.validate)(appleLoginValidation), (0, error_1.asyncHandler)(oauthController_1.oauthController.appleLogin.bind(oauthController_1.oauthController)));
// Get support user — requires auth so anonymous users can't enumerate admin IDs
router.get('/support-user', auth_1.authenticate, (0, error_1.asyncHandler)(auth_controller_1.authController.getSupportUser.bind(auth_controller_1.authController)));
// Protected routes
router.get('/me', auth_1.authenticate, (0, error_1.asyncHandler)(auth_controller_1.authController.getMe.bind(auth_controller_1.authController)));
router.put('/profile', auth_1.authenticate, (0, error_1.asyncHandler)(auth_controller_1.authController.updateProfile.bind(auth_controller_1.authController)));
router.put('/avatar', auth_1.authenticate, (0, error_1.asyncHandler)(auth_controller_1.authController.updateAvatar.bind(auth_controller_1.authController)));
router.put('/change-password', auth_1.authenticate, (0, error_1.asyncHandler)(auth_controller_1.authController.changePassword.bind(auth_controller_1.authController)));
exports.default = router;
//# sourceMappingURL=auth.routes.js.map