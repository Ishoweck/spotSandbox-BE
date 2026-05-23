import { Router } from 'express';
import { aiChatController } from '../controllers/ai-chat.controller';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import rateLimit from 'express-rate-limit';

const router = Router();

// 30 AI requests per minute per IP — prevents Groq API cost abuse
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many AI requests. Please slow down.',
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
});

// AI chat endpoint - requires authentication
router.post(
  '/',
  aiLimiter,
  authenticate,
  asyncHandler(aiChatController.chat.bind(aiChatController))
);

export default router;
