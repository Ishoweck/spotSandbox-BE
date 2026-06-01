"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderController = exports.OrderController = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const types_1 = require("../types");
const Order_1 = __importDefault(require("../models/Order"));
const Cart_1 = __importDefault(require("../models/Cart"));
const Product_1 = __importDefault(require("../models/Product"));
const User_1 = __importDefault(require("../models/User"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const Additional_1 = require("../models/Additional");
const error_1 = require("../middleware/error");
const helpers_1 = require("../utils/helpers");
const paystack_service_1 = require("../services/paystack.service");
const flutterwave_service_1 = require("../services/flutterwave.service");
const shipbubble_service_1 = require("../services/shipbubble.service");
const email_1 = require("../utils/email");
const notification_service_1 = require("../services/notification.service");
const logger_1 = require("../utils/logger");
const Conversation_1 = __importDefault(require("../models/Conversation"));
/** Buyer Protection Fee tiers */
function calculateServiceCharge(orderTotal) {
    if (orderTotal >= 100001)
        return 2000;
    if (orderTotal >= 50001)
        return 1500;
    if (orderTotal >= 20001)
        return 1000;
    if (orderTotal >= 1000)
        return 500;
    return 0;
}
/** Tiered platform fee based on vendor's current-month sales volume */
async function getVendorCommissionRate(vendorId) {
    const vendorProfile = await VendorProfile_1.default.findOne({ user: vendorId }).select('isPremium commissionRate');
    if (!vendorProfile)
        return 8;
    if (vendorProfile.isPremium)
        return 5;
    // Treat legacy 5% default as unconfigured — use 8%
    const rate = vendorProfile.commissionRate ?? 8;
    return rate === 5 ? 8 : rate;
}
/**
 * Notify the vendor AND any buyers who have the product in their cart when
 * stock crosses a threshold. Only fires when a threshold is first crossed
 * so nobody gets spammed on every subsequent sale.
 *
 * Vendor threshold: product's own lowStockThreshold (configurable per product)
 * Buyer threshold:  hardcoded 5 (as requested)
 */
async function notifyCartUsersAboutStock(productId, productName, prevQuantity, soldQuantity, buyerUserId, vendorId, lowStockThreshold) {
    const newQuantity = Math.max(0, prevQuantity - soldQuantity);
    // --- Vendor notification (use their configured threshold) ---
    const vendorCrossedOutOfStock = newQuantity === 0 && prevQuantity > 0;
    const vendorCrossedLowStock = newQuantity > 0 && newQuantity <= lowStockThreshold && prevQuantity > lowStockThreshold;
    if (vendorCrossedOutOfStock || vendorCrossedLowStock) {
        try {
            await notification_service_1.notificationService.send({
                userId: vendorId,
                type: types_1.NotificationType.SYSTEM,
                title: vendorCrossedOutOfStock ? 'Product Out of Stock' : 'Low Stock Alert',
                message: vendorCrossedOutOfStock
                    ? `"${productName}" is now out of stock. Restock it to keep selling.`
                    : `"${productName}" is running low — only ${newQuantity} unit${newQuantity === 1 ? '' : 's'} left (threshold: ${lowStockThreshold}).`,
                data: { productId: productId.toString(), productName, stock: newQuantity },
                link: `/vendor/products`,
            });
        }
        catch (err) {
            logger_1.logger.warn('Vendor stock notification failed (non-critical):', err);
        }
    }
    // --- Buyer (cart) notifications (hardcoded threshold of 5 as requested) ---
    const buyerCrossedOutOfStock = newQuantity === 0 && prevQuantity > 0;
    const buyerCrossedLowStock = newQuantity > 0 && newQuantity <= 5 && prevQuantity > 5;
    if (!buyerCrossedOutOfStock && !buyerCrossedLowStock)
        return;
    try {
        const carts = await Cart_1.default.find({
            'items.product': productId,
            user: { $ne: buyerUserId },
        }).select('user');
        const userIds = carts
            .map((c) => c.user?.toString())
            .filter((id) => !!id);
        if (userIds.length === 0)
            return;
        await notification_service_1.notificationService.productStockAlert(userIds, productId.toString(), productName, newQuantity);
    }
    catch (err) {
        logger_1.logger.warn('Cart stock alert notification failed (non-critical):', err);
    }
}
class OrderController {
    /**
     * Check if cart contains digital products
     */
    hasDigitalProducts(items) {
        return items.some((item) => {
            const productType = item.product.productType?.toUpperCase();
            return productType === 'DIGITAL' || productType === 'SERVICE';
        });
    }
    /**
     * Check if cart contains ONLY digital products
     */
    isDigitalOnly(items) {
        return items.every((item) => {
            const productType = item.product.productType?.toUpperCase();
            return productType === 'DIGITAL' || productType === 'SERVICE';
        });
    }
    /**
     * Validate payment method for cart contents
     */
    validatePaymentMethod(items, paymentMethod, deliveryType) {
        const hasDigital = this.hasDigitalProducts(items);
        const isDigitalOnly = this.isDigitalOnly(items);
        logger_1.logger.info('📦 Payment validation:', {
            hasDigital,
            isDigitalOnly,
            paymentMethod,
            deliveryType,
        });
        // Digital products require online payment
        if (hasDigital && paymentMethod !== types_1.PaymentMethod.PAYSTACK &&
            paymentMethod !== types_1.PaymentMethod.FLUTTERWAVE &&
            paymentMethod !== types_1.PaymentMethod.WALLET) {
            throw new error_1.AppError('Digital products require Card Payment or Wallet. Please select a valid payment method.', 400);
        }
        // Digital-only orders should use pickup/digital delivery
        if (isDigitalOnly && deliveryType !== 'pickup' && deliveryType !== 'digital') {
            logger_1.logger.warn('Digital-only order with non-digital delivery type, auto-correcting');
        }
    }
    /**
     * ✅ NEW: Determine the best ShipBubble category based on product names
     * Uses keyword matching to pick the right category so ShipBubble
     * returns the most relevant couriers for the product type.
     */
    determineCategoryForItems(items) {
        const categoryKeywords = {
            'fashion': [
                'shoe', 'sneaker', 'sandal', 'boot', 'heel',
                'shirt', 'dress', 'cloth', 'wear', 'jacket', 'jean', 'trouser', 'skirt',
                'bag', 'handbag', 'purse', 'belt', 'cap', 'hat', 'scarf',
                'fashion', 'apparel', 'outfit', 'hoodie', 'jogger', 'shorts',
                'adidas', 'nike', 'puma', 'reebok', 'new balance', 'vans',
            ],
            'electronics': [
                'phone', 'laptop', 'tablet', 'charger', 'cable', 'adapter',
                'earphone', 'headphone', 'earbuds', 'airpod', 'speaker', 'bluetooth',
                'watch', 'smartwatch', 'gadget', 'electronic', 'samsung', 'apple', 'iphone',
                'power bank', 'battery', 'camera', 'console', 'controller', 'keyboard', 'mouse',
                'monitor', 'screen', 'tv', 'television', 'projector',
            ],
            'health and beauty': [
                'cream', 'lotion', 'soap', 'perfume', 'cologne', 'fragrance',
                'makeup', 'beauty', 'skincare', 'hair', 'cosmetic', 'serum',
                'sunscreen', 'moisturizer', 'shampoo', 'conditioner', 'oil',
                'lipstick', 'foundation', 'mascara', 'nail', 'body spray',
            ],
            'groceries': [
                'food', 'rice', 'oil', 'grocery', 'snack', 'drink', 'beverage',
                'flour', 'sugar', 'spice', 'seasoning', 'pasta', 'noodle',
                'milk', 'juice', 'water', 'cereal', 'bread', 'butter',
            ],
            'furniture': [
                'chair', 'table', 'desk', 'bed', 'mattress', 'furniture',
                'shelf', 'cabinet', 'wardrobe', 'couch', 'sofa', 'stool',
                'drawer', 'bookshelf', 'rack',
            ],
            'light weight': [
                'book', 'document', 'stationery', 'pen', 'pencil', 'paper',
                'notebook', 'journal', 'card', 'envelope', 'letter',
            ],
        };
        // Check each item's product name against keywords
        for (const item of items) {
            const name = (item.productName || item.name || '').toLowerCase();
            for (const [category, keywords] of Object.entries(categoryKeywords)) {
                if (keywords.some(kw => name.includes(kw))) {
                    const categoryId = shipbubble_service_1.shipBubbleService.getCategoryIdByName(category);
                    logger_1.logger.info(`📦 Category detected: "${category}" (ID: ${categoryId}) from product "${item.productName || item.name}"`);
                    return categoryId;
                }
            }
        }
        // Default to Electronics and gadgets
        logger_1.logger.info('📦 No category match found — using default (Electronics: 77179563)');
        return 77179563;
    }
    /**
     * Get delivery rates
     */
    async getDeliveryRates(req, res) {
        const { city, state, street, fullName, phone } = req.query;
        if (!city || !state) {
            throw new error_1.AppError('City and state are required', 400);
        }
        try {
            logger_1.logger.info('📦 Delivery rates request:', {
                city,
                state,
                street: street || 'Not provided',
                userId: req.user?.id,
            });
            // Get user's cart
            const cart = await Cart_1.default.findOne({
                user: req.user?.id
            }).populate({
                path: 'items.product',
                populate: {
                    path: 'vendor',
                    select: 'firstName lastName',
                },
            });
            if (!cart || cart.items.length === 0) {
                throw new error_1.AppError('Cart is empty', 400);
            }
            // Check if cart is digital-only
            const isDigitalOnly = this.isDigitalOnly(cart.items);
            if (isDigitalOnly) {
                logger_1.logger.info('📦 Digital-only cart - no delivery rates needed');
                res.json({
                    success: true,
                    data: {
                        rates: [{
                                type: 'digital',
                                name: 'Digital Delivery',
                                description: 'Instant access after payment',
                                price: 0,
                                estimatedDays: 'Instant',
                                courier: 'Digital',
                            }],
                        vendorCount: 0,
                        multiVendor: false,
                        source: 'digital',
                        isDigitalOnly: true,
                    },
                });
                return;
            }
            // Group items by vendor
            const vendorGroups = await this.groupItemsByVendor(cart.items);
            logger_1.logger.info(`📦 Processing delivery rates for ${vendorGroups.length} vendor(s)`);
            const rates = [];
            // Add pickup option
            const allVendorsSupportPickup = this.checkPickupAvailability(vendorGroups);
            if (allVendorsSupportPickup) {
                rates.push({
                    type: 'pickup',
                    name: 'Store Pickup',
                    description: vendorGroups.length > 1
                        ? `Pickup from ${vendorGroups.length} different vendor locations`
                        : 'Pickup from vendor location',
                    price: 0,
                    estimatedDays: 'Available immediately',
                    courier: 'Self Pickup',
                    pickupAddress: vendorGroups.length === 1
                        ? `${vendorGroups[0].vendorAddress.city}, ${vendorGroups[0].vendorAddress.state}`
                        : 'Multiple locations',
                });
            }
            // Create destination address object
            const destinationAddress = {
                street: street || `${city} Area`,
                city: city,
                state: state,
                fullName: fullName || 'Customer',
                phone: phone || '+2348000000000',
            };
            // Calculate shipping rates
            let shipBubbleSuccess = false;
            const vendorRates = await Promise.all(vendorGroups.map(async (group) => {
                const result = await this.getVendorDeliveryRates(group, destinationAddress);
                if (result.success) {
                    shipBubbleSuccess = true;
                }
                return result;
            }));
            // Aggregate rates
            const aggregatedRates = this.aggregateVendorRates(vendorRates);
            rates.push(...aggregatedRates);
            // Use fallback if all ShipBubble calls failed
            if (!shipBubbleSuccess && rates.filter(r => r.type !== 'pickup').length === 0) {
                logger_1.logger.warn('⚠️ All ShipBubble requests failed - Using fallback rates');
                rates.push(...this.getFallbackRates());
            }
            logger_1.logger.info(`✅ Returning ${rates.length} delivery options (ShipBubble: ${shipBubbleSuccess ? 'SUCCESS' : 'FAILED'})`);
            // Build per-vendor rate groups for multi-vendor checkout UI
            const vendorRateGroups = vendorRates.map((vr) => {
                const group = vendorGroups.find(g => g.vendorId === vr.vendorId);
                const filteredRates = vr.rates
                    .filter(r => r.type !== 'digital' && r.type !== 'pickup')
                    .map((r, i) => ({
                    id: `${vr.vendorId}-${r.type}-${i}`,
                    type: r.type,
                    name: r.name,
                    description: r.description,
                    price: r.price,
                    estimatedDays: r.estimatedDays,
                    courier: r.courier,
                    logo: r.logo,
                }));
                return {
                    vendorId: vr.vendorId,
                    vendorName: vr.vendorName,
                    vendorLogo: group?.vendorLogo,
                    isVerified: group?.isVerified,
                    products: (group?.items || []).map(item => ({
                        productId: item.productId,
                        name: item.productName,
                        image: item.image,
                        variant: item.variant,
                        price: item.price,
                        quantity: item.quantity,
                    })),
                    rates: filteredRates,
                };
            });
            res.json({
                success: true,
                data: {
                    rates,
                    vendorRateGroups,
                    vendorCount: vendorGroups.length,
                    multiVendor: vendorGroups.length > 1,
                    source: shipBubbleSuccess ? 'shipbubble' : 'fallback',
                },
            });
        }
        catch (error) {
            if (error instanceof error_1.AppError) {
                throw error;
            }
            logger_1.logger.error('❌ Critical error in getDeliveryRates:', error);
            throw new error_1.AppError('Failed to get delivery rates', 500);
        }
    }
    async getVendorDeliveryRates(vendorGroup, destination) {
        const result = {
            vendorId: vendorGroup.vendorId,
            vendorName: vendorGroup.vendorName,
            rates: [],
            success: false,
        };
        // Skip shipping for digital products
        const physicalItems = vendorGroup.items.filter(item => item.isPhysical);
        logger_1.logger.info(`📦 Vendor ${vendorGroup.vendorName} items breakdown:`, {
            totalItems: vendorGroup.items.length,
            physicalItems: physicalItems.length,
            digitalItems: vendorGroup.items.length - physicalItems.length,
        });
        if (physicalItems.length === 0) {
            logger_1.logger.info(`✅ Vendor ${vendorGroup.vendorName} has only digital products`);
            result.success = true;
            result.rates.push({
                type: 'digital',
                name: 'Digital Delivery',
                description: 'Instant download/access',
                price: 0,
                estimatedDays: 'Instant',
                courier: 'Digital',
            });
            return result;
        }
        try {
            logger_1.logger.info(`📦 Getting shipping rates for ${vendorGroup.vendorName}`);
            const vendorProfile = await VendorProfile_1.default.findOne({ user: vendorGroup.vendorId });
            const vendor = await User_1.default.findById(vendorGroup.vendorId);
            const hasValidAddress = vendorProfile?.businessAddress &&
                vendorProfile.businessAddress.street &&
                vendorProfile.businessAddress.street.trim().length > 5 &&
                vendorProfile.businessAddress.street !== '123 Main Street' &&
                vendorProfile.businessAddress.city &&
                vendorProfile.businessAddress.state;
            if (!hasValidAddress) {
                logger_1.logger.warn(`⚠️ Vendor ${vendorGroup.vendorName} has invalid address - using fallback`);
                result.rates.push(...this.getVendorFallbackRates());
                return result;
            }
            const senderFullAddress = `${vendorProfile.businessAddress.street}, ${vendorProfile.businessAddress.city}, ${vendorProfile.businessAddress.state}, ${vendorProfile.businessAddress.country || 'Nigeria'}`;
            const receiverFullAddress = `${destination.street}, ${destination.city}, ${destination.state}, Nigeria`;
            const senderAddress = {
                name: vendorGroup.vendorName,
                phone: vendorProfile.businessPhone || vendor?.phone || '+2348000000000',
                email: vendorProfile.businessEmail || vendor?.email || 'sender@vendorspot.com',
                address: senderFullAddress,
            };
            const receiverAddress = {
                name: destination.fullName,
                phone: destination.phone,
                email: 'customer@vendorspot.com',
                address: receiverFullAddress,
            };
            logger_1.logger.info('📦 ShipBubble addresses (COMPLETE):', {
                sender: {
                    name: senderAddress.name,
                    address: senderAddress.address,
                },
                receiver: {
                    name: receiverAddress.name,
                    address: receiverAddress.address,
                },
            });
            const packageItems = physicalItems.map(item => ({
                name: item.productName,
                description: item.productName,
                unit_weight: item.weight.toString(),
                unit_amount: item.price.toString(),
                quantity: item.quantity.toString(),
            }));
            // ✅ FIX: Determine category based on product names
            const categoryId = this.determineCategoryForItems(physicalItems);
            logger_1.logger.info('📦 Requesting ShipBubble rates:', {
                itemCount: packageItems.length,
                categoryId,
                packageItems,
            });
            const ratesResponse = await shipbubble_service_1.shipBubbleService.getDeliveryRates(senderAddress, receiverAddress, packageItems, undefined, // use default dimensions
            categoryId // ✅ Pass correct category instead of always Electronics
            );
            if (ratesResponse.status === 'success' && ratesResponse.data?.couriers) {
                logger_1.logger.info(`✅ Got ${ratesResponse.data.couriers.length} courier options from ShipBubble`);
                ratesResponse.data.couriers.forEach((courier, index) => {
                    // ✅ FIX: Use unique type per courier so aggregation doesn't collapse them
                    // Previously all pickup couriers became 'standard' and all dropoff became 'express',
                    // then aggregation kept only the cheapest per type — hiding couriers from the user.
                    // service_type (pickup/dropoff) is a vendor-side logistics detail, not relevant to customers.
                    const uniqueType = `courier_${courier.courier_id || index}`;
                    result.rates.push({
                        type: uniqueType,
                        name: courier.courier_name,
                        description: courier.delivery_eta || 'Standard delivery',
                        price: courier.total || courier.rate_card_amount,
                        estimatedDays: courier.delivery_eta || 'Within 3-5 days',
                        courier: courier.courier_name,
                        logo: courier.courier_image,
                    });
                });
                result.requestToken = ratesResponse.data.request_token;
                result.success = true;
            }
            else {
                logger_1.logger.warn(`⚠️ No courier data from ShipBubble`);
            }
            if (result.rates.length === 0) {
                logger_1.logger.warn(`⚠️ Using fallback rates`);
                result.rates.push(...this.getVendorFallbackRates());
            }
        }
        catch (error) {
            logger_1.logger.error(`❌ Error getting rates:`, error.message);
            result.rates.push(...this.getVendorFallbackRates());
        }
        return result;
    }
    async groupItemsByVendor(items) {
        const groups = new Map();
        for (const item of items) {
            const product = item.product;
            const vendorId = product.vendor._id.toString();
            if (!groups.has(vendorId)) {
                const vendorProfile = await VendorProfile_1.default.findOne({ user: vendorId });
                let vendorAddress = {
                    street: '',
                    city: process.env.SHIPBUBBLE_SENDER_CITY || '',
                    state: process.env.SHIPBUBBLE_SENDER_STATE || '',
                    country: process.env.SHIPBUBBLE_SENDER_COUNTRY || 'Nigeria',
                };
                if (vendorProfile && vendorProfile.businessAddress) {
                    vendorAddress = {
                        street: vendorProfile.businessAddress.street || '',
                        city: vendorProfile.businessAddress.city,
                        state: vendorProfile.businessAddress.state,
                        country: vendorProfile.businessAddress.country,
                    };
                }
                const vendorName = vendorProfile?.businessName ||
                    `${product.vendor.firstName} ${product.vendor.lastName}`;
                groups.set(vendorId, {
                    vendorId,
                    vendorName,
                    vendorLogo: vendorProfile?.businessLogo,
                    isVerified: vendorProfile?.verificationStatus === 'verified',
                    vendorAddress,
                    items: [],
                    totalWeight: 0,
                });
            }
            const group = groups.get(vendorId);
            const productType = product.productType?.toUpperCase();
            const isPhysical = productType === 'PHYSICAL' ||
                (!productType || (productType !== 'DIGITAL' && productType !== 'SERVICE'));
            // ✅ FIX: Use 0.5 KG default instead of 1 KG
            // 1 KG was inflating weights and eliminating cheaper couriers
            const weight = product.weight || 0.5;
            group.items.push({
                productId: product._id.toString(),
                productName: product.name,
                image: product.images?.[0],
                variant: item.variant,
                quantity: item.quantity,
                weight: weight,
                isPhysical: isPhysical,
                price: item.price,
            });
            if (isPhysical) {
                group.totalWeight += weight * item.quantity;
            }
        }
        return Array.from(groups.values());
    }
    checkPickupAvailability(vendorGroups) {
        return true;
    }
    aggregateVendorRates(vendorRates) {
        const aggregated = new Map();
        vendorRates.forEach(vendorRate => {
            const ratesByType = new Map();
            vendorRate.rates.forEach(rate => {
                if (rate.type === 'digital')
                    return;
                const existing = ratesByType.get(rate.type);
                if (!existing || rate.price < existing.price) {
                    ratesByType.set(rate.type, rate);
                }
            });
            ratesByType.forEach((rate, type) => {
                if (!aggregated.has(type)) {
                    aggregated.set(type, {
                        type: rate.type,
                        name: rate.name,
                        description: rate.description,
                        price: 0,
                        estimatedDays: rate.estimatedDays,
                        courier: vendorRates.length > 1 ? 'Multiple Couriers' : rate.courier,
                        vendorBreakdown: [],
                    });
                }
                const agg = aggregated.get(type);
                agg.price += rate.price;
                agg.vendorBreakdown.push({
                    vendorId: vendorRate.vendorId,
                    vendorName: vendorRate.vendorName,
                    price: rate.price,
                    courier: rate.courier,
                });
                if (this.compareEstimatedDays(rate.estimatedDays, agg.estimatedDays) > 0) {
                    agg.estimatedDays = rate.estimatedDays;
                }
            });
        });
        return Array.from(aggregated.values());
    }
    compareEstimatedDays(days1, days2) {
        const extract = (str) => {
            const match = str.match(/(\d+)/);
            return match ? parseInt(match[1]) : 0;
        };
        return extract(days1) - extract(days2);
    }
    /**
     * Create order from cart - WALLET PAYMENTS ONLY
     * For Paystack/Flutterwave, use initializePayment → confirmPayment flow instead
     */
    async createOrder(req, res) {
        const { shippingAddress, paymentMethod, notes, deliveryType = 'standard', selectedDeliveryPrice, selectedCourier, vendorBreakdown, vendorDeliveries, affiliateCode, } = req.body;
        logger_1.logger.info('🛒 ============================================');
        logger_1.logger.info('🛒 CREATE ORDER STARTED');
        logger_1.logger.info('🛒 ============================================');
        // ✅ GUARD: Only wallet payments go through createOrder
        // Card payments must use initializePayment → confirmPayment flow
        if (paymentMethod === types_1.PaymentMethod.PAYSTACK || paymentMethod === types_1.PaymentMethod.FLUTTERWAVE) {
            throw new error_1.AppError('Card payments must use the /orders/initialize-payment endpoint. This endpoint is for wallet payments only.', 400);
        }
        logger_1.logger.info('📋 Order request:', {
            userId: req.user?.id,
            paymentMethod,
            deliveryType,
            hasShippingAddress: !!shippingAddress,
        });
        const cart = await Cart_1.default.findOne({ user: req.user?.id }).populate({
            path: 'items.product',
            populate: {
                path: 'vendor',
                select: 'firstName lastName email phone',
            },
        });
        if (!cart || cart.items.length === 0) {
            throw new error_1.AppError('Cart is empty', 400);
        }
        // ✅ VALIDATE PAYMENT METHOD FOR CART CONTENTS
        this.validatePaymentMethod(cart.items, paymentMethod, deliveryType);
        // Validate products
        for (const item of cart.items) {
            const product = item.product;
            if (!product || product.status !== 'active') {
                throw new error_1.AppError(`Product ${product?.name || 'Unknown'} is not available`, 400);
            }
            // Check stock for physical products only
            const productType = product.productType?.toUpperCase();
            const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
            if (isPhysical && product.quantity < item.quantity) {
                throw new error_1.AppError(`Insufficient stock for ${product.name}. Only ${product.quantity} available`, 400);
            }
        }
        // Verify all vendors in the cart are active and approved
        const uniqueVendorIds = [...new Set(cart.items.map((item) => item.product.vendor._id.toString()))];
        const activeVendors = await VendorProfile_1.default.find({
            user: { $in: uniqueVendorIds },
            isActive: true,
            verificationStatus: types_1.VendorVerificationStatus.VERIFIED,
        }).select('user').lean();
        if (activeVendors.length < uniqueVendorIds.length) {
            const activeIds = new Set(activeVendors.map((v) => v.user.toString()));
            const blockedItem = cart.items.find((item) => !activeIds.has(item.product.vendor._id.toString()));
            throw new error_1.AppError(`"${blockedItem?.product?.name}" is from a store that is not currently accepting orders. Please remove it from your cart.`, 400);
        }
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        const vendorGroups = await this.groupItemsByVendor(cart.items);
        const isDigitalOnly = this.isDigitalOnly(cart.items);
        logger_1.logger.info(`📦 Creating order with ${vendorGroups.length} vendor(s)`, {
            isDigitalOnly,
            paymentMethod,
            deliveryType,
        });
        const orderItems = cart.items.map((item) => ({
            product: item.product._id,
            productName: item.product.name,
            productImage: item.product.images[0],
            productType: item.product.productType || 'physical',
            variant: item.variant,
            quantity: item.quantity,
            price: item.price,
            vendor: item.product.vendor._id,
        }));
        // Calculate shipping (skip for digital-only)
        let totalShippingCost = 0;
        const vendorShipments = [];
        if (!isDigitalOnly && deliveryType !== 'pickup') {
            logger_1.logger.info('📦 Calculating shipping costs...');
            // ✅ NEW: Per-vendor delivery selections from new checkout UI
            if (vendorDeliveries && vendorDeliveries.length > 0) {
                logger_1.logger.info('📦 Using per-vendor delivery selections');
                for (const group of vendorGroups) {
                    const physicalItems = group.items.filter(item => item.isPhysical);
                    if (physicalItems.length === 0)
                        continue;
                    const vd = vendorDeliveries.find((v) => v.vendorId === group.vendorId);
                    // Use ?? not || so a price of 0 (digital bundled) is respected
                    const shippingCost = vd != null ? (vd.price ?? 0) : this.getDefaultRate(deliveryType);
                    totalShippingCost += shippingCost;
                    vendorShipments.push({
                        vendor: group.vendorId,
                        vendorName: group.vendorName,
                        items: group.items.filter(item => item.isPhysical).map(item => item.productId),
                        origin: {
                            street: group.vendorAddress.street || '',
                            city: group.vendorAddress.city,
                            state: group.vendorAddress.state,
                            country: group.vendorAddress.country,
                        },
                        shippingCost,
                        courier: vd?.courier || selectedCourier,
                        status: 'pending',
                    });
                    logger_1.logger.info(`✅ Shipping for ${group.vendorName}: ₦${shippingCost} (${vd?.courier})`);
                }
            }
            // ✅ USE SELECTED PRICE FROM CHECKOUT (legacy)
            else if (selectedDeliveryPrice !== undefined && selectedDeliveryPrice !== null) {
                logger_1.logger.info('✅ Using selected delivery price from checkout:', selectedDeliveryPrice);
                // ✅ FOR MULTI-VENDOR ORDERS WITH BREAKDOWN
                if (vendorBreakdown && vendorBreakdown.length > 0) {
                    logger_1.logger.info('📦 Multi-vendor order - using vendor breakdown');
                    for (const group of vendorGroups) {
                        const physicalItems = group.items.filter(item => item.isPhysical);
                        if (physicalItems.length === 0) {
                            logger_1.logger.info(`⏭️ Skipping ${group.vendorName} - no physical items`);
                            continue;
                        }
                        const vendorShipping = vendorBreakdown.find((v) => v.vendorId === group.vendorId);
                        const shippingCost = vendorShipping?.price || this.getDefaultRate(deliveryType);
                        totalShippingCost += shippingCost;
                        vendorShipments.push({
                            vendor: group.vendorId,
                            vendorName: group.vendorName,
                            items: group.items.map(item => item.productId),
                            origin: {
                                street: group.vendorAddress.street || '',
                                city: group.vendorAddress.city,
                                state: group.vendorAddress.state,
                                country: group.vendorAddress.country,
                            },
                            shippingCost: shippingCost,
                            courier: vendorShipping?.courier || selectedCourier,
                            status: 'pending',
                        });
                        logger_1.logger.info(`✅ Shipping for ${group.vendorName}: ₦${shippingCost} (${vendorShipping?.courier || selectedCourier})`);
                    }
                }
                // ✅ FOR SINGLE-VENDOR ORDERS
                else {
                    logger_1.logger.info('📦 Single vendor order - using total price');
                    totalShippingCost = selectedDeliveryPrice;
                    for (const group of vendorGroups) {
                        const physicalItems = group.items.filter(item => item.isPhysical);
                        if (physicalItems.length === 0) {
                            logger_1.logger.info(`⏭️ Skipping ${group.vendorName} - no physical items`);
                            continue;
                        }
                        vendorShipments.push({
                            vendor: group.vendorId,
                            vendorName: group.vendorName,
                            items: group.items.map(item => item.productId),
                            origin: {
                                street: group.vendorAddress.street || '',
                                city: group.vendorAddress.city,
                                state: group.vendorAddress.state,
                                country: group.vendorAddress.country,
                            },
                            shippingCost: selectedDeliveryPrice,
                            courier: selectedCourier,
                            status: 'pending',
                        });
                        logger_1.logger.info(`✅ Shipping for ${group.vendorName}: ₦${selectedDeliveryPrice} (${selectedCourier})`);
                    }
                }
            }
            // ✅ FALLBACK ONLY IF NO PRICE PROVIDED
            else {
                logger_1.logger.warn('⚠️ No delivery price provided - using fallback rates');
                for (const group of vendorGroups) {
                    const physicalItems = group.items.filter(item => item.isPhysical);
                    if (physicalItems.length === 0) {
                        logger_1.logger.info(`⏭️ Skipping ${group.vendorName} - no physical items`);
                        continue;
                    }
                    const fallbackCost = this.getDefaultRate(deliveryType);
                    totalShippingCost += fallbackCost;
                    vendorShipments.push({
                        vendor: group.vendorId,
                        vendorName: group.vendorName,
                        items: group.items.map(item => item.productId),
                        origin: {
                            street: group.vendorAddress.street || '',
                            city: group.vendorAddress.city,
                            state: group.vendorAddress.state,
                            country: group.vendorAddress.country,
                        },
                        shippingCost: fallbackCost,
                        courier: selectedCourier || 'Standard Courier',
                        status: 'pending',
                    });
                    logger_1.logger.info(`⚠️ Using fallback for ${group.vendorName}: ₦${fallbackCost}`);
                }
            }
            logger_1.logger.info(`💰 Total shipping cost: ₦${totalShippingCost}`);
        }
        // Recalculate subtotal from current product prices — never trust the stale
        // cart.subtotal since vendors may have changed prices since the cart was built.
        let subtotal = 0;
        for (const cartItem of cart.items) {
            const liveProduct = await Product_1.default.findById(cartItem.product).select('price');
            subtotal += (liveProduct?.price || cartItem.price || 0) * cartItem.quantity;
        }
        if (subtotal === 0)
            subtotal = cart.subtotal; // fallback if product lookup fails
        const discount = cart.discount;
        const tax = 0;
        const baseTotal = subtotal - discount + totalShippingCost + tax;
        const serviceCharge = isDigitalOnly ? 0 : calculateServiceCharge(baseTotal);
        const total = Math.round(baseTotal + serviceCharge);
        // ── WALLET PRE-CHECK ──────────────────────────────────────────────────────
        // Validate balance BEFORE creating the order so we never leave an orphaned
        // PENDING order in the database when the user can't actually pay.
        if (paymentMethod === types_1.PaymentMethod.WALLET) {
            const walletCheck = await Additional_1.Wallet.findOne({ user: req.user?.id }).select('balance');
            const currentBalance = walletCheck?.balance ?? 0;
            if (currentBalance < total) {
                try {
                    await notification_service_1.notificationService.insufficientWalletBalance(req.user.id, total, currentBalance);
                }
                catch (notifErr) {
                    logger_1.logger.error('Error sending insufficient balance notification:', notifErr);
                }
                throw new error_1.AppError(`Insufficient wallet balance. You need ₦${total.toLocaleString()} but your wallet only has ₦${currentBalance.toLocaleString()}. Please top up and try again.`, 400);
            }
        }
        // ─────────────────────────────────────────────────────────────────────────
        const orderNumber = (0, helpers_1.generateOrderNumber)();
        logger_1.logger.info('💾 Creating order document...', { orderNumber });
        // Resolve affiliate if a code was passed at checkout
        let walletAffiliateUserId = undefined;
        let walletAffiliateCommission = 0;
        let walletAffiliateLinkId = undefined;
        const normalizedWalletAffiliateCode = affiliateCode ? affiliateCode.toUpperCase() : undefined;
        if (normalizedWalletAffiliateCode) {
            try {
                const linkRecord = await Additional_1.AffiliateLink.findOne({ code: normalizedWalletAffiliateCode, isActive: true });
                if (linkRecord && linkRecord.user.toString() !== req.user?.id) {
                    let commissionSum = 0;
                    if (linkRecord.product) {
                        // Product-specific link: commission only on the affiliated product
                        const affiliatedItem = orderItems.find((item) => item.product.toString() === linkRecord.product.toString());
                        if (affiliatedItem) {
                            const prod = await Product_1.default.findById(linkRecord.product).select('affiliateCommission').lean();
                            const rate = prod?.affiliateCommission || 3;
                            commissionSum = (affiliatedItem.price || 0) * (affiliatedItem.quantity || 1) * (rate / 100);
                        }
                    }
                    else {
                        // General affiliate link: commission on full subtotal using per-product rates
                        for (const item of orderItems) {
                            const prod = await Product_1.default.findById(item.product).select('affiliateCommission').lean();
                            const rate = prod?.affiliateCommission || 0;
                            if (rate > 0)
                                commissionSum += (item.price || 0) * (item.quantity || 1) * (rate / 100);
                        }
                        if (commissionSum === 0)
                            commissionSum = subtotal * 0.03;
                    }
                    walletAffiliateUserId = linkRecord.user;
                    walletAffiliateLinkId = linkRecord._id;
                    walletAffiliateCommission = Math.round(commissionSum * 100) / 100;
                    logger_1.logger.info(`🤝 Affiliate code ${normalizedWalletAffiliateCode} resolved — commission: ₦${walletAffiliateCommission}`);
                }
            }
            catch (affiliateErr) {
                logger_1.logger.error('Error resolving affiliate:', affiliateErr);
            }
        }
        // Detect first order for customer and vendors (count BEFORE creating)
        const priorCustomerOrders = await Order_1.default.countDocuments({ user: req.user?.id });
        const isFirstOrder = priorCustomerOrders === 0;
        const firstOrderVendorIds = [];
        for (const group of vendorGroups) {
            const priorVendorOrders = await Order_1.default.countDocuments({ 'items.vendor': new mongoose_1.default.Types.ObjectId(group.vendorId) });
            if (priorVendorOrders === 0)
                firstOrderVendorIds.push(group.vendorId);
        }
        const order = await Order_1.default.create({
            orderNumber,
            user: req.user?.id,
            items: orderItems,
            subtotal,
            discount,
            shippingCost: totalShippingCost,
            tax,
            serviceCharge,
            total,
            status: types_1.OrderStatus.PENDING,
            paymentStatus: types_1.PaymentStatus.PENDING,
            paymentMethod,
            shippingAddress: isDigitalOnly ? undefined : shippingAddress,
            couponCode: cart.couponCode,
            notes,
            deliveryType: isDigitalOnly ? 'digital' : deliveryType,
            isPickup: deliveryType === 'pickup' || isDigitalOnly,
            vendorShipments,
            isDigital: isDigitalOnly,
            ...(walletAffiliateUserId && { affiliateUser: walletAffiliateUserId, affiliateCommission: walletAffiliateCommission, affiliateLinkId: walletAffiliateLinkId }),
        });
        logger_1.logger.info(`✅ Order created: ${order._id}`);
        // Re-activate any closed conversations between the customer and each vendor in this order
        try {
            const vendorIds = [...new Set(orderItems.map((i) => i.vendor.toString()))];
            const customerId = req.user.id;
            for (const vendorId of vendorIds) {
                await Conversation_1.default.updateMany({ participants: { $all: [customerId, vendorId] }, isActive: false }, { isActive: true });
            }
        }
        catch (convActivateErr) {
            logger_1.logger.error('Error re-activating conversations on order create:', convActivateErr);
        }
        let paymentData = null;
        // ✅ WALLET PAYMENT ONLY (Paystack/Flutterwave blocked above)
        if (paymentMethod === types_1.PaymentMethod.WALLET) {
            logger_1.logger.info('💰 Processing wallet payment...');
            // Atomic: deduct only if sufficient balance — prevents double-spend on concurrent wallet payments
            const wallet = await Additional_1.Wallet.findOneAndUpdate({ user: req.user?.id, balance: { $gte: total } }, {
                $inc: { balance: -total, totalSpent: total },
                $push: {
                    transactions: {
                        type: types_1.TransactionType.DEBIT,
                        amount: total,
                        purpose: types_1.WalletPurpose.PURCHASE,
                        reference: orderNumber,
                        description: `Payment for order ${orderNumber}`,
                        relatedOrder: order._id,
                        status: 'completed',
                        timestamp: new Date(),
                    },
                },
            }, { new: true });
            if (!wallet) {
                // Race condition: balance dropped between the pre-check and here — delete the orphaned order
                await Order_1.default.findByIdAndDelete(order._id);
                logger_1.logger.warn(`⚠️ Wallet race condition: deleted orphaned order ${order.orderNumber}`);
                throw new error_1.AppError('Insufficient wallet balance. Please top up and try again.', 400);
            }
            order.paymentStatus = types_1.PaymentStatus.COMPLETED;
            order.status = isDigitalOnly ? types_1.OrderStatus.DELIVERED : types_1.OrderStatus.PENDING;
            await order.save();
            logger_1.logger.info('✅ Wallet payment completed');
            // ✅ For digital products, instant delivery
            if (isDigitalOnly) {
                logger_1.logger.info(`✅ Digital order completed instantly: ${orderNumber}`);
            }
            // Points awarded on delivery (not payment) — see completeOrder
            // Affiliate commission credited on delivery — see completeOrder
            logger_1.logger.info('📦 Shipment will be created when vendor confirms/processes order');
        }
        else {
            throw new error_1.AppError('Invalid payment method. Use /orders/initialize-payment for card payments.', 400);
        }
        // Clear cart
        cart.items = [];
        cart.couponCode = undefined;
        cart.discount = 0;
        await cart.save();
        logger_1.logger.info('🛒 Cart cleared');
        // Update coupon usage
        if (order.couponCode) {
            const { Coupon } = await Promise.resolve().then(() => __importStar(require('../models/Additional')));
            await Coupon.findOneAndUpdate({ code: order.couponCode }, {
                $inc: { usageCount: 1 },
                $push: { usedBy: user._id },
            });
            logger_1.logger.info(`🎟️ Coupon usage updated: ${order.couponCode}`);
        }
        // ✅ Update product sales
        for (const item of order.items) {
            await Product_1.default.findByIdAndUpdate(item.product, {
                $inc: {
                    totalSales: item.quantity,
                },
            });
        }
        // Reduce stock for physical products (wallet payment is already confirmed)
        for (const item of order.items) {
            const product = await Product_1.default.findById(item.product);
            if (!product)
                continue;
            const productType = product.productType?.toUpperCase();
            const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
            if (isPhysical) {
                await Product_1.default.findByIdAndUpdate(item.product, {
                    $inc: { quantity: -item.quantity },
                });
                await notifyCartUsersAboutStock(item.product, product.name, product.quantity, item.quantity, req.user.id, product.vendor?.toString() || '', product.lowStockThreshold ?? 10);
            }
        }
        logger_1.logger.info('📊 Product sales & stock updated');
        // Send confirmation email
        try {
            await (0, email_1.sendOrderConfirmationEmail)(user.email, order.orderNumber, order.total);
        }
        catch (error) {
            logger_1.logger.error('Error sending confirmation email:', error);
        }
        // Send notifications to customer and vendors
        try {
            const vendorIds = [...new Set(order.items.map((item) => item.vendor.toString()))];
            await notification_service_1.notificationService.orderPlaced(order._id.toString(), order.orderNumber, order.total, req.user.id, vendorIds);
            await notification_service_1.notificationService.paymentCompleted(order._id.toString(), order.orderNumber, order.total, req.user.id);
            (0, notification_service_1.emitNewOrder)({ orderId: order._id.toString(), orderNumber: order.orderNumber, vendorIds });
        }
        catch (error) {
            logger_1.logger.error('Error sending order notifications:', error);
        }
        logger_1.logger.info('🛒 ============================================');
        logger_1.logger.info('🛒 CREATE ORDER COMPLETED (WALLET)');
        logger_1.logger.info('🛒 ============================================');
        res.status(201).json({
            success: true,
            message: isDigitalOnly
                ? 'Digital order completed — instant access granted'
                : 'Order placed successfully with wallet payment',
            data: {
                order,
                vendorCount: vendorGroups.length,
                multiVendor: vendorGroups.length > 1,
                isDigital: isDigitalOnly,
                isFirstOrder,
                firstOrderVendorIds,
            },
        });
    }
    /**
     * ✅ NEW: Initialize payment WITHOUT creating an order
     * Step 1 of the payment-first flow:
     * - Validates cart & stock
     * - Calculates totals (subtotal + shipping)
     * - Initializes Paystack/Flutterwave
     * - Returns payment URL + a checkout token (encrypted cart snapshot)
     * - NO order is created, NO cart is cleared
     */
    async initializePayment(req, res) {
        const { shippingAddress, paymentMethod, notes, deliveryType = 'standard', selectedDeliveryPrice, selectedCourier, vendorBreakdown, vendorDeliveries, vCreditsAmount = 0, affiliateCode, } = req.body;
        logger_1.logger.info('💳 ============================================');
        logger_1.logger.info('💳 INITIALIZE PAYMENT (NO ORDER YET)');
        logger_1.logger.info('💳 ============================================');
        // Wallet payments should go through createOrder directly
        if (paymentMethod === types_1.PaymentMethod.WALLET && !vCreditsAmount) {
            throw new error_1.AppError('Wallet payments should use /orders/create endpoint directly', 400);
        }
        const cart = await Cart_1.default.findOne({ user: req.user?.id }).populate({
            path: 'items.product',
            populate: {
                path: 'vendor',
                select: 'firstName lastName email phone',
            },
        });
        if (!cart || cart.items.length === 0) {
            throw new error_1.AppError('Cart is empty', 400);
        }
        // Validate payment method for cart contents
        this.validatePaymentMethod(cart.items, paymentMethod, deliveryType);
        // Validate products & stock
        for (const item of cart.items) {
            const product = item.product;
            if (!product || product.status !== 'active') {
                throw new error_1.AppError(`Product ${product?.name || 'Unknown'} is not available`, 400);
            }
            const productType = product.productType?.toUpperCase();
            const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
            if (isPhysical && product.quantity < item.quantity) {
                throw new error_1.AppError(`Insufficient stock for ${product.name}. Only ${product.quantity} available`, 400);
            }
        }
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        const isDigitalOnly = this.isDigitalOnly(cart.items);
        // Calculate total (same logic as createOrder)
        let totalShippingCost = 0;
        if (!isDigitalOnly && deliveryType !== 'pickup') {
            if (vendorDeliveries && vendorDeliveries.length > 0) {
                totalShippingCost = vendorDeliveries.reduce((sum, v) => sum + (v.price || 0), 0);
            }
            else if (selectedDeliveryPrice !== undefined && selectedDeliveryPrice !== null) {
                if (vendorBreakdown && vendorBreakdown.length > 0) {
                    totalShippingCost = vendorBreakdown.reduce((sum, v) => sum + (v.price || 0), 0);
                }
                else {
                    totalShippingCost = selectedDeliveryPrice;
                }
            }
            else {
                // Fallback
                const vendorGroupsFallback = await this.groupItemsByVendor(cart.items);
                for (const group of vendorGroupsFallback) {
                    const physicalItems = group.items.filter(item => item.isPhysical);
                    if (physicalItems.length > 0) {
                        totalShippingCost += this.getDefaultRate(deliveryType);
                    }
                }
            }
        }
        // Recalculate subtotal from live product prices — stale cart.subtotal not trusted
        let subtotal = 0;
        for (const cartItem of cart.items) {
            const liveProduct = await Product_1.default.findById(cartItem.product).select('price');
            subtotal += (liveProduct?.price || cartItem.price || 0) * cartItem.quantity;
        }
        if (subtotal === 0)
            subtotal = cart.subtotal;
        const discount = cart.discount;
        const tax = 0;
        const baseTotal = subtotal - discount + totalShippingCost + tax;
        const serviceCharge = isDigitalOnly ? 0 : calculateServiceCharge(baseTotal);
        const total = Math.round(baseTotal + serviceCharge);
        // Validate VCredits balance now but do NOT deduct yet — deduction happens in
        // confirmPayment only after the card charge succeeds to prevent lost credits
        // if the user closes the app before completing payment.
        let validVCredits = 0;
        if (vCreditsAmount > 0) {
            const wallet = await Additional_1.Wallet.findOne({ user: req.user?.id });
            if (!wallet || (wallet.vCredits || 0) < vCreditsAmount) {
                throw new error_1.AppError('Insufficient VCredits balance', 400);
            }
            validVCredits = Math.min(vCreditsAmount, total);
            logger_1.logger.info(`💎 VCredits reserved (not yet deducted): ${validVCredits}`);
        }
        const cardChargeAmount = total - validVCredits;
        // Generate a reference for this payment attempt
        const paymentReference = (0, helpers_1.generateOrderNumber)();
        logger_1.logger.info('💰 Payment calculation:', { subtotal, discount, totalShippingCost, total, vCreditsApplied: validVCredits, cardChargeAmount, paymentReference });
        // Store checkout snapshot in a temporary collection or encode in metadata
        // We'll pass all checkout data as metadata so confirmPayment can reconstruct the order
        const checkoutSnapshot = {
            userId: req.user?.id,
            shippingAddress,
            paymentMethod,
            notes,
            deliveryType,
            selectedDeliveryPrice,
            selectedCourier,
            vendorBreakdown,
            vendorDeliveries,
            subtotal,
            discount,
            totalShippingCost,
            tax,
            total,
            couponCode: cart.couponCode,
            isDigitalOnly,
            vCreditsApplied: validVCredits,
            paymentReference,
            cartId: cart._id.toString(),
            affiliateCode: affiliateCode || undefined,
            createdAt: new Date().toISOString(),
        };
        let paymentData = null;
        if (paymentMethod === types_1.PaymentMethod.PAYSTACK) {
            logger_1.logger.info('💳 Initializing Paystack...');
            try {
                const paystackResponse = await paystack_service_1.paystackService.initializePayment({
                    email: user.email,
                    amount: Math.round(cardChargeAmount * 100),
                    reference: paymentReference,
                    callback_url: `${process.env.FRONTEND_URL}/orders/${paymentReference}/payment-callback`,
                    metadata: {
                        checkoutSnapshot: JSON.stringify(checkoutSnapshot),
                        userId: user._id.toString(),
                        isDigital: isDigitalOnly,
                    },
                });
                paymentData = {
                    authorization_url: paystackResponse.data.authorization_url,
                    access_code: paystackResponse.data.access_code,
                    reference: paymentReference,
                    provider: 'paystack',
                };
                logger_1.logger.info('✅ Paystack initialized — no order created yet');
            }
            catch (error) {
                logger_1.logger.error('❌ Paystack initialization failed:', error);
                throw new error_1.AppError('Failed to initialize payment', 500);
            }
        }
        else if (paymentMethod === types_1.PaymentMethod.FLUTTERWAVE) {
            logger_1.logger.info('💳 Initializing Flutterwave...');
            try {
                const flutterwaveResponse = await flutterwave_service_1.flutterwaveService.initializePayment({
                    tx_ref: paymentReference,
                    amount: cardChargeAmount,
                    currency: 'NGN',
                    redirect_url: `${process.env.FRONTEND_URL}/orders/${paymentReference}/payment-callback`,
                    customer: {
                        email: user.email,
                        name: `${user.firstName} ${user.lastName}`,
                        phonenumber: user.phone || '',
                    },
                    meta: {
                        checkoutSnapshot: JSON.stringify(checkoutSnapshot),
                        userId: user._id.toString(),
                        isDigital: isDigitalOnly,
                    },
                    customizations: {
                        title: 'VendorSpot',
                        description: `Payment for order ${paymentReference}`,
                    },
                });
                paymentData = {
                    authorization_url: flutterwaveResponse.data.link,
                    reference: paymentReference,
                    provider: 'flutterwave',
                };
                logger_1.logger.info('✅ Flutterwave initialized — no order created yet');
            }
            catch (error) {
                logger_1.logger.error('❌ Flutterwave initialization failed:', error);
                throw new error_1.AppError('Failed to initialize payment', 500);
            }
        }
        else {
            throw new error_1.AppError('Invalid payment method. Use paystack or flutterwave.', 400);
        }
        logger_1.logger.info('💳 ============================================');
        logger_1.logger.info('💳 PAYMENT INITIALIZED — AWAITING USER PAYMENT');
        logger_1.logger.info('💳 ============================================');
        res.status(200).json({
            success: true,
            message: validVCredits > 0
                ? `VCredits applied! Pay ₦${cardChargeAmount.toLocaleString()} with card to complete your order.`
                : 'Payment initialized. Complete payment to create your order.',
            data: {
                payment: paymentData,
                checkoutSnapshot,
                total,
                vCreditsApplied: validVCredits,
                cardChargeAmount,
                isDigital: isDigitalOnly,
            },
        });
    }
    /**
     * ✅ NEW: Confirm payment & create order ATOMICALLY
     * Step 2 of the payment-first flow:
     * - Verifies payment with Paystack/Flutterwave
     * - Re-validates cart & stock (could have changed while user was paying)
     * - Creates the order
     * - Clears the cart
     * - Awards points, updates sales, sends email
     */
    async confirmPayment(req, res) {
        const { reference } = req.params;
        const { provider, transaction_id, checkoutSnapshot: snapshotFromClient } = req.body;
        logger_1.logger.info('✅ ============================================');
        logger_1.logger.info('✅ CONFIRM PAYMENT & CREATE ORDER');
        logger_1.logger.info('✅ ============================================');
        logger_1.logger.info('🔍 Reference:', reference);
        logger_1.logger.info('🔍 Provider:', provider || 'paystack');
        // Step 1: Verify payment with the gateway
        let paymentSuccess = false;
        let snapshotFromGateway = null;
        let paidAmountNaira = null;
        const paymentProvider = provider || 'paystack';
        try {
            if (paymentProvider === 'flutterwave') {
                logger_1.logger.info('🔍 Verifying with Flutterwave...');
                let verification;
                if (transaction_id) {
                    verification = await flutterwave_service_1.flutterwaveService.verifyPayment(transaction_id);
                }
                else {
                    verification = await flutterwave_service_1.flutterwaveService.verifyPaymentByRef(reference);
                }
                if (verification.data?.status === 'successful') {
                    paymentSuccess = true;
                    paidAmountNaira = verification.data.amount;
                    logger_1.logger.info('✅ Flutterwave payment verified:', { amount: verification.data.amount });
                }
            }
            else {
                logger_1.logger.info('🔍 Verifying with Paystack...');
                const verification = await paystack_service_1.paystackService.verifyPayment(reference);
                if (verification.data.status === 'success') {
                    paymentSuccess = true;
                    paidAmountNaira = verification.data.amount / 100; // kobo → naira
                    logger_1.logger.info('✅ Paystack payment verified:', { amount: paidAmountNaira });
                    // Extract snapshot stored in Paystack metadata during initializePayment
                    const meta = verification.data.metadata;
                    if (meta?.checkoutSnapshot) {
                        try {
                            snapshotFromGateway = typeof meta.checkoutSnapshot === 'string'
                                ? JSON.parse(meta.checkoutSnapshot)
                                : meta.checkoutSnapshot;
                        }
                        catch {
                            logger_1.logger.warn('⚠️ Could not parse checkoutSnapshot from Paystack metadata');
                        }
                    }
                }
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Payment verification failed:', error.message);
            throw new error_1.AppError('Payment verification failed', 400);
        }
        if (!paymentSuccess) {
            throw new error_1.AppError('Payment was not successful', 400);
        }
        // Step 2: Parse the checkout snapshot (client-provided takes priority, else use gateway metadata)
        const snapshot = snapshotFromClient || snapshotFromGateway;
        if (!snapshot || snapshot.userId !== req.user?.id) {
            throw new error_1.AppError('Invalid checkout data', 400);
        }
        // Validate paid amount against what was expected
        if (paidAmountNaira !== null && snapshot.cardChargeAmount !== undefined) {
            if (paidAmountNaira < snapshot.cardChargeAmount - 1) { // 1 naira tolerance for rounding
                logger_1.logger.error('❌ confirmPayment amount mismatch:', {
                    expected: snapshot.cardChargeAmount,
                    received: paidAmountNaira,
                });
                throw new error_1.AppError('Payment amount does not match order total', 400);
            }
        }
        // Step 3: Re-validate cart (stock may have changed while user was paying)
        const cart = await Cart_1.default.findOne({ user: req.user?.id }).populate({
            path: 'items.product',
            populate: {
                path: 'vendor',
                select: 'firstName lastName email phone',
            },
        });
        if (!cart || cart.items.length === 0) {
            // Payment succeeded but cart is empty — this is a problem
            // We should still create the order using the snapshot to avoid losing the payment
            logger_1.logger.warn('⚠️ Cart is empty but payment succeeded — using snapshot to create order');
        }
        const cartToUse = cart && cart.items.length > 0 ? cart : null;
        // Re-validate stock for physical products
        if (cartToUse) {
            for (const item of cartToUse.items) {
                const product = item.product;
                if (!product || product.status !== 'active') {
                    // Payment succeeded but product unavailable — still create order, vendor will handle
                    logger_1.logger.warn(`⚠️ Product ${product?.name || 'Unknown'} may be unavailable`);
                }
            }
        }
        const user = await User_1.default.findById(req.user?.id);
        if (!user) {
            throw new error_1.AppError('User not found', 404);
        }
        // Step 4: Build order items from cart (or snapshot data)
        let orderItems;
        let vendorGroups;
        let isDigitalOnly;
        if (cartToUse) {
            orderItems = cartToUse.items.map((item) => ({
                product: item.product._id,
                productName: item.product.name,
                productImage: item.product.images[0],
                productType: item.product.productType || 'physical',
                variant: item.variant,
                quantity: item.quantity,
                price: item.price,
                vendor: item.product.vendor._id,
            }));
            vendorGroups = await this.groupItemsByVendor(cartToUse.items);
            isDigitalOnly = this.isDigitalOnly(cartToUse.items);
        }
        else {
            // Fallback: we lost the cart somehow, but payment went through
            // Create a minimal order from snapshot so the payment isn't lost
            logger_1.logger.error('❌ Cart lost after payment — creating minimal order from snapshot');
            orderItems = [];
            vendorGroups = [];
            isDigitalOnly = snapshot.isDigitalOnly || false;
        }
        // Step 5: Calculate shipping (use snapshot values — these were locked at checkout)
        const { shippingAddress, paymentMethod, notes, deliveryType, selectedDeliveryPrice, selectedCourier, vendorBreakdown: snapshotVendorBreakdown, vendorDeliveries: snapshotVendorDeliveries, } = snapshot;
        let totalShippingCost = 0;
        const vendorShipments = [];
        if (!isDigitalOnly && deliveryType !== 'pickup') {
            // ✅ NEW: per-vendor deliveries from new checkout UI
            if (snapshotVendorDeliveries && snapshotVendorDeliveries.length > 0) {
                for (const group of vendorGroups) {
                    const physicalItems = group.items.filter(item => item.isPhysical);
                    if (physicalItems.length === 0)
                        continue;
                    const vd = snapshotVendorDeliveries.find((v) => v.vendorId === group.vendorId);
                    const shippingCost = vd != null ? (vd.price ?? 0) : this.getDefaultRate(deliveryType);
                    totalShippingCost += shippingCost;
                    vendorShipments.push({
                        vendor: group.vendorId,
                        vendorName: group.vendorName,
                        items: group.items.filter(item => item.isPhysical).map(item => item.productId),
                        origin: {
                            street: group.vendorAddress.street || '',
                            city: group.vendorAddress.city,
                            state: group.vendorAddress.state,
                            country: group.vendorAddress.country,
                        },
                        shippingCost,
                        courier: vd?.courier || selectedCourier,
                        status: 'pending',
                    });
                }
            }
            else if (selectedDeliveryPrice !== undefined && selectedDeliveryPrice !== null) {
                if (snapshotVendorBreakdown && snapshotVendorBreakdown.length > 0) {
                    for (const group of vendorGroups) {
                        const physicalItems = group.items.filter(item => item.isPhysical);
                        if (physicalItems.length === 0)
                            continue;
                        const vendorShipping = snapshotVendorBreakdown.find((v) => v.vendorId === group.vendorId);
                        const shippingCost = vendorShipping?.price || this.getDefaultRate(deliveryType);
                        totalShippingCost += shippingCost;
                        vendorShipments.push({
                            vendor: group.vendorId,
                            vendorName: group.vendorName,
                            items: group.items.map(item => item.productId),
                            origin: {
                                street: group.vendorAddress.street || '',
                                city: group.vendorAddress.city,
                                state: group.vendorAddress.state,
                                country: group.vendorAddress.country,
                            },
                            shippingCost,
                            courier: vendorShipping?.courier || selectedCourier,
                            status: 'pending',
                        });
                    }
                }
                else {
                    totalShippingCost = selectedDeliveryPrice;
                    for (const group of vendorGroups) {
                        const physicalItems = group.items.filter(item => item.isPhysical);
                        if (physicalItems.length === 0)
                            continue;
                        vendorShipments.push({
                            vendor: group.vendorId,
                            vendorName: group.vendorName,
                            items: group.items.map(item => item.productId),
                            origin: {
                                street: group.vendorAddress.street || '',
                                city: group.vendorAddress.city,
                                state: group.vendorAddress.state,
                                country: group.vendorAddress.country,
                            },
                            shippingCost: selectedDeliveryPrice,
                            courier: selectedCourier,
                            status: 'pending',
                        });
                    }
                }
            }
            else {
                for (const group of vendorGroups) {
                    const physicalItems = group.items.filter(item => item.isPhysical);
                    if (physicalItems.length === 0)
                        continue;
                    const fallbackCost = this.getDefaultRate(deliveryType);
                    totalShippingCost += fallbackCost;
                    vendorShipments.push({
                        vendor: group.vendorId,
                        vendorName: group.vendorName,
                        items: group.items.map(item => item.productId),
                        origin: {
                            street: group.vendorAddress.street || '',
                            city: group.vendorAddress.city,
                            state: group.vendorAddress.state,
                            country: group.vendorAddress.country,
                        },
                        shippingCost: fallbackCost,
                        courier: selectedCourier || 'Standard Courier',
                        status: 'pending',
                    });
                }
            }
        }
        const subtotal = cartToUse ? cartToUse.subtotal : snapshot.subtotal;
        const discount = cartToUse ? cartToUse.discount : snapshot.discount;
        const tax = 0;
        const baseTotal = subtotal - discount + totalShippingCost + tax;
        const serviceCharge = isDigitalOnly ? 0 : calculateServiceCharge(baseTotal);
        const total = Math.round(baseTotal + serviceCharge);
        const orderNumber = reference; // Use the payment reference as order number
        // Step 6: Check for duplicate — prevent double-creation if user retries
        const existingOrder = await Order_1.default.findOne({ orderNumber });
        if (existingOrder) {
            logger_1.logger.info('⚠️ Order already exists for this payment reference — returning existing');
            res.json({
                success: true,
                message: 'Order already confirmed',
                data: { order: existingOrder, isDigital: isDigitalOnly },
            });
            return;
        }
        // Step 7: Create order with COMPLETED payment status
        logger_1.logger.info('💾 Creating order with verified payment...', { orderNumber, total });
        // Resolve affiliate if a code was passed at checkout
        let affiliateUserId = undefined;
        let affiliateCommissionAmount = 0;
        let affiliateLinkId = undefined;
        const snapshotAffiliateCode = snapshot.affiliateCode
            ? snapshot.affiliateCode.toUpperCase()
            : undefined;
        if (snapshotAffiliateCode) {
            try {
                const linkRecord = await Additional_1.AffiliateLink.findOne({ code: snapshotAffiliateCode, isActive: true });
                if (linkRecord && linkRecord.user.toString() !== req.user?.id) {
                    let commissionSum = 0;
                    if (linkRecord.product) {
                        // Product-specific link: commission only on the affiliated product
                        const affiliatedItem = orderItems.find((item) => item.product.toString() === linkRecord.product.toString());
                        if (affiliatedItem) {
                            const prod = await Product_1.default.findById(linkRecord.product).select('affiliateCommission').lean();
                            const rate = prod?.affiliateCommission || 3;
                            commissionSum = (affiliatedItem.price || 0) * (affiliatedItem.quantity || 1) * (rate / 100);
                        }
                    }
                    else {
                        // General affiliate link: commission on full subtotal using per-product rates
                        for (const item of orderItems) {
                            const prod = await Product_1.default.findById(item.product).select('affiliateCommission').lean();
                            const rate = prod?.affiliateCommission || 0;
                            if (rate > 0)
                                commissionSum += (item.price || 0) * (item.quantity || 1) * (rate / 100);
                        }
                        if (commissionSum === 0)
                            commissionSum = subtotal * 0.03;
                    }
                    affiliateUserId = linkRecord.user;
                    affiliateLinkId = linkRecord._id;
                    affiliateCommissionAmount = Math.round(commissionSum * 100) / 100;
                    logger_1.logger.info(`🤝 Affiliate code ${snapshotAffiliateCode} resolved — commission: ₦${affiliateCommissionAmount}`);
                }
            }
            catch (affiliateErr) {
                logger_1.logger.error('Error resolving affiliate:', affiliateErr);
            }
        }
        // Detect first order for customer and vendors (count BEFORE creating)
        const priorCustomerOrders = await Order_1.default.countDocuments({ user: req.user?.id });
        const isFirstOrder = priorCustomerOrders === 0;
        const firstOrderVendorIds = [];
        for (const group of vendorGroups) {
            const priorVendorOrders = await Order_1.default.countDocuments({ 'items.vendor': new mongoose_1.default.Types.ObjectId(group.vendorId) });
            if (priorVendorOrders === 0)
                firstOrderVendorIds.push(group.vendorId);
        }
        const order = await Order_1.default.create({
            orderNumber,
            user: req.user?.id,
            items: orderItems,
            subtotal,
            discount,
            shippingCost: totalShippingCost,
            tax,
            serviceCharge,
            total,
            status: isDigitalOnly ? types_1.OrderStatus.DELIVERED : types_1.OrderStatus.PENDING,
            paymentStatus: types_1.PaymentStatus.COMPLETED,
            paymentMethod,
            paymentReference: reference,
            shippingAddress: isDigitalOnly ? undefined : shippingAddress,
            couponCode: cartToUse?.couponCode || snapshot.couponCode,
            notes,
            deliveryType: isDigitalOnly ? 'digital' : deliveryType,
            isPickup: deliveryType === 'pickup' || isDigitalOnly,
            vendorShipments,
            isDigital: isDigitalOnly,
            ...(affiliateUserId && { affiliateUser: affiliateUserId, affiliateCommission: affiliateCommissionAmount, affiliateLinkId }),
        });
        logger_1.logger.info(`✅ Order created with verified payment: ${order._id}`);
        // Deduct VCredits NOW — payment is confirmed, safe to remove from wallet
        const vCreditsApplied = snapshot.vCreditsApplied || 0;
        if (vCreditsApplied > 0) {
            try {
                // Atomic: deduct only if sufficient vCredits exist — prevents race condition on concurrent orders
                // Using VCredits resets the 60-day expiry clock on the remaining balance
                const { rewardController } = await Promise.resolve().then(() => __importStar(require('./reward.controller')));
                const vcWallet = await Additional_1.Wallet.findOneAndUpdate({ user: snapshot.userId, vCredits: { $gte: vCreditsApplied } }, {
                    $inc: { vCredits: -vCreditsApplied },
                    $set: { vCreditsExpiresAt: rewardController.vCreditsExpiry(), vCreditsRemindersSent: [] },
                    $push: {
                        transactions: {
                            type: types_1.TransactionType.DEBIT,
                            amount: vCreditsApplied,
                            purpose: types_1.WalletPurpose.PURCHASE,
                            reference: `VCREDITS-${order._id}`,
                            description: `VCredits applied to order #${order.orderNumber}`,
                            status: 'completed',
                            timestamp: new Date(),
                        },
                    },
                }, { new: true });
                if (vcWallet) {
                    logger_1.logger.info(`💎 VCredits deducted after payment confirmed: ${vCreditsApplied}`);
                }
                else {
                    logger_1.logger.warn(`⚠️ VCredits deduction skipped — insufficient balance or wallet not found`);
                }
            }
            catch (vcErr) {
                logger_1.logger.error('Failed to deduct VCredits after payment confirm:', vcErr);
            }
        }
        // Re-activate any closed conversations between the customer and each vendor
        try {
            const vendorIds = [...new Set(orderItems.map((i) => i.vendor.toString()))];
            const customerId = req.user.id;
            for (const vendorId of vendorIds) {
                await Conversation_1.default.updateMany({ participants: { $all: [customerId, vendorId], isActive: false } }, { isActive: true });
            }
        }
        catch (convActivateErr) {
            logger_1.logger.error('Error re-activating conversations on order create:', convActivateErr);
        }
        // Step 8: Clear cart
        if (cartToUse) {
            cartToUse.items = [];
            cartToUse.couponCode = undefined;
            cartToUse.discount = 0;
            await cartToUse.save();
            logger_1.logger.info('🛒 Cart cleared after confirmed payment');
        }
        // Step 9: Update coupon usage
        if (order.couponCode) {
            const { Coupon } = await Promise.resolve().then(() => __importStar(require('../models/Additional')));
            await Coupon.findOneAndUpdate({ code: order.couponCode }, {
                $inc: { usageCount: 1 },
                $push: { usedBy: user._id },
            });
        }
        // Step 10: Reduce stock atomically & update sales
        for (const item of order.items) {
            const product = await Product_1.default.findById(item.product);
            if (!product)
                continue;
            const productType = product.productType?.toUpperCase();
            const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
            if (isPhysical) {
                // Atomic decrement — only succeeds if sufficient stock remains.
                // This prevents two concurrent payments from both draining the last unit.
                const updated = await Product_1.default.findOneAndUpdate({ _id: item.product, quantity: { $gte: item.quantity } }, { $inc: { quantity: -item.quantity, totalSales: item.quantity } }, { new: true });
                if (!updated) {
                    logger_1.logger.warn(`⚠️ Stock exhausted for product ${item.product} after payment — order ${order._id} oversold`);
                }
                await notifyCartUsersAboutStock(item.product, product.name, product.quantity, item.quantity, req.user.id, product.vendor?.toString() || '', product.lowStockThreshold ?? 10);
            }
            else {
                await Product_1.default.findByIdAndUpdate(item.product, {
                    $inc: { totalSales: item.quantity },
                });
            }
        }
        // Points and affiliate commission credited on delivery — see completeOrder
        // Step 12: Send confirmation email
        try {
            await (0, email_1.sendOrderConfirmationEmail)(user.email, order.orderNumber, order.total);
            logger_1.logger.info('✅ Confirmation email sent');
        }
        catch (error) {
            logger_1.logger.error('Error sending confirmation email:', error);
        }
        // Send notifications to customer and vendors
        try {
            const vendorIds = [...new Set(order.items.map((item) => item.vendor.toString()))];
            await notification_service_1.notificationService.orderPlaced(order._id.toString(), order.orderNumber, order.total, req.user.id, vendorIds);
            await notification_service_1.notificationService.paymentCompleted(order._id.toString(), order.orderNumber, order.total, req.user.id);
            (0, notification_service_1.emitNewOrder)({ orderId: order._id.toString(), orderNumber: order.orderNumber, vendorIds });
        }
        catch (error) {
            logger_1.logger.error('Error sending order notifications:', error);
        }
        logger_1.logger.info('✅ ============================================');
        logger_1.logger.info('✅ PAYMENT CONFIRMED & ORDER CREATED');
        logger_1.logger.info('✅ ============================================');
        res.status(201).json({
            success: true,
            message: 'Payment verified and order created successfully',
            data: {
                order,
                isDigital: isDigitalOnly,
                isFirstOrder,
                firstOrderVendorIds,
            },
        });
    }
    /**
     * Create vendor shipments with ShipBubble
     */
    async createVendorShipments(order, user, vendorGroups, deliveryType) {
        logger_1.logger.info('🚚 ============================================');
        logger_1.logger.info('🚚 CREATE VENDOR SHIPMENTS STARTED');
        logger_1.logger.info('🚚 ============================================');
        logger_1.logger.info('📋 Shipment info:', {
            orderId: order._id,
            orderNumber: order.orderNumber,
            vendorCount: vendorGroups.length,
            deliveryType,
        });
        for (let i = 0; i < vendorGroups.length; i++) {
            const group = vendorGroups[i];
            logger_1.logger.info(`\n📦 -------- Vendor ${i + 1}/${vendorGroups.length} --------`);
            logger_1.logger.info(`📦 Vendor: ${group.vendorName} (${group.vendorId})`);
            const physicalItems = group.items.filter(item => item.isPhysical);
            if (physicalItems.length === 0) {
                logger_1.logger.info(`⏭️ Skipping ${group.vendorName} - no physical items`);
                continue;
            }
            logger_1.logger.info(`📦 Physical items: ${physicalItems.length}/${group.items.length}`);
            try {
                const vendor = await User_1.default.findById(group.vendorId);
                const vendorProfile = await VendorProfile_1.default.findOne({ user: group.vendorId });
                if (!vendor) {
                    logger_1.logger.warn(`⚠️ Vendor user not found: ${group.vendorId}`);
                    continue;
                }
                logger_1.logger.info('👤 Vendor details:', {
                    name: `${vendor.firstName} ${vendor.lastName}`,
                    email: vendor.email,
                    phone: vendor.phone,
                });
                logger_1.logger.info('🏢 Vendor profile:', {
                    hasProfile: !!vendorProfile,
                    businessName: vendorProfile?.businessName,
                    businessAddress: vendorProfile?.businessAddress,
                });
                // Build addresses
                const senderFullAddress = `${group.vendorAddress.street || 'Store Address'}, ${group.vendorAddress.city}, ${group.vendorAddress.state}, ${group.vendorAddress.country}`;
                const receiverFullAddress = `${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.country || 'Nigeria'}`;
                const senderAddress = {
                    name: group.vendorName,
                    phone: vendorProfile?.businessPhone || vendor.phone || '+2348000000000',
                    email: vendorProfile?.businessEmail || vendor.email || 'sender@store.com',
                    address: senderFullAddress,
                };
                const receiverAddress = {
                    name: order.shippingAddress.fullName || `${user.firstName} ${user.lastName}`,
                    phone: order.shippingAddress.phone || user.phone || '+2348000000000',
                    email: user.email,
                    address: receiverFullAddress,
                };
                logger_1.logger.info('📍 SENDER ADDRESS:', {
                    name: senderAddress.name,
                    phone: senderAddress.phone,
                    email: senderAddress.email,
                    address: senderAddress.address,
                });
                logger_1.logger.info('📍 RECEIVER ADDRESS:', {
                    name: receiverAddress.name,
                    phone: receiverAddress.phone,
                    email: receiverAddress.email,
                    address: receiverAddress.address,
                });
                const packageItems = physicalItems.map((item) => ({
                    name: item.productName,
                    description: item.productName,
                    unit_weight: item.weight.toString(),
                    unit_amount: item.price.toString(),
                    quantity: item.quantity.toString(),
                }));
                logger_1.logger.info('📦 Package items:', packageItems);
                // ✅ FIX: Determine category for ShipBubble
                const categoryId = this.determineCategoryForItems(physicalItems);
                // Step 1: Get delivery rates
                logger_1.logger.info('🔍 Fetching delivery rates from ShipBubble...');
                const ratesResponse = await shipbubble_service_1.shipBubbleService.getDeliveryRates(senderAddress, receiverAddress, packageItems, undefined, categoryId // ✅ Pass correct category
                );
                logger_1.logger.info('📊 Rates response:', {
                    status: ratesResponse.status,
                    message: ratesResponse.message,
                    hasData: !!ratesResponse.data,
                    requestToken: ratesResponse.data?.request_token,
                    courierCount: ratesResponse.data?.couriers?.length || 0,
                });
                if (ratesResponse.status === 'success' && ratesResponse.data?.request_token) {
                    logger_1.logger.info('✅ Delivery rates fetched successfully');
                    // Select courier based on delivery type
                    let selectedCourier;
                    if (deliveryType === 'express' || deliveryType === 'same_day') {
                        selectedCourier = ratesResponse.data.fastest_courier || ratesResponse.data.couriers[0];
                        logger_1.logger.info('⚡ Selected fastest courier');
                    }
                    else {
                        selectedCourier = ratesResponse.data.cheapest_courier || ratesResponse.data.couriers[0];
                        logger_1.logger.info('💰 Selected cheapest courier');
                    }
                    if (selectedCourier) {
                        logger_1.logger.info('🚚 Selected courier:', {
                            name: selectedCourier.courier_name,
                            id: selectedCourier.courier_id,
                            serviceCode: selectedCourier.service_code,
                            price: selectedCourier.total || selectedCourier.rate_card_amount,
                            eta: selectedCourier.delivery_eta,
                        });
                        // Step 2: Create shipment
                        logger_1.logger.info('📝 Creating ShipBubble shipment...');
                        logger_1.logger.info('📤 Shipment request:', {
                            requestToken: ratesResponse.data.request_token,
                            courierId: selectedCourier.courier_id,
                            serviceCode: selectedCourier.service_code,
                        });
                        const shipment = await shipbubble_service_1.shipBubbleService.createShipment(ratesResponse.data.request_token, selectedCourier.courier_id, selectedCourier.service_code, false // isInvoiceRequired
                        );
                        logger_1.logger.info('📥 Shipment creation response:', {
                            status: shipment.status,
                            message: shipment.message,
                            hasData: !!shipment.data,
                            orderId: shipment.data?.order_id,
                            trackingNumber: shipment.data?.tracking_number,
                            shipmentId: shipment.data?.shipment_id,
                        });
                        // ✅ Extract tracking info
                        const orderId = shipment.data?.order_id;
                        const trackingUrl = shipment.data?.tracking_url;
                        if (orderId && trackingUrl) {
                            logger_1.logger.info('✅ Shipment created successfully:', {
                                orderId: orderId,
                                trackingUrl: trackingUrl,
                                shipmentId: shipment.data.shipment_id,
                                courier: selectedCourier.courier_name,
                            });
                            // Update order with tracking info
                            const vendorShipment = order.vendorShipments.find((vs) => vs.vendor.toString() === group.vendorId);
                            if (vendorShipment) {
                                vendorShipment.trackingNumber = orderId;
                                vendorShipment.shipmentId = shipment.data.shipment_id || orderId;
                                vendorShipment.courier = selectedCourier.courier_name;
                                vendorShipment.status = 'created';
                                vendorShipment.trackingUrl = trackingUrl;
                                logger_1.logger.info('✅ Updated order with tracking info:', {
                                    trackingNumber: vendorShipment.trackingNumber,
                                    shipmentId: vendorShipment.shipmentId,
                                    courier: vendorShipment.courier,
                                    trackingUrl: vendorShipment.trackingUrl,
                                });
                            }
                            await order.save();
                            logger_1.logger.info(`✅ Shipment created for vendor ${group.vendorName}. Order ID: ${orderId}`);
                        }
                        else {
                            logger_1.logger.error('❌ Missing order_id or tracking_url in shipment response:', {
                                hasOrderId: !!orderId,
                                hasTrackingUrl: !!trackingUrl,
                                response: shipment,
                            });
                        }
                    }
                    else {
                        logger_1.logger.error('❌ No courier selected from rates');
                    }
                }
                else {
                    logger_1.logger.error('❌ Failed to get delivery rates:', {
                        status: ratesResponse.status,
                        message: ratesResponse.message,
                    });
                }
            }
            catch (error) {
                logger_1.logger.error(`❌ Error creating shipment for vendor ${group.vendorName}:`, {
                    error: error.message,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    stack: error.stack,
                });
            }
        }
        logger_1.logger.info('🚚 ============================================');
        logger_1.logger.info('🚚 CREATE VENDOR SHIPMENTS COMPLETED');
        logger_1.logger.info('🚚 ============================================\n');
    }
    /**
     * Verify payment - Supports Paystack and Flutterwave
     */
    async verifyPayment(req, res) {
        const { reference } = req.params;
        const { provider, transaction_id } = req.query;
        logger_1.logger.info('💳 ============================================');
        logger_1.logger.info('💳 VERIFY PAYMENT STARTED');
        logger_1.logger.info('💳 ============================================');
        logger_1.logger.info('🔍 Payment reference:', reference);
        logger_1.logger.info('🔍 Provider:', provider || 'paystack (default)');
        logger_1.logger.info('🔍 Transaction ID:', transaction_id || 'N/A');
        const order = await Order_1.default.findOne({
            orderNumber: reference,
            user: req.user?.id,
        }).populate('items.product');
        if (!order) {
            throw new error_1.AppError('Order not found', 404);
        }
        logger_1.logger.info('📦 Order found:', {
            orderId: order._id,
            orderNumber: order.orderNumber,
            status: order.status,
            paymentStatus: order.paymentStatus,
            paymentMethod: order.paymentMethod,
        });
        if (order.paymentStatus === types_1.PaymentStatus.COMPLETED) {
            logger_1.logger.info('✅ Payment already verified');
            res.json({
                success: true,
                message: 'Payment already verified',
                data: { order },
            });
            return;
        }
        try {
            let paymentSuccess = false;
            const paymentProvider = provider || order.paymentMethod || 'paystack';
            // ✅ Verify with the correct provider
            if (paymentProvider === 'flutterwave') {
                logger_1.logger.info('🔍 Verifying payment with Flutterwave...');
                let verification;
                if (transaction_id) {
                    // Verify by Flutterwave transaction ID (from redirect URL params)
                    verification = await flutterwave_service_1.flutterwaveService.verifyPayment(transaction_id);
                }
                else {
                    // Verify by tx_ref (our order number)
                    verification = await flutterwave_service_1.flutterwaveService.verifyPaymentByRef(reference);
                }
                logger_1.logger.info('📥 Flutterwave verification response:', {
                    status: verification.data?.status,
                    amount: verification.data?.amount,
                    currency: verification.data?.currency,
                });
                // Flutterwave uses 'successful' status
                if (verification.data?.status === 'successful') {
                    // Verify amount matches
                    if (verification.data.amount >= order.total) {
                        paymentSuccess = true;
                    }
                    else {
                        logger_1.logger.error('❌ Amount mismatch:', {
                            expected: order.total,
                            received: verification.data.amount,
                        });
                        throw new error_1.AppError('Payment amount does not match order total', 400);
                    }
                }
            }
            else {
                // Default: Paystack
                logger_1.logger.info('🔍 Verifying payment with Paystack...');
                const verification = await paystack_service_1.paystackService.verifyPayment(reference);
                logger_1.logger.info('📥 Paystack verification response:', {
                    status: verification.data.status,
                    amount: verification.data.amount,
                });
                if (verification.data.status === 'success') {
                    // Paystack returns amount in kobo (100 kobo = ₦1)
                    const paidNaira = verification.data.amount / 100;
                    if (paidNaira >= order.total) {
                        paymentSuccess = true;
                    }
                    else {
                        logger_1.logger.error('❌ Paystack amount mismatch:', {
                            expected: order.total,
                            received: paidNaira,
                        });
                        throw new error_1.AppError('Payment amount does not match order total', 400);
                    }
                }
            }
            if (paymentSuccess) {
                logger_1.logger.info('✅ Payment verified successfully');
                const isDigitalOnly = this.isDigitalOnly(order.items);
                logger_1.logger.info('📦 Order type:', { isDigitalOnly });
                // Atomic: only mark completed if still pending — prevents double stock-decrement on concurrent calls
                const processedOrder = await Order_1.default.findOneAndUpdate({ _id: order._id, paymentStatus: types_1.PaymentStatus.PENDING }, {
                    paymentStatus: types_1.PaymentStatus.COMPLETED,
                    status: isDigitalOnly ? types_1.OrderStatus.DELIVERED : types_1.OrderStatus.PENDING,
                }, { new: true });
                if (!processedOrder) {
                    logger_1.logger.info('⚠️ Order already completed by concurrent request — skipping stock decrement');
                    res.json({ success: true, message: 'Payment already verified', data: { order } });
                    return;
                }
                logger_1.logger.info('✅ Order status updated:', {
                    status: processedOrder.status,
                    paymentStatus: processedOrder.paymentStatus,
                });
                // Reduce product quantities
                logger_1.logger.info('📊 Updating product quantities...');
                for (const item of order.items) {
                    const product = await Product_1.default.findById(item.product);
                    if (!product)
                        continue;
                    const productType = product.productType?.toUpperCase();
                    const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
                    if (isPhysical) {
                        // Atomic: $gte guard prevents quantity going negative if two payments race
                        const stockUpdated = await Product_1.default.findOneAndUpdate({ _id: item.product, quantity: { $gte: item.quantity } }, { $inc: { quantity: -item.quantity, totalSales: item.quantity } });
                        if (!stockUpdated) {
                            logger_1.logger.warn(`⚠️ Stock exhausted for product ${item.product} in verifyPayment — oversold`);
                        }
                        logger_1.logger.info(`✅ Updated physical product: ${product.name}`);
                    }
                    else {
                        await Product_1.default.findByIdAndUpdate(item.product, {
                            $inc: { totalSales: item.quantity },
                        });
                        logger_1.logger.info(`✅ Updated digital product: ${product.name}`);
                    }
                }
                // ✅ Digital products are instantly accessible
                if (isDigitalOnly) {
                    logger_1.logger.info(`✅ Digital order payment verified - instant access granted: ${order.orderNumber}`);
                }
                // ✅ Shipment will be created when vendor updates order status
                logger_1.logger.info('📦 Shipment will be created when vendor confirms/processes order');
                // Points credited on delivery — see completeOrder
                // Send confirmation email
                const user = await User_1.default.findById(order.user);
                if (user) {
                    await (0, email_1.sendOrderConfirmationEmail)(user.email, order.orderNumber, order.total);
                    logger_1.logger.info('✅ Confirmation email sent');
                }
                logger_1.logger.info('💳 ============================================');
                logger_1.logger.info('💳 VERIFY PAYMENT COMPLETED');
                logger_1.logger.info('💳 ============================================\n');
                res.json({
                    success: true,
                    message: 'Payment verified successfully',
                    data: {
                        order,
                        isDigital: isDigitalOnly,
                    },
                });
            }
            else {
                logger_1.logger.error('❌ Payment verification failed');
                order.paymentStatus = types_1.PaymentStatus.FAILED;
                order.status = types_1.OrderStatus.FAILED;
                await order.save();
                throw new error_1.AppError('Payment verification failed', 400);
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Payment verification error:', error.message);
            if (error instanceof error_1.AppError)
                throw error;
            throw new error_1.AppError('Failed to verify payment', 500);
        }
    }
    /**
     * Check if the current user has an active order involving a counterparty.
     * Customers check by vendor (items.vendor), vendors check by buyer (user).
     */
    async checkActiveOrderWith(req, res) {
        const { counterpartyId } = req.params;
        const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
        const userId = req.user.id;
        // Always check both directions — a vendor can also be a buyer
        const [asSeller, asBuyer] = await Promise.all([
            // counterparty placed an order with me as vendor
            Order_1.default.findOne({
                'items.vendor': userId,
                user: counterpartyId,
                status: { $in: ACTIVE_STATUSES },
            }).select('_id').lean(),
            // I placed an order with counterparty as vendor
            Order_1.default.findOne({
                user: userId,
                'items.vendor': counterpartyId,
                status: { $in: ACTIVE_STATUSES },
            }).select('_id').lean(),
        ]);
        res.json({ success: true, data: { hasActiveOrder: !!(asSeller || asBuyer) } });
    }
    /**
     * Return all user IDs the current user has active orders with — bulk version of checkActiveOrderWith
     * GET /orders/active-partners
     */
    async getActivePartners(req, res) {
        const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
        const userId = req.user.id;
        // Always check both directions — a vendor can also be a buyer
        const [asSeller, asBuyer] = await Promise.all([
            // Orders where this user is a vendor → return buyer IDs
            Order_1.default.find({ 'items.vendor': userId, status: { $in: ACTIVE_STATUSES } })
                .select('user').lean(),
            // Orders where this user is the buyer → return vendor IDs
            Order_1.default.find({ user: userId, status: { $in: ACTIVE_STATUSES } })
                .select('items.vendor').lean(),
        ]);
        const sellerPartners = asSeller.map((o) => o.user.toString());
        const buyerPartners = asBuyer.flatMap((o) => o.items.map((i) => i.vendor.toString()));
        const partnerIds = [...new Set([...sellerPartners, ...buyerPartners])];
        res.json({ success: true, data: { partnerIds } });
    }
    /**
     * Return count of active orders for the current user (tab badge)
     * GET /orders/active-count
     */
    async getActiveOrderCount(req, res) {
        const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
        const userId = req.user.id;
        const role = req.user.role;
        // Vendors see their incoming orders; customers see their placed orders
        // A vendor who also shops uses the vendor count for the tab badge
        let count = 0;
        if (role === 'vendor') {
            count = await Order_1.default.countDocuments({
                'items.vendor': userId,
                status: { $in: ACTIVE_STATUSES },
            });
        }
        else {
            count = await Order_1.default.countDocuments({
                user: userId,
                status: { $in: ACTIVE_STATUSES },
            });
        }
        res.json({ success: true, data: { count } });
    }
    /**
     * Get active orders with a counterparty (for chat order context card)
     * GET /orders/active-with/:counterpartyId
     */
    async getActiveOrdersWith(req, res) {
        const { counterpartyId } = req.params;
        const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
        const userId = req.user.id;
        // Always check both directions — a vendor can also be a buyer
        const [asSeller, asBuyer] = await Promise.all([
            // counterparty placed an order with me as vendor → show my items
            Order_1.default.find({
                'items.vendor': userId,
                user: counterpartyId,
                status: { $in: ACTIVE_STATUSES },
            }).select('orderNumber status items').lean(),
            // I placed an order with counterparty as vendor → show their items
            Order_1.default.find({
                user: userId,
                'items.vendor': counterpartyId,
                status: { $in: ACTIVE_STATUSES },
            }).select('orderNumber status items').lean(),
        ]);
        const formatAsSeller = (o) => {
            const myItems = o.items.filter((i) => i.vendor?.toString() === userId);
            return {
                _id: o._id,
                orderNumber: o.orderNumber,
                status: o.status,
                isSeller: true,
                items: myItems.map((i) => ({
                    name: i.productName,
                    image: i.productImage,
                    quantity: i.quantity,
                    price: i.price,
                })),
                vendorTotal: myItems.reduce((s, i) => s + i.price * i.quantity, 0),
            };
        };
        const formatAsBuyer = (o) => {
            const theirItems = o.items.filter((i) => i.vendor?.toString() === counterpartyId);
            return {
                _id: o._id,
                orderNumber: o.orderNumber,
                status: o.status,
                isSeller: false,
                items: theirItems.map((i) => ({
                    name: i.productName,
                    image: i.productImage,
                    quantity: i.quantity,
                    price: i.price,
                })),
                vendorTotal: theirItems.reduce((s, i) => s + i.price * i.quantity, 0),
            };
        };
        // Merge, dedup by _id (an order can't appear in both queries), sort newest first
        const seen = new Set();
        const orders = [];
        for (const o of asSeller) {
            const id = o._id.toString();
            if (!seen.has(id)) {
                seen.add(id);
                orders.push(formatAsSeller(o));
            }
        }
        for (const o of asBuyer) {
            const id = o._id.toString();
            if (!seen.has(id)) {
                seen.add(id);
                orders.push(formatAsBuyer(o));
            }
        }
        res.json({ success: true, data: { orders } });
    }
    /**
     * Get user orders
     */
    async getUserOrders(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const filter = { user: req.user?.id };
        if (req.query.status) {
            filter.status = req.query.status;
        }
        const orders = await Order_1.default.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('items.product', 'name images');
        const total = await Order_1.default.countDocuments(filter);
        res.json({
            success: true,
            data: { orders },
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    /**
     * Get single order
     */
    async getOrder(req, res) {
        const { id } = req.params;
        // Support lookup by either MongoDB _id or orderNumber (payment reference)
        const query = mongoose_1.default.isValidObjectId(id)
            ? { $or: [{ _id: id }, { orderNumber: id }], user: req.user?.id }
            : { orderNumber: id, user: req.user?.id };
        const order = await Order_1.default.findOne(query)
            .populate('items.product', 'name images slug productType digitalFile')
            .populate('items.vendor', 'firstName lastName email')
            .populate('vendorShipments.vendor', 'firstName lastName');
        if (!order) {
            throw new error_1.AppError('Order not found', 404);
        }
        res.json({
            success: true,
            data: { order },
        });
    }
    /**
     * Get single order for vendor
     */
    async getVendorOrder(req, res) {
        const order = await Order_1.default.findById(req.params.id)
            .populate('user', 'firstName lastName email phone')
            .populate('items.product', 'name images slug productType digitalFile')
            .populate('items.vendor', 'firstName lastName email')
            .populate('vendorShipments.vendor', 'firstName lastName');
        if (!order) {
            throw new error_1.AppError('Order not found', 404);
        }
        const hasVendorItems = order.items.some(item => item.vendor && item.vendor.toString() === req.user?.id ||
            (typeof item.vendor === 'object' && item.vendor._id?.toString() === req.user?.id));
        if (!hasVendorItems) {
            throw new error_1.AppError('Not authorized to view this order', 403);
        }
        const vendorItems = order.items.filter(item => item.vendor && (item.vendor.toString() === req.user?.id ||
            (typeof item.vendor === 'object' && item.vendor._id?.toString() === req.user?.id)));
        const vendorShipment = order.vendorShipments?.find((shipment) => {
            const shipVendorId = typeof shipment.vendor === 'object'
                ? shipment.vendor._id?.toString()
                : shipment.vendor?.toString();
            return shipVendorId === req.user?.id;
        });
        const totalVendorOrders = await Order_1.default.countDocuments({ 'items.vendor': new mongoose_1.default.Types.ObjectId(req.user.id) });
        const orderData = {
            ...order.toObject(),
            items: vendorItems,
            vendorShipment: vendorShipment || null,
            isFirstVendorOrder: totalVendorOrders === 1,
        };
        res.json({
            success: true,
            data: { order: orderData },
        });
    }
    /**
     * Get user's digital products
     */
    async getUserDigitalProducts(req, res) {
        const orders = await Order_1.default.find({
            user: req.user?.id,
            paymentStatus: types_1.PaymentStatus.COMPLETED,
        })
            .populate('items.product')
            .sort({ createdAt: -1 });
        const digitalProducts = [];
        for (const order of orders) {
            for (let i = 0; i < order.items.length; i++) {
                const item = order.items[i];
                const product = item.product;
                if (!product)
                    continue;
                const productType = product.productType?.toUpperCase();
                const isDigital = productType === 'DIGITAL' || productType === 'SERVICE';
                if (isDigital) {
                    digitalProducts.push({
                        orderId: order._id,
                        orderNumber: order.orderNumber,
                        itemId: item._id || `${order._id}-${i}`,
                        product: {
                            _id: product._id,
                            name: product.name,
                            slug: product.slug,
                            image: product.images[0],
                            productType: product.productType,
                        },
                        purchaseDate: order.createdAt,
                        downloadUrl: product.digitalFile?.url || product.downloadLink,
                        fileSize: product.digitalFile?.fileSize,
                        fileType: product.digitalFile?.fileType,
                        version: product.digitalFile?.version,
                    });
                }
            }
        }
        logger_1.logger.info(`📦 Found ${digitalProducts.length} digital products for user ${req.user?.id}`);
        res.json({
            success: true,
            data: {
                digitalProducts,
                total: digitalProducts.length,
            },
        });
    }
    /**
     * Download digital product
     */
    async downloadDigitalProduct(req, res) {
        const { id: orderId, itemId } = req.params;
        const order = await Order_1.default.findOne({
            _id: orderId,
            user: req.user?.id,
            paymentStatus: types_1.PaymentStatus.COMPLETED,
        }).populate('items.product');
        if (!order) {
            throw new error_1.AppError('Order not found or payment not completed', 404);
        }
        let item = null;
        if (itemId.includes('-')) {
            const index = parseInt(itemId.split('-').pop() || '0');
            item = order.items[index];
        }
        else {
            item = order.items.find((i) => i._id?.toString() === itemId);
        }
        if (!item) {
            throw new error_1.AppError('Product not found in order', 404);
        }
        const product = item.product;
        if (!product) {
            throw new error_1.AppError('Product not found', 404);
        }
        const productType = product.productType?.toUpperCase();
        const isDigital = productType === 'DIGITAL' || productType === 'SERVICE';
        if (!isDigital) {
            throw new error_1.AppError('This product is not a digital product', 400);
        }
        const downloadUrl = product.digitalFile?.url || product.downloadLink;
        if (!downloadUrl) {
            throw new error_1.AppError('Download URL not available', 404);
        }
        logger_1.logger.info(`📥 User ${req.user?.id} downloading product ${product.name} from order ${order.orderNumber}`);
        res.json({
            success: true,
            data: {
                downloadUrl,
                product: {
                    name: product.name,
                    fileSize: product.digitalFile?.fileSize,
                    fileType: product.digitalFile?.fileType,
                    version: product.digitalFile?.version,
                },
            },
        });
    }
    /**
     * Track order shipment
     */
    async trackOrder(req, res) {
        const { id } = req.params;
        logger_1.logger.info('📍 ============================================');
        logger_1.logger.info('📍 TRACK ORDER REQUEST');
        logger_1.logger.info('📍 ============================================');
        logger_1.logger.info('📦 Order ID:', id);
        const order = await Order_1.default.findOne({
            _id: id,
            user: req.user?.id,
        }).populate('vendorShipments.vendor', 'firstName lastName');
        if (!order) {
            throw new error_1.AppError('Order not found', 404);
        }
        logger_1.logger.info('📦 Order found:', {
            orderNumber: order.orderNumber,
            status: order.status,
            hasVendorShipments: !!order.vendorShipments?.length,
        });
        // ✅ Handle multi-vendor shipments
        if (order.vendorShipments && order.vendorShipments.length > 0) {
            logger_1.logger.info(`📦 Multi-vendor order with ${order.vendorShipments.length} shipment(s)`);
            const trackingData = await Promise.all(order.vendorShipments.map(async (shipment) => {
                const trackingInfo = {
                    vendor: shipment.vendorName,
                    trackingNumber: shipment.trackingNumber,
                    trackingUrl: shipment.trackingUrl,
                    tracking: null,
                    status: shipment.status,
                    courier: shipment.courier,
                };
                if (!shipment.trackingNumber && !shipment.trackingUrl) {
                    logger_1.logger.warn(`⚠️ No tracking info for vendor ${shipment.vendorName}`);
                    return trackingInfo;
                }
                if (shipment.trackingNumber) {
                    try {
                        logger_1.logger.info(`🔍 Fetching tracking for ${shipment.trackingNumber}...`);
                        const tracking = await shipbubble_service_1.shipBubbleService.trackShipment(shipment.trackingNumber);
                        trackingInfo.tracking = tracking.data;
                        logger_1.logger.info(`✅ Tracking retrieved for ${shipment.trackingNumber}`);
                    }
                    catch (error) {
                        logger_1.logger.error(`❌ Error tracking shipment ${shipment.trackingNumber}:`, error);
                    }
                }
                return trackingInfo;
            }));
            logger_1.logger.info(`✅ Returning tracking data for ${trackingData.length} shipment(s)`);
            res.json({
                success: true,
                data: {
                    order,
                    tracking: trackingData,
                    multiVendor: true,
                },
            });
            return;
        }
        // ✅ Single shipment handling
        logger_1.logger.info('📦 Single shipment order');
        if (order.trackingUrl) {
            logger_1.logger.info('✅ Tracking URL available:', order.trackingUrl);
            res.json({
                success: true,
                data: {
                    order,
                    trackingUrl: order.trackingUrl,
                    tracking: null,
                },
            });
            return;
        }
        if (!order.trackingNumber) {
            logger_1.logger.info('⚠️ No tracking information available yet');
            res.json({
                success: true,
                message: 'Tracking information not available yet',
                data: {
                    order,
                    tracking: null,
                },
            });
            return;
        }
        try {
            logger_1.logger.info(`🔍 Fetching tracking for ${order.trackingNumber}...`);
            const tracking = await shipbubble_service_1.shipBubbleService.trackShipment(order.trackingNumber);
            logger_1.logger.info('✅ Tracking retrieved successfully');
            res.json({
                success: true,
                data: {
                    order,
                    tracking: tracking.data,
                },
            });
        }
        catch (error) {
            logger_1.logger.error('❌ Error tracking shipment:', error);
            res.json({
                success: true,
                message: 'Could not retrieve tracking information',
                data: {
                    order,
                    tracking: null,
                    trackingUrl: order.trackingUrl || null,
                },
            });
        }
    }
    /**
     * Cancel order
     */
    async cancelOrder(req, res) {
        const { cancelReason } = req.body;
        const order = await Order_1.default.findOne({
            _id: req.params.id,
            user: req.user?.id,
        });
        if (!order) {
            throw new error_1.AppError('Order not found', 404);
        }
        if (![types_1.OrderStatus.PENDING, types_1.OrderStatus.CONFIRMED].includes(order.status)) {
            throw new error_1.AppError('Order cannot be cancelled at this stage', 400);
        }
        order.status = types_1.OrderStatus.CANCELLED;
        order.cancelReason = cancelReason;
        await order.save();
        // Cancel shipments — always mark status cancelled; only call ShipBubble if tracked
        if (order.vendorShipments && order.vendorShipments.length > 0) {
            for (const shipment of order.vendorShipments) {
                shipment.status = 'cancelled';
                if (shipment.trackingNumber) {
                    try {
                        await shipbubble_service_1.shipBubbleService.cancelShipment(shipment.trackingNumber);
                        logger_1.logger.info(`ShipBubble shipment cancelled: ${shipment.trackingNumber}`);
                    }
                    catch (error) {
                        logger_1.logger.error(`Error cancelling ShipBubble shipment ${shipment.trackingNumber}:`, error);
                    }
                }
            }
            await order.save();
        }
        if (order.trackingNumber) {
            try {
                await shipbubble_service_1.shipBubbleService.cancelShipment(order.trackingNumber);
                logger_1.logger.info(`ShipBubble shipment cancelled: ${order.trackingNumber}`);
            }
            catch (error) {
                logger_1.logger.error('Error cancelling ShipBubble shipment:', error);
            }
        }
        // Restore product quantities (physical products only)
        for (const item of order.items) {
            const product = await Product_1.default.findById(item.product);
            if (!product)
                continue;
            const productType = product.productType?.toUpperCase();
            const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
            if (isPhysical) {
                await Product_1.default.findByIdAndUpdate(item.product, {
                    $inc: {
                        quantity: item.quantity,
                        totalSales: -item.quantity,
                    },
                });
            }
        }
        // Refund if payment completed
        if (order.paymentStatus === types_1.PaymentStatus.COMPLETED) {
            const wallet = await Additional_1.Wallet.findOne({ user: req.user?.id });
            if (wallet) {
                wallet.balance += order.total;
                wallet.transactions.push({
                    type: types_1.TransactionType.CREDIT,
                    amount: order.total,
                    purpose: types_1.WalletPurpose.REFUND,
                    reference: `REF-${order.orderNumber}`,
                    description: `Refund for cancelled order ${order.orderNumber}`,
                    relatedOrder: order._id,
                    status: 'completed',
                    timestamp: new Date(),
                });
                await wallet.save();
            }
            order.paymentStatus = types_1.PaymentStatus.REFUNDED;
            order.refundAmount = order.total;
            order.refundReason = cancelReason;
            await order.save();
            // Notify customer about refund
            try {
                await notification_service_1.notificationService.refundIssued(req.user.id, order.orderNumber, order.total);
            }
            catch (error) {
                logger_1.logger.error('Error sending refund notification:', error);
            }
        }
        // Notify vendors about cancellation
        try {
            const vendorIds = [...new Set(order.items.map((item) => item.vendor.toString()))];
            await notification_service_1.notificationService.orderCancelled(order._id.toString(), order.orderNumber, req.user.id, vendorIds, 'customer');
        }
        catch (error) {
            logger_1.logger.error('Error sending cancel notifications:', error);
        }
        res.json({
            success: true,
            message: 'Order cancelled successfully',
            data: { order },
        });
    }
    /**
     * Cancel a single vendor's shipment within a multi-vendor order
     */
    async cancelVendorShipment(req, res) {
        const { cancelReason } = req.body;
        const { id: orderId, vendorId } = req.params;
        const order = await Order_1.default.findOne({ _id: orderId, user: req.user?.id });
        if (!order)
            throw new error_1.AppError('Order not found', 404);
        const shipments = order.vendorShipments;
        if (!shipments || shipments.length === 0) {
            throw new error_1.AppError('This order has no vendor shipments', 400);
        }
        const shipment = shipments.find((s) => s.vendor.toString() === vendorId);
        if (!shipment)
            throw new error_1.AppError('Vendor shipment not found', 404);
        if (shipment.status === 'cancelled') {
            throw new error_1.AppError('This shipment is already cancelled', 400);
        }
        if (['shipped', 'in_transit', 'delivered'].includes(shipment.status)) {
            throw new error_1.AppError('This shipment cannot be cancelled — it has already been shipped', 400);
        }
        // Mark the shipment cancelled
        shipment.status = 'cancelled';
        // Cancel ShipBubble shipment if tracked
        if (shipment.trackingNumber) {
            try {
                await shipbubble_service_1.shipBubbleService.cancelShipment(shipment.trackingNumber);
                logger_1.logger.info(`ShipBubble shipment cancelled: ${shipment.trackingNumber}`);
            }
            catch (error) {
                logger_1.logger.error(`Error cancelling ShipBubble shipment ${shipment.trackingNumber}:`, error);
            }
        }
        // Restore stock for this vendor's items only
        const vendorItems = order.items.filter((item) => item.vendor.toString() === vendorId);
        for (const item of vendorItems) {
            const product = await Product_1.default.findById(item.product);
            if (!product)
                continue;
            const productType = product.productType?.toUpperCase();
            const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
            if (isPhysical) {
                await Product_1.default.findByIdAndUpdate(item.product, {
                    $inc: { quantity: item.quantity, totalSales: -item.quantity },
                });
            }
        }
        // Calculate refund: vendor items subtotal + their shipping cost
        const vendorItemsTotal = vendorItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const refundAmount = vendorItemsTotal + (shipment.shippingCost || 0);
        // If all shipments are now cancelled → cancel the whole order
        const allCancelled = shipments.every((s) => s.status === 'cancelled');
        if (allCancelled) {
            order.status = types_1.OrderStatus.CANCELLED;
            order.cancelReason = cancelReason;
        }
        await order.save();
        // Refund if payment was completed
        if (order.paymentStatus === types_1.PaymentStatus.COMPLETED && refundAmount > 0) {
            const wallet = await Additional_1.Wallet.findOne({ user: req.user?.id });
            if (wallet) {
                wallet.balance += refundAmount;
                wallet.transactions.push({
                    type: types_1.TransactionType.CREDIT,
                    amount: refundAmount,
                    purpose: types_1.WalletPurpose.REFUND,
                    reference: `REF-${order.orderNumber}-${vendorId.slice(-6)}`,
                    description: `Refund for cancelled shipment from ${shipment.vendorName} on order ${order.orderNumber}`,
                    relatedOrder: order._id,
                    status: 'completed',
                    timestamp: new Date(),
                });
                await wallet.save();
            }
            if (allCancelled) {
                order.paymentStatus = types_1.PaymentStatus.REFUNDED;
                order.refundAmount = refundAmount;
            }
            order.refundReason = cancelReason;
            await order.save();
            // Notify customer about refund
            try {
                await notification_service_1.notificationService.refundIssued(req.user.id, order.orderNumber, refundAmount);
            }
            catch (error) {
                logger_1.logger.error('Error sending refund notification:', error);
            }
        }
        // Notify the specific vendor
        try {
            await notification_service_1.notificationService.orderCancelled(order._id.toString(), order.orderNumber, req.user.id, [vendorId], 'customer');
        }
        catch (error) {
            logger_1.logger.error('Error sending cancel notification to vendor:', error);
        }
        res.json({
            success: true,
            message: `${shipment.vendorName}'s order cancelled. ₦${refundAmount.toLocaleString()} will be refunded to your wallet.`,
            data: { order },
        });
    }
    /**
     * Get vendor orders
     */
    async getVendorOrders(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { status } = req.query;
        // Always fetch by vendor's items; status filter applied per-shipment below
        const query = { 'items.vendor': req.user?.id };
        const orders = await Order_1.default.find(query)
            .sort({ createdAt: -1 })
            .populate('user', 'firstName lastName email')
            .populate('items.product', 'name images');
        const mapped = orders.map(order => {
            const vendorItems = order.items.filter(item => item.vendor.toString() === req.user?.id);
            const vendorShipment = order.vendorShipments?.find((shipment) => shipment.vendor.toString() === req.user?.id);
            // Effective status: vendorShipment.status if present, else order.status
            // order.status=cancelled always wins for whole-order cancels
            const effectiveStatus = order.status === 'cancelled'
                ? 'cancelled'
                : (vendorShipment?.status || order.status);
            const vendorTotal = vendorItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const vendorShippingCost = vendorShipment?.shippingCost ?? 0;
            return {
                ...order.toObject(),
                items: vendorItems,
                vendorShipment,
                effectiveStatus,
                vendorTotal,
                vendorShippingCost,
                total: vendorTotal + vendorShippingCost,
            };
        });
        // Filter by effective per-vendor status if requested
        const filteredOrders = status
            ? mapped.filter(o => o.effectiveStatus === status)
            : mapped;
        const total = filteredOrders.length;
        const pagedOrders = filteredOrders.slice(skip, skip + limit);
        res.json({
            success: true,
            data: { orders: pagedOrders },
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    /**
     * Update order status (vendor)
     */
    async updateOrderStatus(req, res) {
        const { status } = req.body;
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('🔄 UPDATE ORDER STATUS STARTED');
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('📋 Status update request:', {
            orderId: req.params.id,
            newStatus: status,
            vendorId: req.user?.id,
        });
        const order = await Order_1.default.findById(req.params.id)
            .populate('user')
            .populate('items.product');
        if (!order) {
            throw new error_1.AppError('Order not found', 404);
        }
        logger_1.logger.info('📦 Order found:', {
            orderNumber: order.orderNumber,
            currentStatus: order.status,
            isDigital: order.isDigital,
            deliveryType: order.deliveryType,
        });
        const hasVendorItems = order.items.some(item => item.vendor.toString() === req.user?.id);
        if (!hasVendorItems) {
            throw new error_1.AppError('Not authorized', 403);
        }
        logger_1.logger.info('✅ Vendor has items in order');
        // Once ShipBubble has a tracking number, statuses beyond 'processing' are
        // driven by ShipBubble webhooks — block manual overrides to avoid conflicts
        const vendorShipmentForGuard = order.vendorShipments?.find((s) => {
            const vid = typeof s.vendor === 'object'
                ? (s.vendor._id?.toString() ?? s.vendor.toString())
                : s.vendor?.toString();
            return vid === req.user?.id;
        });
        const shipbubbleOwnedStatuses = ['shipped', 'in_transit', 'delivered'];
        if (vendorShipmentForGuard?.trackingNumber && shipbubbleOwnedStatuses.includes(status)) {
            res.status(400).json({
                success: false,
                message: 'This shipment is now tracked by ShipBubble. Status updates beyond processing are automatic.',
            });
            return;
        }
        // Guard: if the vendor's shipment is already at this status, do nothing
        const currentVendorStatus = vendorShipmentForGuard?.status || order.status;
        if (currentVendorStatus === status) {
            res.json({
                success: true,
                message: 'Order is already at this status',
                data: { order },
            });
            return;
        }
        // Update status
        const oldStatus = order.status;
        const vendorShipmentsList = order.vendorShipments;
        const isMultiVendor = vendorShipmentsList && vendorShipmentsList.length > 1;
        if (isMultiVendor) {
            // Update only this vendor's shipment entry (store the full order-status vocabulary)
            const thisVendorShipment = vendorShipmentsList.find((s) => {
                const vid = typeof s.vendor === 'object'
                    ? (s.vendor._id?.toString() ?? s.vendor.toString())
                    : s.vendor?.toString();
                return vid === req.user?.id;
            });
            if (thisVendorShipment) {
                thisVendorShipment.status = status;
            }
            // Derive the overall order status from all vendor shipments.
            // Uses minimum-progress: the order only advances when ALL active vendors reach that stage.
            const allShipmentStatuses = vendorShipmentsList.map((s) => s.status);
            const activeStatuses = allShipmentStatuses.filter(s => s !== 'cancelled');
            if (allShipmentStatuses.every(s => s === 'cancelled')) {
                order.status = types_1.OrderStatus.CANCELLED;
            }
            else if (activeStatuses.every(s => s === 'delivered')) {
                // All active vendors delivered (also covers some-cancelled + rest-delivered)
                order.status = types_1.OrderStatus.DELIVERED;
            }
            else if (activeStatuses.every(s => ['in_transit', 'delivered'].includes(s))) {
                order.status = types_1.OrderStatus.IN_TRANSIT;
            }
            else if (activeStatuses.every(s => ['shipped', 'in_transit', 'delivered'].includes(s))) {
                order.status = types_1.OrderStatus.SHIPPED;
            }
            else if (activeStatuses.every(s => ['processing', 'shipped', 'in_transit', 'delivered'].includes(s))) {
                order.status = types_1.OrderStatus.PROCESSING;
            }
            else if (activeStatuses.every(s => ['confirmed', 'processing', 'shipped', 'in_transit', 'delivered'].includes(s))) {
                order.status = types_1.OrderStatus.CONFIRMED;
            }
            else {
                order.status = types_1.OrderStatus.PENDING;
            }
        }
        else {
            // Single-vendor order: update the order status directly
            order.status = status;
            // Keep the single vendorShipment entry in sync so the mobile app's
            // vendorStatus = shipment.status || order.status expression sees the new value
            if (vendorShipmentsList && vendorShipmentsList.length === 1) {
                vendorShipmentsList[0].status = status;
            }
        }
        await order.save();
        logger_1.logger.info('✅ Order status updated:', {
            from: oldStatus,
            to: order.status,
            isMultiVendor,
        });
        // If vendor is cancelling — refund the customer for this vendor's items
        if (status === 'cancelled' && order.paymentStatus === types_1.PaymentStatus.COMPLETED) {
            try {
                const customerId = order.user._id
                    ? order.user._id.toString()
                    : order.user.toString();
                // Calculate refund: this vendor's items subtotal + their shipment's shipping cost
                const vendorItemsForRefund = order.items.filter((item) => item.vendor.toString() === req.user?.id);
                const itemsTotal = vendorItemsForRefund.reduce((sum, item) => sum + item.price * item.quantity, 0);
                const shipmentCost = vendorShipmentForGuard?.shippingCost || 0;
                const refundAmount = itemsTotal + shipmentCost;
                if (refundAmount > 0) {
                    const wallet = await Additional_1.Wallet.findOne({ user: customerId });
                    if (wallet) {
                        wallet.balance += refundAmount;
                        wallet.transactions.push({
                            type: types_1.TransactionType.CREDIT,
                            amount: refundAmount,
                            purpose: types_1.WalletPurpose.REFUND,
                            reference: `REF-${order.orderNumber}-${req.user.id.slice(-6)}`,
                            description: `Refund for vendor cancellation on order ${order.orderNumber}`,
                            relatedOrder: order._id,
                            status: 'completed',
                            timestamp: new Date(),
                        });
                        await wallet.save();
                        logger_1.logger.info(`✅ Refund of ₦${refundAmount} issued to customer ${customerId}`);
                    }
                    // Notify customer about the refund
                    await notification_service_1.notificationService.refundIssued(customerId, order.orderNumber, refundAmount);
                }
            }
            catch (refundError) {
                logger_1.logger.error('❌ Failed to process vendor-cancel refund:', refundError.message);
            }
        }
        // Notify customer about status change + push real-time socket event
        try {
            const customerId = order.user._id
                ? order.user._id.toString()
                : order.user.toString();
            await notification_service_1.notificationService.orderStatusUpdated(order._id.toString(), order.orderNumber, status, customerId);
            const vendorIds = order.vendorShipments
                ?.map((s) => (typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString()))
                .filter(Boolean) ?? [];
            (0, notification_service_1.emitOrderStatusUpdate)({
                orderId: order._id.toString(),
                orderNumber: order.orderNumber,
                status: order.status,
                customerId,
                vendorIds,
            });
        }
        catch (error) {
            logger_1.logger.error('Error sending status update notification:', error);
        }
        // ✅ Create shipment when vendor confirms/processes (only for physical products)
        const vendorShipment = order.vendorShipments?.find((shipment) => {
            const shipVendorId = typeof shipment.vendor === 'object'
                ? shipment.vendor._id?.toString()
                : shipment.vendor?.toString();
            return shipVendorId === req.user?.id;
        });
        const shouldCreateShipment = status === 'processing' &&
            !order.isDigital &&
            order.deliveryType !== 'pickup' &&
            (!vendorShipment?.trackingNumber);
        if (shouldCreateShipment) {
            logger_1.logger.info('🚚 Status change triggers shipment creation');
            logger_1.logger.info('📋 Conditions met:', {
                newStatus: status,
                isDigital: order.isDigital,
                deliveryType: order.deliveryType,
                oldStatus,
                hasExistingTracking: !!vendorShipment?.trackingNumber,
            });
            const user = order.user;
            try {
                logger_1.logger.info('📦 Building vendor groups from order items...');
                const vendorItems = order.items.filter((item) => item.vendor.toString() === req.user?.id);
                if (vendorItems.length === 0) {
                    logger_1.logger.warn('⚠️ No items found for this vendor in order');
                    return;
                }
                logger_1.logger.info(`✅ Found ${vendorItems.length} items for vendor`);
                const vendorProfile = await VendorProfile_1.default.findOne({ user: req.user?.id });
                const vendor = await User_1.default.findById(req.user?.id);
                if (!vendor) {
                    logger_1.logger.error('❌ Vendor user not found');
                    return;
                }
                let vendorAddress = {
                    street: '',
                    city: process.env.SHIPBUBBLE_SENDER_CITY || '',
                    state: process.env.SHIPBUBBLE_SENDER_STATE || '',
                    country: process.env.SHIPBUBBLE_SENDER_COUNTRY || 'Nigeria',
                };
                if (vendorProfile && vendorProfile.businessAddress) {
                    vendorAddress = {
                        street: vendorProfile.businessAddress.street || '',
                        city: vendorProfile.businessAddress.city,
                        state: vendorProfile.businessAddress.state,
                        country: vendorProfile.businessAddress.country,
                    };
                }
                const vendorName = vendorProfile?.businessName ||
                    `${vendor.firstName} ${vendor.lastName}`;
                const vendorGroup = {
                    vendorId: req.user?.id,
                    vendorName,
                    vendorAddress,
                    items: vendorItems.map((item) => {
                        const product = item.product;
                        const productType = product?.productType?.toUpperCase() || item.productType?.toUpperCase();
                        const isPhysical = productType === 'PHYSICAL' ||
                            (!productType || (productType !== 'DIGITAL' && productType !== 'SERVICE'));
                        // ✅ FIX: Use 0.5 KG default instead of 1 KG
                        const weight = product?.weight || 0.5;
                        return {
                            productId: product?._id?.toString() || item.product.toString(),
                            productName: item.productName,
                            quantity: item.quantity,
                            weight: weight,
                            isPhysical: isPhysical,
                            price: item.price,
                        };
                    }),
                    totalWeight: 0,
                };
                vendorGroup.totalWeight = vendorGroup.items
                    .filter(item => item.isPhysical)
                    .reduce((sum, item) => sum + (item.weight * item.quantity), 0);
                logger_1.logger.info('✅ Vendor group built:', {
                    vendorId: vendorGroup.vendorId,
                    vendorName: vendorGroup.vendorName,
                    itemCount: vendorGroup.items.length,
                    physicalItems: vendorGroup.items.filter(i => i.isPhysical).length,
                    totalWeight: vendorGroup.totalWeight,
                });
                await this.createVendorShipments(order, user, [vendorGroup], order.deliveryType || 'standard');
                logger_1.logger.info('✅ Shipment creation completed');
            }
            catch (error) {
                logger_1.logger.error('❌ Error creating shipment on status update:', {
                    error: error.message,
                    stack: error.stack,
                });
            }
        }
        else {
            const skipReason = order.isDigital
                ? 'Digital order'
                : order.deliveryType === 'pickup'
                    ? 'Pickup delivery'
                    : vendorShipment?.trackingNumber
                        ? 'Tracking number already exists'
                        : 'Status not confirmed/processing/shipped';
            logger_1.logger.info('⏭️ Shipment creation not triggered:', {
                reason: skipReason,
                currentStatus: status,
                hasTracking: !!vendorShipment?.trackingNumber,
            });
        }
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('🔄 UPDATE ORDER STATUS COMPLETED');
        logger_1.logger.info('🔄 ============================================\n');
        res.json({
            success: true,
            message: 'Order status updated',
            data: { order },
        });
    }
    /**
     * Complete order (customer confirms delivery)
     * Only the order's customer can complete it, and only if status is in_transit or delivered
     */
    async completeOrder(req, res) {
        const { id } = req.params;
        const userId = req.user.id;
        // Atomic: set fundsReleased=true in one operation — prevents double vendor payout
        // from concurrent customer clicks OR race with the 24-hour auto-complete job
        const order = await Order_1.default.findOneAndUpdate({
            _id: id,
            user: userId,
            fundsReleased: { $ne: true },
            status: { $in: [types_1.OrderStatus.SHIPPED, types_1.OrderStatus.IN_TRANSIT, types_1.OrderStatus.DELIVERED] },
            paymentStatus: types_1.PaymentStatus.COMPLETED,
        }, {
            status: types_1.OrderStatus.DELIVERED,
            fundsReleased: true,
            $set: { deliveredAt: new Date() },
        }, { new: true });
        if (!order) {
            const existing = await Order_1.default.findById(id);
            if (!existing)
                throw new error_1.AppError('Order not found', 404);
            if (existing.user.toString() !== userId)
                throw new error_1.AppError('You are not authorized to complete this order', 403);
            if (existing.fundsReleased) {
                res.json({ success: true, message: 'Order already completed', data: { order: existing } });
                return;
            }
            if (existing.paymentStatus !== types_1.PaymentStatus.COMPLETED)
                throw new error_1.AppError('Payment not completed', 400);
            throw new error_1.AppError(`Order cannot be completed from status "${existing.status}". Must be shipped or further.`, 400);
        }
        // Credit vendor wallets with their earnings
        try {
            // Group items by vendor and calculate each vendor's total
            const vendorEarnings = new Map();
            for (const item of order.items) {
                const vendorId = item.vendor.toString();
                const itemTotal = item.price * item.quantity;
                vendorEarnings.set(vendorId, (vendorEarnings.get(vendorId) || 0) + itemTotal);
            }
            // Build per-vendor affiliate deduction map — vendor absorbs affiliate commission, not platform
            const affiliateVendorDeductions = new Map();
            if (order.affiliateUser && order.affiliateCommission && order.affiliateLinkId) {
                try {
                    const linkDoc = await Additional_1.AffiliateLink.findById(order.affiliateLinkId).select('product').lean();
                    if (linkDoc?.product) {
                        // Product-specific link: only the vendor of that product bears the cost
                        const affItem = order.items.find((item) => item.product.toString() === linkDoc.product.toString());
                        if (affItem) {
                            affiliateVendorDeductions.set(affItem.vendor.toString(), order.affiliateCommission);
                        }
                    }
                    else {
                        // General link: distribute proportionally by each vendor's subtotal share
                        const totalSubtotal = [...vendorEarnings.values()].reduce((s, v) => s + v, 0);
                        for (const [vid, sub] of vendorEarnings) {
                            const deduction = Math.round((sub / totalSubtotal) * order.affiliateCommission * 100) / 100;
                            if (deduction > 0)
                                affiliateVendorDeductions.set(vid, deduction);
                        }
                    }
                }
                catch (e) {
                    logger_1.logger.error('Error computing affiliate vendor deductions:', e);
                }
            }
            // Credit each vendor's wallet using tiered commission rate, minus their affiliate share
            for (const [vendorId, amount] of vendorEarnings) {
                const commissionRatePct = await getVendorCommissionRate(vendorId);
                const commissionRate = commissionRatePct / 100;
                const commission = Math.round(amount * commissionRate * 100) / 100;
                const affiliateDeduction = affiliateVendorDeductions.get(vendorId) || 0;
                const vendorAmount = Math.max(0, Math.round((amount - commission - affiliateDeduction) * 100) / 100);
                // Atomic $inc — safe even if this function is called concurrently
                await Additional_1.Wallet.findOneAndUpdate({ user: vendorId }, {
                    $inc: { balance: vendorAmount, totalEarned: vendorAmount },
                    $push: {
                        transactions: {
                            type: types_1.TransactionType.CREDIT,
                            amount: vendorAmount,
                            purpose: types_1.WalletPurpose.COMMISSION,
                            reference: `order_${order.orderNumber}_${vendorId}`,
                            description: `Payment for Order #${order.orderNumber} (${Math.round(commissionRate * 100)}% platform fee${affiliateDeduction > 0 ? `, ₦${affiliateDeduction} affiliate commission` : ''} deducted)`,
                            relatedOrder: order._id,
                            status: 'completed',
                            timestamp: new Date(),
                        },
                    },
                }, { upsert: true });
                logger_1.logger.info(`Credited ₦${vendorAmount} to vendor ${vendorId} for order ${order.orderNumber} (commission: ₦${commission} at ${Math.round(commissionRate * 100)}%, original: ₦${amount})`);
                // Notify vendor their funds have been released
                notification_service_1.notificationService.vendorSaleCompleted(vendorId, order.orderNumber, amount, vendorAmount).catch(() => { });
            }
            // Handle affiliate commission — atomic guard prevents double-credit
            if (order.affiliateUser && order.affiliateCommission) {
                const claimed = await Order_1.default.findOneAndUpdate({ _id: order._id, affiliateCommissionPaid: { $ne: true } }, { $set: { affiliateCommissionPaid: true } });
                if (claimed) {
                    const commissionAmount = order.affiliateCommission;
                    await Additional_1.Wallet.findOneAndUpdate({ user: order.affiliateUser }, {
                        $inc: { balance: commissionAmount, totalEarned: commissionAmount },
                        $push: {
                            transactions: {
                                type: types_1.TransactionType.CREDIT,
                                amount: commissionAmount,
                                purpose: types_1.WalletPurpose.COMMISSION,
                                reference: `affiliate_${order.orderNumber}`,
                                description: `Affiliate commission for Order #${order.orderNumber}`,
                                relatedOrder: order._id,
                                status: 'completed',
                                timestamp: new Date(),
                            },
                        },
                    }, { upsert: true });
                    if (order.affiliateLinkId) {
                        await Additional_1.AffiliateLink.findByIdAndUpdate(order.affiliateLinkId, {
                            $inc: { conversions: 1, totalEarned: commissionAmount },
                        });
                    }
                    logger_1.logger.info(`Credited ₦${commissionAmount} affiliate commission for order ${order.orderNumber}`);
                }
            }
        }
        catch (walletError) {
            logger_1.logger.error(`Error crediting vendor wallets for order ${order.orderNumber}:`, walletError);
        }
        // Award points on delivery
        try {
            const { rewardController } = await Promise.resolve().then(() => __importStar(require('./reward.controller')));
            await rewardController.awardOrderPoints(order._id.toString());
            await rewardController.awardCustomerReferralPoints(order.user.toString(), order._id.toString());
            logger_1.logger.info(`✅ Points awarded on delivery for order ${order.orderNumber}`);
            // Unlock vendor referral points if any vendor is making their first sale
            const uniqueVendorIds = [...new Set(order.items.map((item) => item.vendor.toString()))];
            for (const vendorId of uniqueVendorIds) {
                const vendorProfile = await VendorProfile_1.default.findOne({ user: vendorId });
                if (vendorProfile && !vendorProfile.referralRewarded && vendorProfile.referredBy) {
                    await rewardController.unlockVendorReferralPoints(vendorId);
                    vendorProfile.referralRewarded = true;
                    await vendorProfile.save();
                    logger_1.logger.info(`✅ Vendor referral unlocked for vendor ${vendorId}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error awarding points on delivery:', error);
        }
        // Deactivate conversation for each vendor in this order — only if no other active order exists
        try {
            const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
            const vendorIds = [...new Set(order.items.map((item) => item.vendor.toString()))];
            for (const vendorId of vendorIds) {
                const otherActive = await Order_1.default.findOne({
                    _id: { $ne: order._id },
                    user: userId,
                    'items.vendor': vendorId,
                    status: { $in: ACTIVE_STATUSES },
                }).select('_id').lean();
                if (!otherActive) {
                    await Conversation_1.default.updateMany({ participants: { $all: [userId, vendorId] } }, { isActive: false });
                }
            }
        }
        catch (convErr) {
            logger_1.logger.error('Error deactivating conversations on order complete:', convErr);
        }
        logger_1.logger.info(`Order ${order.orderNumber} completed by customer ${userId}`);
        res.json({
            success: true,
            message: 'Order completed successfully',
            data: { order },
        });
    }
    /**
     * Complete a single vendor's shipment (customer confirms receipt for one vendor)
     * When all vendor shipments are received, the whole order becomes delivered.
     */
    async completeVendorShipment(req, res) {
        const { id, vendorId } = req.params;
        const userId = req.user.id;
        const order = await Order_1.default.findById(id);
        if (!order)
            throw new error_1.AppError('Order not found', 404);
        if (order.user.toString() !== userId)
            throw new error_1.AppError('Not authorized', 403);
        if (order.status === types_1.OrderStatus.CANCELLED)
            throw new error_1.AppError('Order is cancelled', 400);
        if (order.paymentStatus !== types_1.PaymentStatus.COMPLETED)
            throw new error_1.AppError('Payment not completed', 400);
        const shipments = order.vendorShipments;
        if (!shipments || shipments.length === 0)
            throw new error_1.AppError('No vendor shipments found', 400);
        const shipment = shipments.find((s) => {
            const svId = typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString();
            return svId === vendorId;
        });
        if (!shipment)
            throw new error_1.AppError('Vendor shipment not found in this order', 404);
        if (shipment.paidAt)
            throw new error_1.AppError('This shipment has already been received and payment released', 400);
        shipment.status = 'delivered';
        shipment.paidAt = new Date();
        // Credit this vendor's wallet
        const vendorItems = order.items.filter((item) => {
            const iVendorId = typeof item.vendor === 'object' ? item.vendor._id?.toString() : item.vendor?.toString();
            return iVendorId === vendorId;
        });
        const vendorSubtotal = vendorItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        try {
            const vendorProfile = await VendorProfile_1.default.findOne({ user: vendorId }).select('commissionRate');
            const commissionRate = (vendorProfile?.commissionRate ?? 8) / 100;
            const commission = Math.round(vendorSubtotal * commissionRate * 100) / 100;
            // Determine this vendor's affiliate deduction — vendor absorbs it, not platform
            let affiliateDeduction = 0;
            if (order.affiliateUser && order.affiliateCommission && order.affiliateLinkId) {
                try {
                    const linkDoc = await Additional_1.AffiliateLink.findById(order.affiliateLinkId).select('product').lean();
                    if (linkDoc?.product) {
                        // Product-specific: only this vendor pays if they own the affiliated product
                        const affItem = vendorItems.find((item) => item.product.toString() === linkDoc.product.toString());
                        if (affItem)
                            affiliateDeduction = order.affiliateCommission;
                    }
                    else {
                        // General link: this vendor's proportional share of the order subtotal
                        const orderSubtotal = order.items.reduce((s, item) => s + item.price * item.quantity, 0);
                        affiliateDeduction = orderSubtotal > 0
                            ? Math.round((vendorSubtotal / orderSubtotal) * order.affiliateCommission * 100) / 100
                            : 0;
                    }
                }
                catch (e) {
                    logger_1.logger.error('Error computing affiliate deduction for vendor shipment:', e);
                }
            }
            const vendorAmount = Math.max(0, Math.round((vendorSubtotal - commission - affiliateDeduction) * 100) / 100);
            await Additional_1.Wallet.findOneAndUpdate({ user: vendorId }, {
                $inc: { balance: vendorAmount, totalEarned: vendorAmount },
                $push: {
                    transactions: {
                        type: types_1.TransactionType.CREDIT,
                        amount: vendorAmount,
                        purpose: types_1.WalletPurpose.COMMISSION,
                        reference: `order_${order.orderNumber}_vendor_${vendorId}`,
                        description: `Payment for Order #${order.orderNumber} (${Math.round(commissionRate * 100)}% platform fee${affiliateDeduction > 0 ? `, ₦${affiliateDeduction} affiliate commission` : ''} deducted)`,
                        relatedOrder: order._id,
                        status: 'completed',
                        timestamp: new Date(),
                    },
                },
            }, { upsert: true });
            logger_1.logger.info(`Credited ₦${vendorAmount} to vendor ${vendorId} for shipment in order ${order.orderNumber}${affiliateDeduction > 0 ? ` (₦${affiliateDeduction} affiliate deducted)` : ''}`);
            // Notify vendor their funds have been released
            notification_service_1.notificationService.vendorSaleCompleted(vendorId, order.orderNumber, vendorSubtotal, vendorAmount).catch(() => { });
        }
        catch (walletError) {
            logger_1.logger.error('Error crediting vendor wallet on vendor shipment completion:', walletError);
        }
        // Check if all vendor shipments are now delivered
        const allDelivered = shipments.every((s) => s.status === 'delivered' || s.status === 'cancelled');
        if (allDelivered) {
            order.status = types_1.OrderStatus.DELIVERED;
            order.deliveredAt = order.deliveredAt || new Date();
            order.fundsReleased = true;
            // Award points now that all shipments are confirmed received
            try {
                const { rewardController } = await Promise.resolve().then(() => __importStar(require('./reward.controller')));
                await rewardController.awardOrderPoints(order._id.toString());
                await rewardController.awardCustomerReferralPoints(order.user.toString(), order._id.toString());
                logger_1.logger.info(`✅ Points awarded on full shipment receipt for order ${order.orderNumber}`);
                // Unlock vendor referral points for first-sale vendors
                const uniqueVendorIds = [...new Set(order.items.map((item) => item.vendor.toString()))];
                for (const vId of uniqueVendorIds) {
                    const vProfile = await VendorProfile_1.default.findOne({ user: vId });
                    if (vProfile && !vProfile.referralRewarded && vProfile.referredBy) {
                        await rewardController.unlockVendorReferralPoints(vId);
                        vProfile.referralRewarded = true;
                        await vProfile.save();
                    }
                }
            }
            catch (pointsError) {
                logger_1.logger.error('Error awarding points on full shipment receipt:', pointsError);
            }
            // Handle affiliate commission — atomic guard prevents double-credit across completeOrder and completeVendorShipment
            if (order.affiliateUser && order.affiliateCommission) {
                try {
                    const claimed = await Order_1.default.findOneAndUpdate({ _id: order._id, affiliateCommissionPaid: { $ne: true } }, { $set: { affiliateCommissionPaid: true } });
                    if (claimed) {
                        const commissionAmount = order.affiliateCommission;
                        await Additional_1.Wallet.findOneAndUpdate({ user: order.affiliateUser }, {
                            $inc: { balance: commissionAmount, totalEarned: commissionAmount },
                            $push: {
                                transactions: {
                                    type: types_1.TransactionType.CREDIT,
                                    amount: commissionAmount,
                                    purpose: types_1.WalletPurpose.COMMISSION,
                                    reference: `affiliate_${order.orderNumber}`,
                                    description: `Affiliate commission for Order #${order.orderNumber}`,
                                    relatedOrder: order._id,
                                    status: 'completed',
                                    timestamp: new Date(),
                                },
                            },
                        }, { upsert: true });
                        if (order.affiliateLinkId) {
                            await Additional_1.AffiliateLink.findByIdAndUpdate(order.affiliateLinkId, {
                                $inc: { conversions: 1, totalEarned: commissionAmount },
                            });
                        }
                        logger_1.logger.info(`Credited ₦${commissionAmount} affiliate commission for order ${order.orderNumber}`);
                    }
                }
                catch (affiliateErr) {
                    logger_1.logger.error('Error crediting affiliate commission on full delivery:', affiliateErr);
                }
            }
            // Deactivate conversation — only if no other active order exists with each vendor
            try {
                const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
                const uniqueVendorIds = [...new Set(order.items.map((item) => item.vendor.toString()))];
                for (const vId of uniqueVendorIds) {
                    const otherActive = await Order_1.default.findOne({
                        _id: { $ne: order._id },
                        user: userId,
                        'items.vendor': vId,
                        status: { $in: ACTIVE_STATUSES },
                    }).select('_id').lean();
                    if (!otherActive) {
                        await Conversation_1.default.updateMany({ participants: { $all: [userId, vId] } }, { isActive: false });
                    }
                }
            }
            catch (convErr) {
                logger_1.logger.error('Error deactivating conversations on full delivery:', convErr);
            }
        }
        await order.save();
        // Notify the vendor that their shipment was received
        try {
            await notification_service_1.notificationService.orderStatusUpdated(order._id.toString(), order.orderNumber, allDelivered ? 'delivered' : 'shipment_received', vendorId);
        }
        catch (notifErr) {
            logger_1.logger.error('Error sending shipment received notification:', notifErr);
        }
        res.json({
            success: true,
            message: allDelivered
                ? 'All shipments received! Order is now complete.'
                : 'Shipment marked as received.',
            data: { order, allDelivered },
        });
    }
    /**
     * Helper methods
     */
    getDefaultRate(deliveryType) {
        const defaultRates = {
            standard: 2500,
            express: 5000,
            same_day: 8000,
        };
        return defaultRates[deliveryType] || 2500;
    }
    getDefaultEstimate(deliveryType) {
        const defaultEstimates = {
            standard: '5-7 days',
            express: '2-3 days',
            same_day: 'Same day',
        };
        return defaultEstimates[deliveryType] || '5-7 days';
    }
    getDefaultDescription(deliveryType) {
        const descriptions = {
            standard: 'Delivery within 5-7 business days',
            express: 'Delivery within 2-3 business days',
            same_day: 'Delivery within 24 hours',
        };
        return descriptions[deliveryType] || 'Standard delivery';
    }
    getVendorFallbackRates() {
        return [
            {
                type: 'standard',
                name: 'Standard Delivery',
                description: 'Delivery within 5-7 business days',
                price: 2500,
                estimatedDays: '5-7 days',
                courier: 'Standard Courier',
            },
            {
                type: 'express',
                name: 'Express Delivery',
                description: 'Delivery within 2-3 business days',
                price: 5000,
                estimatedDays: '2-3 days',
                courier: 'Express Courier',
            },
        ];
    }
    getFallbackRates() {
        return [
            {
                type: 'standard',
                name: 'Standard Delivery',
                description: 'Delivery within 5-7 business days',
                price: 2500,
                estimatedDays: '5-7 days',
                courier: 'Standard Courier',
            },
            {
                type: 'express',
                name: 'Express Delivery',
                description: 'Delivery within 2-3 business days',
                price: 5000,
                estimatedDays: '2-3 days',
                courier: 'Express Courier',
            },
        ];
    }
}
exports.OrderController = OrderController;
exports.orderController = new OrderController();
//# sourceMappingURL=order.controller.js.map