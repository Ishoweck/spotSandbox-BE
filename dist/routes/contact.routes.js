"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const contact_controller_1 = require("../controllers/contact.controller");
const error_1 = require("../middleware/error");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const router = (0, express_1.Router)();
// 5 contact submissions per 10 minutes per IP — prevents spam abuse
const contactLimiter = (0, express_rate_limit_1.default)({
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: 'Too many contact submissions. Please try again later.',
    skipSuccessfulRequests: false,
    standardHeaders: true,
    legacyHeaders: false,
});
router.post('/', contactLimiter, (0, error_1.asyncHandler)(contact_controller_1.contactController.submit.bind(contact_controller_1.contactController)));
exports.default = router;
//# sourceMappingURL=contact.routes.js.map