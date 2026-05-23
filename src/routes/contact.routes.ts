import { Router } from 'express';
import { contactController } from '../controllers/contact.controller';
import { asyncHandler } from '../middleware/error';
import rateLimit from 'express-rate-limit';

const router = Router();

// 5 contact submissions per 10 minutes per IP — prevents spam abuse
const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many contact submissions. Please try again later.',
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', contactLimiter, asyncHandler(contactController.submit.bind(contactController)));

export default router;
