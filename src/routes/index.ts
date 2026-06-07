import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import cartRoutes from './cart.routes';
import orderRoutes from './order.routes';
import walletRoutes from './wallet.routes';
import vendorRoutes from './vendor.routes';
import categoryRoutes from './category.routes';
import couponRoutes from './coupon.routes';
import affiliateRoutes from './affiliate.routes';
import challengeRoutes from './challenge.routes';
import rewardRoutes from './reward.routes';
import digitalRoutes from './digital.routes';
import reviewRoutes from './review.routes';
import wishlistRoutes from './wishlist.routes';
import notificationRoutes from './notification.routes';
import searchRoutes from './search.routes';
import addressRoutes from './address.routes';
import uploadRoutes from './upload.routes'; 
import accountDeletion from './account-deletion.routes'; 
import webhookRoutes from './webhook.routes';
import questionRoutes from "./question.routes"
import disputeRoutes from "./dispute.routes"
import messageRoutes from './message.routes';
import ticketRoutes from './ticket.routes';
import adminRoutes from './admin.routes';
import auditRoutes from './audit.routes';
import aiChatRoutes from './ai-chat.routes';
import contactRoutes from './contact.routes';
import blogRoutes from './blog.routes';
import { getAppVersionConfig } from '../controllers/admin.controller';


const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/wallet', walletRoutes);
router.use('/vendor', vendorRoutes);
router.use('/categories', categoryRoutes);
router.use('/coupons', couponRoutes);
router.use('/affiliate', affiliateRoutes);
router.use('/challenges', challengeRoutes);
router.use('/rewards', rewardRoutes);
router.use('/digital', digitalRoutes);
router.use('/reviews', reviewRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/notifications', notificationRoutes);
router.use('/search', searchRoutes);
router.use('/addresses', addressRoutes);
router.use('/upload', uploadRoutes); 
router.use('/account-deletion', accountDeletion);
router.use('/webhooks', webhookRoutes);
router.use('/questions', questionRoutes);
router.use('/disputes', disputeRoutes);
router.use('/messages', messageRoutes);
router.use('/tickets', ticketRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/audit-logs', auditRoutes);
router.use('/ai-chat', aiChatRoutes);
router.use('/contact', contactRoutes);
router.use('/blogs', blogRoutes);


// Public app version check (no auth required — called by the mobile app on startup)
router.get('/app/version', getAppVersionConfig);

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

export default router;