"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_routes_1 = __importDefault(require("./auth.routes"));
const product_routes_1 = __importDefault(require("./product.routes"));
const cart_routes_1 = __importDefault(require("./cart.routes"));
const order_routes_1 = __importDefault(require("./order.routes"));
const wallet_routes_1 = __importDefault(require("./wallet.routes"));
const vendor_routes_1 = __importDefault(require("./vendor.routes"));
const category_routes_1 = __importDefault(require("./category.routes"));
const coupon_routes_1 = __importDefault(require("./coupon.routes"));
const affiliate_routes_1 = __importDefault(require("./affiliate.routes"));
const challenge_routes_1 = __importDefault(require("./challenge.routes"));
const reward_routes_1 = __importDefault(require("./reward.routes"));
const digital_routes_1 = __importDefault(require("./digital.routes"));
const review_routes_1 = __importDefault(require("./review.routes"));
const wishlist_routes_1 = __importDefault(require("./wishlist.routes"));
const notification_routes_1 = __importDefault(require("./notification.routes"));
const search_routes_1 = __importDefault(require("./search.routes"));
const address_routes_1 = __importDefault(require("./address.routes"));
const upload_routes_1 = __importDefault(require("./upload.routes"));
const account_deletion_routes_1 = __importDefault(require("./account-deletion.routes"));
const webhook_routes_1 = __importDefault(require("./webhook.routes"));
const question_routes_1 = __importDefault(require("./question.routes"));
const dispute_routes_1 = __importDefault(require("./dispute.routes"));
const message_routes_1 = __importDefault(require("./message.routes"));
const ticket_routes_1 = __importDefault(require("./ticket.routes"));
const admin_routes_1 = __importDefault(require("./admin.routes"));
const audit_routes_1 = __importDefault(require("./audit.routes"));
const ai_chat_routes_1 = __importDefault(require("./ai-chat.routes"));
const contact_routes_1 = __importDefault(require("./contact.routes"));
const blog_routes_1 = __importDefault(require("./blog.routes"));
const admin_controller_1 = require("../controllers/admin.controller");
const router = (0, express_1.Router)();
router.use('/auth', auth_routes_1.default);
router.use('/products', product_routes_1.default);
router.use('/cart', cart_routes_1.default);
router.use('/orders', order_routes_1.default);
router.use('/wallet', wallet_routes_1.default);
router.use('/vendor', vendor_routes_1.default);
router.use('/categories', category_routes_1.default);
router.use('/coupons', coupon_routes_1.default);
router.use('/affiliate', affiliate_routes_1.default);
router.use('/challenges', challenge_routes_1.default);
router.use('/rewards', reward_routes_1.default);
router.use('/digital', digital_routes_1.default);
router.use('/reviews', review_routes_1.default);
router.use('/wishlist', wishlist_routes_1.default);
router.use('/notifications', notification_routes_1.default);
router.use('/search', search_routes_1.default);
router.use('/addresses', address_routes_1.default);
router.use('/upload', upload_routes_1.default);
router.use('/account-deletion', account_deletion_routes_1.default);
router.use('/webhooks', webhook_routes_1.default);
router.use('/questions', question_routes_1.default);
router.use('/disputes', dispute_routes_1.default);
router.use('/messages', message_routes_1.default);
router.use('/tickets', ticket_routes_1.default);
router.use('/admin', admin_routes_1.default);
router.use('/admin/audit-logs', audit_routes_1.default);
router.use('/ai-chat', ai_chat_routes_1.default);
router.use('/contact', contact_routes_1.default);
router.use('/blogs', blog_routes_1.default);
// Public app version check (no auth required — called by the mobile app on startup)
router.get('/app/version', admin_controller_1.getAppVersionConfig);
// Health check
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'VendorSpot API is running',
        timestamp: new Date().toISOString(),
        phase: 'Phase 6 - Advanced Features',
        version: '1.0.0',
    });
});
exports.default = router;
//# sourceMappingURL=index.js.map