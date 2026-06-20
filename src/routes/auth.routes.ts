import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { oauthController } from '../controllers/oauthController';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { body } from 'express-validator';
import { validate } from '../middleware/validation';
import rateLimit from 'express-rate-limit';

// 10 attempts per 15 minutes per IP — covers login, OTP, forgot-password
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts. Please try again in 15 minutes.',
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

// Validation rules
// Replace the registerValidation array
const registerValidation = [
  body('firstName').optional().trim(),
  body('lastName').optional().trim(),
  body('fullName').optional().trim(),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body().custom((_, { req }) => {
    const { firstName, lastName, fullName } = req.body;
    if (!fullName && (!firstName || !lastName)) {
      throw new Error('Either fullName or both firstName and lastName are required');
    }
    return true;
  }),
];

const loginValidation = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const googleLoginValidation = [
  body('idToken').notEmpty().withMessage('Google ID token is required'),
  body('role').optional().isIn(['customer', 'vendor', 'affiliate']).withMessage('Invalid role'),
];

const appleLoginValidation = [
  body('identityToken').notEmpty().withMessage('Apple identity token is required'),
  body('role').optional().isIn(['customer', 'vendor', 'affiliate']).withMessage('Invalid role'),
];

const guestRegisterValidation = [
  body('email').isEmail().withMessage('Valid email is required'),
];

// Standard auth routes
router.post('/guest-register', authLimiter, validate(guestRegisterValidation), asyncHandler(authController.guestRegister.bind(authController)));
router.post('/register', authLimiter, validate(registerValidation), asyncHandler(authController.register.bind(authController)));
router.post('/ambassador-register', authLimiter, asyncHandler(authController.ambassadorRegister.bind(authController)));
router.post('/verify-email', authLimiter, asyncHandler(authController.verifyEmail.bind(authController)));
router.post('/resend-otp', authLimiter, asyncHandler(authController.resendOTP.bind(authController)));
router.post('/resend-activation', authLimiter, asyncHandler(authController.resendActivation.bind(authController)));
router.post('/activate', asyncHandler(authController.activateAccount.bind(authController)));
router.post('/login', authLimiter, validate(loginValidation), asyncHandler(authController.login.bind(authController)));
router.post('/forgot-password', authLimiter, asyncHandler(authController.forgotPassword.bind(authController)));
router.post('/reset-password', authLimiter, asyncHandler(authController.resetPassword.bind(authController)));
router.post('/refresh-token', authLimiter, asyncHandler(authController.refreshToken.bind(authController)));

// OAuth routes
router.post('/oauth/google', validate(googleLoginValidation), asyncHandler(oauthController.googleLogin.bind(oauthController)));
router.post('/oauth/apple', validate(appleLoginValidation), asyncHandler(oauthController.appleLogin.bind(oauthController)));

// Get support user — requires auth so anonymous users can't enumerate admin IDs
router.get('/support-user', authenticate, asyncHandler(authController.getSupportUser.bind(authController)));

// Protected routes
router.get('/me', authenticate, asyncHandler(authController.getMe.bind(authController)));
router.put('/profile', authenticate, asyncHandler(authController.updateProfile.bind(authController)));
router.put('/avatar', authenticate, asyncHandler(authController.updateAvatar.bind(authController)));
router.put('/change-password', authenticate, asyncHandler(authController.changePassword.bind(authController)));

export default router;