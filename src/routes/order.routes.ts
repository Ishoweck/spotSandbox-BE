// routes/order.routes.ts
import { Router, Response } from 'express';
import { orderController } from '../controllers/order.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { body, query } from 'express-validator';
import { validate } from '../middleware/validation';
import { UserRole, AuthRequest } from '../types';

const router = Router();

// Public config endpoint — returns checkout fee tiers (no auth needed)
router.get('/config', (_req, res: Response) => {
  res.json({
    success: true,
    data: {
      serviceChargeTiers: [
        { minOrder: 100001, maxOrder: null,   fee: 2000 },
        { minOrder: 50001,  maxOrder: 100000, fee: 1500 },
        { minOrder: 20001,  maxOrder: 50000,  fee: 1000 },
        { minOrder: 1000,   maxOrder: 20000,  fee: 500  },
        { minOrder: 0,      maxOrder: 999,    fee: 0    },
      ],
    },
  });
});

// All order routes require authentication
router.use(authenticate);

// ✅ Shipping address validation (optional for digital products)
const createOrderValidation = [
  body('shippingAddress.street')
    .optional()
    .notEmpty()
    .withMessage('Street address is required for physical products'),
  body('shippingAddress.city')
    .optional()
    .notEmpty()
    .withMessage('City is required for physical products'),
  body('shippingAddress.state')
    .optional()
    .notEmpty()
    .withMessage('State is required for physical products'),
  body('shippingAddress.country')
    .optional()
    .notEmpty()
    .withMessage('Country is required for physical products'),
  // ✅ UPDATED: createOrder is now wallet-only
  // Card payments use /initialize-payment → /confirm-payment flow
  body('paymentMethod')
    .isIn(['wallet'])
    .withMessage('This endpoint only accepts wallet payments. Use /initialize-payment for card payments.'),
  body('deliveryType')
    .optional()
    .custom((value) => {
      const valid = ['standard', 'express', 'same_day', 'pickup', 'digital'];
      if (valid.includes(value) || /^courier_.+$/.test(value)) return true;
      throw new Error('Invalid delivery type');
    }),
];

// ✅ NEW: Validation for initialize-payment
const initializePaymentValidation = [
  body('paymentMethod')
    .isIn(['paystack', 'flutterwave'])
    .withMessage('Only card payment methods (paystack, flutterwave) can use this endpoint'),
  body('shippingAddress').optional().isObject(),
  body('deliveryType')
    .optional()
    .custom((value) => {
      const valid = ['standard', 'express', 'same_day', 'pickup', 'digital'];
      if (valid.includes(value) || /^courier_.+$/.test(value)) return true;
      throw new Error('Invalid delivery type');
    }),
];

// ✅ NEW: Validation for confirm-payment
const confirmPaymentValidation = [
  body('provider')
    .optional()
    .isIn(['paystack', 'flutterwave'])
    .withMessage('Valid payment provider required'),
  body('checkoutSnapshot')
    .optional()
    .isObject()
    .withMessage('Checkout snapshot must be an object if provided'),
];

const cancelOrderValidation = [
  body('cancelReason').notEmpty().withMessage('Cancel reason is required'),
];

const updateStatusValidation = [
  body('status').isIn(['pending', 'confirmed', 'processing', 'shipped', 'in_transit', 'delivered', 'cancelled'])
    .withMessage('Invalid status'),
];

const getDeliveryRatesValidation = [
  query('city').notEmpty().withMessage('City is required'),
  query('state').notEmpty().withMessage('State is required'),
  query('weight').optional().isFloat({ min: 0 }).withMessage('Weight must be a positive number'),
];

// ============================================================
// GET ROUTES
// ============================================================

// Get delivery rates - BEFORE other routes to prevent conflicts
router.get(
  '/delivery-rates',
  validate(getDeliveryRatesValidation),
  asyncHandler(orderController.getDeliveryRates.bind(orderController))
);

// Payment verification - kept as webhook fallback
router.get(
  '/payment/verify/:reference',
  asyncHandler(orderController.verifyPayment.bind(orderController))
);

// Get user's digital products
router.get('/my-digital-products', asyncHandler(orderController.getUserDigitalProducts.bind(orderController)));

// Check active order with a counterparty (used by chat lock)
router.get('/check-active-with/:counterpartyId', asyncHandler(orderController.checkActiveOrderWith.bind(orderController)));

// Get count of active orders for the current user (tab badge)
router.get('/active-count', asyncHandler(orderController.getActiveOrderCount.bind(orderController)));

// Get all user IDs the current user has active orders with (bulk check for conversations list)
router.get('/active-partners', asyncHandler(orderController.getActivePartners.bind(orderController)));

// Get active orders with a counterparty (used by chat order context card)
router.get('/active-with/:counterpartyId', asyncHandler(orderController.getActiveOrdersWith.bind(orderController)));

// Customer orders
router.get('/my-orders', asyncHandler(orderController.getUserOrders.bind(orderController)));

// Vendor get single order - BEFORE generic :id
router.get(
  '/vendor/orders/:id',
  authorize(UserRole.VENDOR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(orderController.getVendorOrder.bind(orderController))
);

// Vendor orders list
router.get(
  '/vendor/orders',
  authorize(UserRole.VENDOR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(orderController.getVendorOrders.bind(orderController))
);

// Track order
router.get('/:id/track', asyncHandler(orderController.trackOrder.bind(orderController)));

// Download digital product
router.get('/:id/download/:itemId', asyncHandler(orderController.downloadDigitalProduct.bind(orderController)));

// Generic get order - AFTER all specific routes
router.get('/:id', asyncHandler(orderController.getOrder.bind(orderController)));

// ============================================================
// POST ROUTES
// ============================================================

// ✅ NEW: Initialize payment (no order created yet)
// For Paystack/Flutterwave card payments — Step 1
router.post(
  '/initialize-payment',
  validate(initializePaymentValidation),
  asyncHandler(orderController.initializePayment.bind(orderController))
);

// ✅ NEW: Confirm payment & create order atomically
// After user pays in WebView — Step 2
router.post(
  '/confirm-payment/:reference',
  validate(confirmPaymentValidation),
  asyncHandler(orderController.confirmPayment.bind(orderController))
);

// Create order — WALLET PAYMENTS ONLY
// Card payments must use /initialize-payment → /confirm-payment flow
router.post(
  '/',
  validate(createOrderValidation),
  asyncHandler(orderController.createOrder.bind(orderController))
);

// Cancel order (whole order — single vendor)
router.post(
  '/:id/cancel',
  validate(cancelOrderValidation),
  asyncHandler(orderController.cancelOrder.bind(orderController))
);

// Cancel a single vendor's shipment within a multi-vendor order
router.post(
  '/:id/cancel-vendor/:vendorId',
  validate(cancelOrderValidation),
  asyncHandler(orderController.cancelVendorShipment.bind(orderController))
);

// ============================================================
// PUT ROUTES
// ============================================================

// Customer complete order (confirm delivery)
router.put(
  '/:id/complete',
  asyncHandler(orderController.completeOrder.bind(orderController))
);

// Customer complete a single vendor's shipment (multi-vendor orders)
router.put(
  '/:id/complete-vendor/:vendorId',
  asyncHandler(orderController.completeVendorShipment.bind(orderController))
);

// Vendor update order status
router.put(
  '/:id/status',
  authorize(UserRole.VENDOR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  validate(updateStatusValidation),
  asyncHandler(orderController.updateOrderStatus.bind(orderController))
);

export default router;