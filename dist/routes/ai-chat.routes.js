"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ai_chat_controller_1 = require("../controllers/ai-chat.controller");
const auth_1 = require("../middleware/auth");
const error_1 = require("../middleware/error");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const router = (0, express_1.Router)();
// 30 AI requests per minute per IP — prevents Groq API cost abuse
const aiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many AI requests. Please slow down.',
    skipSuccessfulRequests: false,
    standardHeaders: true,
    legacyHeaders: false,
});
// AI chat endpoint - requires authentication
router.post('/', aiLimiter, auth_1.authenticate, (0, error_1.asyncHandler)(ai_chat_controller_1.aiChatController.chat.bind(ai_chat_controller_1.aiChatController)));
exports.default = router;
//# sourceMappingURL=ai-chat.routes.js.map