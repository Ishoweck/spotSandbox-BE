  // controllers/order.controller.ts
  // ✅ FIXED: Added category detection, fixed default weight, pass categoryId to ShipBubble
  import { Response } from 'express';
  import mongoose from 'mongoose';
  import { AuthRequest, ApiResponse, OrderStatus, PaymentStatus, PaymentMethod, TransactionType, WalletPurpose, NotificationType, VendorVerificationStatus, UserRole } from '../types';
  import { VendorGroup, VendorDeliveryRate, DeliveryRateResponse, VendorRateGroup } from '../types/shipping.types';
  import Order, { IVendorShipment } from '../models/Order';
  import Cart from '../models/Cart';
  import Product from '../models/Product';
  import Category from '../models/Category';
  import User from '../models/User';
  import VendorProfile from '../models/VendorProfile';
  import { Wallet, AffiliateLink } from '../models/Additional';
  import { AppError } from '../middleware/error';
  import { generateOrderNumber } from '../utils/helpers';
  import { paystackService } from '../services/paystack.service';
  import { flutterwaveService } from '../services/flutterwave.service';
  import { shipBubbleService } from '../services/shipbubble.service';
  import { sendOrderConfirmationEmail } from '../utils/email';
  import { enqueueEmail, EmailJobType } from '../utils/email-queue';
  import { generateReceiptPDF } from '../services/receipt.service';
  import { notificationService, emitOrderStatusUpdate, emitNewOrder } from '../services/notification.service';
  import { logger } from '../utils/logger';
  import { trackEvent, SlackEvent } from '../utils/slack-events';
  import Conversation from '../models/Conversation';
  import axios from 'axios';

  /** Buyer Protection Fee tiers */
  function calculateServiceCharge(orderTotal: number): number {
    if (orderTotal >= 100001) return 2000;
    if (orderTotal >= 50001)  return 1500;
    if (orderTotal >= 20001)  return 1000;
    if (orderTotal >= 1000)   return 500;
    return 0;
  }

  /** Tiered platform fee based on vendor's current-month sales volume */
  async function getVendorCommissionRate(vendorId: string): Promise<number> {
    const vendorProfile = await VendorProfile.findOne({ user: vendorId }).select('isPremium commissionRate');
    if (!vendorProfile) return 8;
    if (vendorProfile.isPremium) return 5;
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
  async function notifyCartUsersAboutStock(
    productId: mongoose.Types.ObjectId | string,
    productName: string,
    prevQuantity: number,
    soldQuantity: number,
    buyerUserId: string,
    vendorId: string,
    lowStockThreshold: number
  ): Promise<void> {
    const newQuantity = Math.max(0, prevQuantity - soldQuantity);

    // --- Vendor notification (use their configured threshold) ---
    const vendorCrossedOutOfStock = newQuantity === 0 && prevQuantity > 0;
    const vendorCrossedLowStock   = newQuantity > 0 && newQuantity <= lowStockThreshold && prevQuantity > lowStockThreshold;

    if (vendorCrossedOutOfStock || vendorCrossedLowStock) {
      try {
        await notificationService.send({
          userId: vendorId,
          type: NotificationType.SYSTEM,
          title: vendorCrossedOutOfStock ? 'Product Out of Stock' : 'Low Stock Alert',
          message: vendorCrossedOutOfStock
            ? `"${productName}" is now out of stock. Restock it to keep selling.`
            : `"${productName}" is running low — only ${newQuantity} unit${newQuantity === 1 ? '' : 's'} left (threshold: ${lowStockThreshold}).`,
          data: { productId: productId.toString(), productName, stock: newQuantity },
          link: `/vendor/products`,
        });
      } catch (err) {
        logger.warn('Vendor stock notification failed (non-critical):', err);
      }
    }

    // --- Buyer (cart) notifications (hardcoded threshold of 5 as requested) ---
    const buyerCrossedOutOfStock = newQuantity === 0 && prevQuantity > 0;
    const buyerCrossedLowStock   = newQuantity > 0 && newQuantity <= 5 && prevQuantity > 5;

    if (!buyerCrossedOutOfStock && !buyerCrossedLowStock) return;

    try {
      const carts = await Cart.find({
        'items.product': productId,
        user: { $ne: buyerUserId },
      }).select('user');

      const userIds = carts
        .map((c: any) => c.user?.toString())
        .filter((id: string | undefined): id is string => !!id);

      if (userIds.length === 0) return;

      await notificationService.productStockAlert(
        userIds,
        productId.toString(),
        productName,
        newQuantity
      );
    } catch (err) {
      logger.warn('Cart stock alert notification failed (non-critical):', err);
    }
  }

  export class OrderController {
    /**
     * Check if cart contains digital products
     */
    private hasDigitalProducts(items: any[]): boolean {
      return items.some((item: any) => {
        const productType = item.product.productType?.toUpperCase();
        return productType === 'DIGITAL' || productType === 'SERVICE';
      });
    }

    /**
     * Check if cart contains ONLY digital products
     */
    private isDigitalOnly(items: any[]): boolean {
      return items.every((item: any) => {
        const productType = item.product.productType?.toUpperCase();
        return productType === 'DIGITAL' || productType === 'SERVICE';
      });
    }

    /**
     * Validate payment method for cart contents
     */
    private validatePaymentMethod(
      items: any[],
      paymentMethod: PaymentMethod,
      deliveryType: string
    ): void {
      const hasDigital = this.hasDigitalProducts(items);
      const isDigitalOnly = this.isDigitalOnly(items);

      logger.info('📦 Payment validation:', {
        hasDigital,
        isDigitalOnly,
        paymentMethod,
        deliveryType,
      });

      // Digital products require online payment
      if (hasDigital && paymentMethod !== PaymentMethod.PAYSTACK && 
          paymentMethod !== (PaymentMethod as any).FLUTTERWAVE && 
          paymentMethod !== PaymentMethod.WALLET) {
        throw new AppError(
          'Digital products require Card Payment or Wallet. Please select a valid payment method.',
          400
        );
      }

      // Digital-only orders should use pickup/digital delivery
      if (isDigitalOnly && deliveryType !== 'pickup' && deliveryType !== 'digital') {
        logger.warn('Digital-only order with non-digital delivery type, auto-correcting');
      }
    }

    /**
     * ✅ NEW: Determine the best ShipBubble category based on product names
     * Uses keyword matching to pick the right category so ShipBubble
     * returns the most relevant couriers for the product type.
     */
    private determineCategoryForItems(items: any[]): number {
      for (const item of items) {
        const product = item.product || item;
        const categoryObj = product.category;

        // Use the populated category name from the DB (most accurate)
        if (categoryObj && typeof categoryObj === 'object' && categoryObj.name) {
          const categoryId = shipBubbleService.getCategoryIdByName(categoryObj.name);
          if (categoryId !== 77179563) {
            logger.info(`📦 Category from DB: "${categoryObj.name}" (ID: ${categoryId}) for product "${product.name || item.productName}"`);
            return categoryId;
          }
          // If it mapped to the default, log but keep trying other items
          logger.info(`📦 Category "${categoryObj.name}" has no specific ShipBubble mapping — trying next item`);
        }
      }

      // Fallback: keyword match on product name
      const categoryKeywords: { [key: string]: string[] } = {
        'fashion': [
          'shoe', 'sneaker', 'sandal', 'boot', 'heel', 'shirt', 'dress',
          'cloth', 'wear', 'jacket', 'jean', 'trouser', 'skirt', 'bag',
          'handbag', 'purse', 'belt', 'cap', 'hat', 'scarf', 'fashion',
          'apparel', 'outfit', 'hoodie', 'jogger', 'shorts',
        ],
        'electronics': [
          'phone', 'laptop', 'tablet', 'charger', 'cable', 'adapter',
          'earphone', 'headphone', 'earbuds', 'airpod', 'speaker', 'bluetooth',
          'watch', 'smartwatch', 'gadget', 'electronic', 'samsung', 'apple',
          'iphone', 'power bank', 'battery', 'camera', 'console', 'keyboard',
          'mouse', 'monitor', 'tv', 'television', 'projector',
        ],
        'health and beauty': [
          'cream', 'lotion', 'soap', 'perfume', 'cologne', 'fragrance',
          'makeup', 'beauty', 'skincare', 'hair', 'cosmetic', 'serum',
          'sunscreen', 'moisturizer', 'shampoo', 'conditioner', 'lipstick',
          'foundation', 'mascara', 'nail', 'body spray', 'glow',
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

      for (const item of items) {
        const name = (item.productName || item.name || '').toLowerCase();
        for (const [category, keywords] of Object.entries(categoryKeywords)) {
          if (keywords.some(kw => name.includes(kw))) {
            const categoryId = shipBubbleService.getCategoryIdByName(category);
            logger.info(`📦 Category from keyword match: "${category}" (ID: ${categoryId}) for product "${item.productName || item.name}"`);
            return categoryId;
          }
        }
      }

      logger.info('📦 No category match found — using default (Electronics: 77179563)');
      return 77179563;
    }

    /**
     * Get delivery rates
     */
    async getDeliveryRates(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      res.set('Cache-Control', 'no-store');
      const { city, state, street, fullName, phone, receiverAddressCode } = req.query;

      if (!city || !state) {
        throw new AppError('City and state are required', 400);
      }

      try {
        logger.info('📦 Delivery rates request:', {
          city,
          state,
          street: street || 'Not provided',
          userId: req.user?.id,
        });

        // Get user's cart
        const cart = await Cart.findOne({
          user: req.user?.id,
        }).populate({
          path: 'items.product',
          populate: [
            { path: 'vendor', select: 'firstName lastName' },
            { path: 'category', select: 'name slug' },
          ],
        });

        if (!cart || cart.items.length === 0) {
          throw new AppError('Cart is empty', 400);
        }

        // Check if cart is digital-only
        const isDigitalOnly = this.isDigitalOnly(cart.items);
        
        if (isDigitalOnly) {
          logger.info('📦 Digital-only cart - no delivery rates needed');
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

        logger.info(`📦 Processing delivery rates for ${vendorGroups.length} vendor(s)`);

        const rates: DeliveryRateResponse[] = [];

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
        const parsedReceiverCode = receiverAddressCode ? parseInt(receiverAddressCode as string, 10) : undefined;
        const destinationAddress = {
          street: (street as string) || `${city} Area`,
          city: city as string,
          state: state as string,
          fullName: (fullName as string) || 'Customer',
          phone: (phone as string) || '+2348000000000',
          addressCode: parsedReceiverCode,
        };

        // Calculate shipping rates
        let shipBubbleSuccess = false;
        const vendorRates = await Promise.all(
          vendorGroups.map(async (group) => {
            const result = await this.getVendorDeliveryRates(
              group,
              destinationAddress
            );
            if (result.success) {
              shipBubbleSuccess = true;
            }
            return result;
          })
        );

        // Aggregate rates
        const aggregatedRates = this.aggregateVendorRates(vendorRates);
        rates.push(...aggregatedRates);

        // Use fallback if all ShipBubble calls failed
        if (!shipBubbleSuccess && rates.filter(r => r.type !== 'pickup').length === 0) {
          logger.warn('⚠️ All ShipBubble requests failed - Using fallback rates');
          rates.push(...this.getFallbackRates());
        }

        logger.info(`✅ Returning ${rates.length} delivery options (ShipBubble: ${shipBubbleSuccess ? 'SUCCESS' : 'FAILED'})`);

        // Build per-vendor rate groups for multi-vendor checkout UI
        const vendorRateGroups: VendorRateGroup[] = vendorRates.map((vr) => {
          const group = vendorGroups.find(g => g.vendorId === vr.vendorId)!;
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
            pickupCity: group?.pickupAddress?.city || group?.vendorAddress?.city || null,
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
      } catch (error: any) {
        if (error instanceof AppError) {
          throw error;
        }
        logger.error('❌ Critical error in getDeliveryRates:', error);
        throw new AppError('Failed to get delivery rates', 500);
      }
    }

    private async getVendorDeliveryRates(
      vendorGroup: VendorGroup,
      destination: {
        street: string;
        city: string;
        state: string;
        fullName: string;
        phone: string;
        addressCode?: number;
      }
    ): Promise<VendorDeliveryRate> {
      const result: VendorDeliveryRate = {
        vendorId: vendorGroup.vendorId,
        vendorName: vendorGroup.vendorName,
        rates: [],
        success: false,
      };

      // Skip shipping for digital products
      const physicalItems = vendorGroup.items.filter(item => item.isPhysical);
      
      logger.info(`📦 Vendor ${vendorGroup.vendorName} items breakdown:`, {
        totalItems: vendorGroup.items.length,
        physicalItems: physicalItems.length,
        digitalItems: vendorGroup.items.length - physicalItems.length,
      });
      
      if (physicalItems.length === 0) {
        logger.info(`✅ Vendor ${vendorGroup.vendorName} has only digital products`);
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
        logger.info(`📦 Getting shipping rates for ${vendorGroup.vendorName}`);

        const vendorProfile = await VendorProfile.findOne({ user: vendorGroup.vendorId });
        const vendor = await User.findById(vendorGroup.vendorId);

        // Prefer the product-level pickup address; fall back to vendor business address
        const productPickup = vendorGroup.pickupAddress;
        const hasProductPickup = productPickup?.street && productPickup?.city && productPickup?.state;

        const hasValidAddress = hasProductPickup || (
          vendorProfile?.businessAddress &&
          vendorProfile.businessAddress.street &&
          vendorProfile.businessAddress.street.trim().length > 5 &&
          vendorProfile.businessAddress.street !== '123 Main Street' &&
          vendorProfile.businessAddress.city &&
          vendorProfile.businessAddress.state
        );

        if (!hasValidAddress) {
          logger.warn(`⚠️ Vendor ${vendorGroup.vendorName} has invalid address - using fallback`);
          result.rates.push(...this.getVendorFallbackRates());
          return result;
        }

        const pickupSrc = hasProductPickup ? productPickup! : vendorProfile!.businessAddress;
        const senderFullAddress = `${pickupSrc.street}, ${pickupSrc.city}, ${pickupSrc.state}, ${pickupSrc.country || 'Nigeria'}`;
        const receiverFullAddress = `${destination.street}, ${destination.city}, ${destination.state}, Nigeria`;

        const ownerFullName = vendor?.firstName && vendor?.lastName
          ? `${vendor.firstName} ${vendor.lastName}`
          : vendor?.firstName || vendor?.lastName || vendorGroup.vendorName;

        // Use stored Shipbubble address codes to skip redundant validation calls
        const senderStoredCode: number | undefined = hasProductPickup
          ? (productPickup as any).shipBubble?.addressCode
          : (vendorProfile?.businessAddress as any)?.shipBubble?.addressCode;

        const senderAddress = {
          name: (hasProductPickup && productPickup!.fullName) || ownerFullName,
          phone: (hasProductPickup && productPickup!.phone) || vendorProfile?.businessPhone || vendor?.phone || '+2348000000000',
          email: vendorProfile?.businessEmail || vendor?.email || 'sender@vendorspotng.com',
          address: senderFullAddress,
        };

        const receiverAddress = {
          name: destination.fullName,
          phone: destination.phone,
          email: 'customer@vendorspotng.com',
          address: receiverFullAddress,
        };

        logger.info('📦 ShipBubble addresses (COMPLETE):', {
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

        logger.info('📦 Requesting ShipBubble rates:', {
          itemCount: packageItems.length,
          categoryId,
          packageItems,
        });

        const ratesResponse = await shipBubbleService.getDeliveryRates(
          senderAddress,
          receiverAddress,
          packageItems,
          undefined,
          categoryId,
          senderStoredCode,        // skip sender validation if stored
          destination.addressCode, // skip receiver validation if stored
        );

        // If ShipBubble had to re-validate the sender (stale stored code), persist the
        // fresh code so subsequent requests don't hit the same 422 again.
        if (ratesResponse.freshSenderCode) {
          try {
            const freshCode = ratesResponse.freshSenderCode as number;
            if (!hasProductPickup) {
              await VendorProfile.updateOne(
                { user: vendorGroup.vendorId },
                {
                  'businessAddress.shipBubble.addressCode': freshCode,
                  'businessAddress.shipBubble.validatedAt': new Date(),
                }
              );
              logger.info(`✅ Persisted fresh sender address code ${freshCode} for vendor ${vendorGroup.vendorName}`);
            }
          } catch (persistErr: any) {
            logger.warn('⚠️ Could not persist fresh sender address code:', persistErr.message);
          }
        }

        if (ratesResponse.status === 'success' && ratesResponse.data?.couriers) {
          logger.info(`✅ Got ${ratesResponse.data.couriers.length} courier options from ShipBubble`);

          ratesResponse.data.couriers.forEach((courier: any, index: number) => {
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

          (result as any).requestToken = ratesResponse.data.request_token;
          result.success = true;
        } else {
          logger.warn(`⚠️ No courier data from ShipBubble`);
        }

        if (result.rates.length === 0) {
          logger.warn(`⚠️ Using fallback rates`);
          result.rates.push(...this.getVendorFallbackRates());
        }

      } catch (error: any) {
        logger.error(`❌ Error getting rates:`, error.message);
        result.rates.push(...this.getVendorFallbackRates());
      }

      return result;
    }

    private async groupItemsByVendor(items: any[]): Promise<VendorGroup[]> {
      const groups = new Map<string, VendorGroup>();
      // Cache vendor profiles so we don't re-query for the same vendor across different pickup groups
      const vendorProfileCache = new Map<string, any>();

      for (const item of items) {
        const product = item.product;
        const vendorId = product.vendor._id.toString();

        // Build the group key: vendor + pickup address so products with different
        // pickup locations become separate shipment groups
        const pa = product.pickupAddress;
        const hasPickup = pa?.street && pa?.city && pa?.state;
        const pickupKey = hasPickup
          ? `${pa.street}|${pa.city}|${pa.state}`.toLowerCase().replace(/\s+/g, '')
          : 'default';
        const groupKey = `${vendorId}::${pickupKey}`;

        if (!groups.has(groupKey)) {
          let vendorProfile = vendorProfileCache.get(vendorId);
          if (!vendorProfile) {
            vendorProfile = await VendorProfile.findOne({ user: vendorId });
            vendorProfileCache.set(vendorId, vendorProfile);
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
                            `${product.vendor.firstName} ${product.vendor.lastName}`;

          groups.set(groupKey, {
            vendorId,
            vendorName,
            vendorLogo: vendorProfile?.businessLogo,
            isVerified: vendorProfile?.verificationStatus === 'verified',
            vendorAddress,
            pickupAddress: hasPickup ? pa : undefined,
            items: [],
            totalWeight: 0,
          });
        }

        const group = groups.get(groupKey)!;

        const productType = product.productType?.toUpperCase();
        const isPhysical =
          productType === 'PHYSICAL' ||
          (!productType || (productType !== 'DIGITAL' && productType !== 'SERVICE'));

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

    private checkPickupAvailability(vendorGroups: VendorGroup[]): boolean {
      return true;
    }

    private aggregateVendorRates(vendorRates: VendorDeliveryRate[]): DeliveryRateResponse[] {
      const aggregated = new Map<string, DeliveryRateResponse>();

      vendorRates.forEach(vendorRate => {
        const ratesByType = new Map<string, any>();
        
        vendorRate.rates.forEach(rate => {
          if (rate.type === 'digital') return;
          
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

          const agg = aggregated.get(type)!;
          
          agg.price += rate.price;
          
          agg.vendorBreakdown!.push({
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

    private compareEstimatedDays(days1: string, days2: string): number {
      const extract = (str: string): number => {
        const match = str.match(/(\d+)/);
        return match ? parseInt(match[1]) : 0;
      };

      return extract(days1) - extract(days2);
    }

    /**
     * Create order from cart - WALLET PAYMENTS ONLY
     * For Paystack/Flutterwave, use initializePayment → confirmPayment flow instead
     */
    async createOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const {
      shippingAddress,
      paymentMethod,
      notes,
      deliveryType = 'standard',
      selectedDeliveryPrice,
      selectedCourier,
      vendorBreakdown,
      vendorDeliveries,
      affiliateCode,
    } = req.body;

      logger.info('🛒 ============================================');
      logger.info('🛒 CREATE ORDER STARTED');
      logger.info('🛒 ============================================');

      // ✅ GUARD: Only wallet payments go through createOrder
      // Card payments must use initializePayment → confirmPayment flow
      if (paymentMethod === PaymentMethod.PAYSTACK || paymentMethod === (PaymentMethod as any).FLUTTERWAVE) {
        throw new AppError(
          'Card payments must use the /orders/initialize-payment endpoint. This endpoint is for wallet payments only.',
          400
        );
      }

      logger.info('📋 Order request:', {
        userId: req.user?.id,
        paymentMethod,
        deliveryType,
        hasShippingAddress: !!shippingAddress,
      });

      const cart = await Cart.findOne({ user: req.user?.id }).populate({
        path: 'items.product',
        populate: {
          path: 'vendor',
          select: 'firstName lastName email phone',
        },
      });
      
      if (!cart || cart.items.length === 0) {
        throw new AppError('Cart is empty', 400);
      }

      // ✅ VALIDATE PAYMENT METHOD FOR CART CONTENTS
      this.validatePaymentMethod(cart.items, paymentMethod, deliveryType);

      // Validate products
      for (const item of cart.items) {
        const product: any = item.product;
        
        if (!product || product.status !== 'active') {
          throw new AppError(`Product ${product?.name || 'Unknown'} is not available`, 400);
        }

        // Check stock for physical products only
        const productType = product.productType?.toUpperCase();
        const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';

        if (isPhysical && product.quantity < item.quantity) {
          throw new AppError(
            `Insufficient stock for ${product.name}. Only ${product.quantity} available`,
            400
          );
        }
      }

      // Verify all vendors in the cart are active and approved
      const uniqueVendorIds = [...new Set(cart.items.map((item: any) => item.product.vendor._id.toString()))];
      const activeVendors = await VendorProfile.find({
        user: { $in: uniqueVendorIds },
        isActive: true,
        verificationStatus: VendorVerificationStatus.VERIFIED,
      }).select('user').lean();

      if (activeVendors.length < uniqueVendorIds.length) {
        const activeIds = new Set(activeVendors.map((v: any) => v.user.toString()));
        const blockedItem = cart.items.find((item: any) => !activeIds.has(item.product.vendor._id.toString())) as any;
        throw new AppError(
          `"${blockedItem?.product?.name}" is from a store that is not currently accepting orders. Please remove it from your cart.`,
          400
        );
      }

      const user = await User.findById(req.user?.id);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const vendorGroups = await this.groupItemsByVendor(cart.items);
      const isDigitalOnly = this.isDigitalOnly(cart.items);

      logger.info(`📦 Creating order with ${vendorGroups.length} vendor(s)`, {
        isDigitalOnly,
        paymentMethod,
        deliveryType,
      });

      const orderItems = cart.items.map((item: any) => ({
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
      logger.info('📦 Calculating shipping costs...');

      // ✅ NEW: Per-vendor delivery selections from new checkout UI
      if (vendorDeliveries && vendorDeliveries.length > 0) {
        logger.info('📦 Using per-vendor delivery selections');
        for (const group of vendorGroups) {
          const physicalItems = group.items.filter(item => item.isPhysical);
          if (physicalItems.length === 0) continue;
          const vd = vendorDeliveries.find((v: any) => v.vendorId === group.vendorId);
          // Use ?? not || so a price of 0 (digital bundled) is respected
          const shippingCost = vd != null ? (vd.price ?? 0) : this.getDefaultRate(deliveryType);
          totalShippingCost += shippingCost;
          vendorShipments.push({
            vendor: group.vendorId,
            vendorName: group.vendorName,
            items: group.items.filter(item => item.isPhysical).map(item => item.productId),
            origin: (() => { const o = (group as any).pickupAddress?.street ? (group as any).pickupAddress : group.vendorAddress; return { street: o.street || '', city: o.city, state: o.state, country: o.country }; })(),
            shippingCost,
            courier: vd?.courier || selectedCourier,
            requestedCourier: vd?.courier || selectedCourier,
            status: 'pending',
          });
          logger.info(`✅ Shipping for ${group.vendorName}: ₦${shippingCost} (${vd?.courier})`);
        }
      }
      // ✅ USE SELECTED PRICE FROM CHECKOUT (legacy)
      else if (selectedDeliveryPrice !== undefined && selectedDeliveryPrice !== null) {
        logger.info('✅ Using selected delivery price from checkout:', selectedDeliveryPrice);

        // ✅ FOR MULTI-VENDOR ORDERS WITH BREAKDOWN
        if (vendorBreakdown && vendorBreakdown.length > 0) {
          logger.info('📦 Multi-vendor order - using vendor breakdown');

          for (const group of vendorGroups) {
            const physicalItems = group.items.filter(item => item.isPhysical);
            if (physicalItems.length === 0) {
              logger.info(`⏭️ Skipping ${group.vendorName} - no physical items`);
              continue;
            }

            const vendorShipping = vendorBreakdown.find(
              (v: any) => v.vendorId === group.vendorId
            );

            const shippingCost = vendorShipping?.price || this.getDefaultRate(deliveryType);
            totalShippingCost += shippingCost;

            vendorShipments.push({
              vendor: group.vendorId,
              vendorName: group.vendorName,
              items: group.items.map(item => item.productId),
              origin: (() => { const o = (group as any).pickupAddress?.street ? (group as any).pickupAddress : group.vendorAddress; return { street: o.street || '', city: o.city, state: o.state, country: o.country }; })(),
              shippingCost: shippingCost,
              courier: vendorShipping?.courier || selectedCourier,
              requestedCourier: vendorShipping?.courier || selectedCourier,
              status: 'pending',
            });

            logger.info(`✅ Shipping for ${group.vendorName}: ₦${shippingCost} (${vendorShipping?.courier || selectedCourier})`);
          }
        }
        // ✅ FOR SINGLE-VENDOR ORDERS
        else {
          logger.info('📦 Single vendor order - using total price');

          totalShippingCost = selectedDeliveryPrice;

          for (const group of vendorGroups) {
            const physicalItems = group.items.filter(item => item.isPhysical);
            if (physicalItems.length === 0) {
              logger.info(`⏭️ Skipping ${group.vendorName} - no physical items`);
              continue;
            }

            vendorShipments.push({
              vendor: group.vendorId,
              vendorName: group.vendorName,
              items: group.items.map(item => item.productId),
              origin: (() => { const o = (group as any).pickupAddress?.street ? (group as any).pickupAddress : group.vendorAddress; return { street: o.street || '', city: o.city, state: o.state, country: o.country }; })(),
              shippingCost: selectedDeliveryPrice,
              courier: selectedCourier,
              requestedCourier: selectedCourier,
              status: 'pending',
            });

            logger.info(`✅ Shipping for ${group.vendorName}: ₦${selectedDeliveryPrice} (${selectedCourier})`);
          }
        }
      } 
      // ✅ FALLBACK ONLY IF NO PRICE PROVIDED
      else {
        logger.warn('⚠️ No delivery price provided - using fallback rates');
        
        for (const group of vendorGroups) {
          const physicalItems = group.items.filter(item => item.isPhysical);
          if (physicalItems.length === 0) {
            logger.info(`⏭️ Skipping ${group.vendorName} - no physical items`);
            continue;
          }

          const fallbackCost = this.getDefaultRate(deliveryType);
          totalShippingCost += fallbackCost;

          vendorShipments.push({
            vendor: group.vendorId,
            vendorName: group.vendorName,
            items: group.items.map(item => item.productId),
            origin: (() => { const o = (group as any).pickupAddress?.street ? (group as any).pickupAddress : group.vendorAddress; return { street: o.street || '', city: o.city, state: o.state, country: o.country }; })(),
            shippingCost: fallbackCost,
            courier: selectedCourier || 'Standard Courier',
            requestedCourier: selectedCourier || 'Standard Courier',
            status: 'pending',
          });

          logger.info(`⚠️ Using fallback for ${group.vendorName}: ₦${fallbackCost}`);
        }
      }
      
      logger.info(`💰 Total shipping cost: ₦${totalShippingCost}`);
    }
      // Recalculate subtotal from current product prices — never trust the stale
      // cart.subtotal since vendors may have changed prices since the cart was built.
      let subtotal = 0;
      for (const cartItem of cart.items) {
        const liveProduct = await Product.findById(cartItem.product).select('price');
        subtotal += (liveProduct?.price || (cartItem as any).price || 0) * cartItem.quantity;
      }
      if (subtotal === 0) subtotal = cart.subtotal; // fallback if product lookup fails
      const discount = Math.min(cart.discount, subtotal); // cap stale coupon discount to actual subtotal
      const tax = 0;
      const baseTotal = Math.max(0, subtotal - discount + totalShippingCost + tax);
      const serviceCharge = isDigitalOnly ? 0 : calculateServiceCharge(baseTotal);
      const total = Math.round(baseTotal + serviceCharge);

      // ── WALLET PRE-CHECK ──────────────────────────────────────────────────────
      // Validate balance BEFORE creating the order so we never leave an orphaned
      // PENDING order in the database when the user can't actually pay.
      if (paymentMethod === PaymentMethod.WALLET) {
        const walletCheck = await Wallet.findOne({ user: req.user?.id }).select('balance');
        const currentBalance = walletCheck?.balance ?? 0;
        if (currentBalance < total) {
          try {
            await notificationService.insufficientWalletBalance(req.user!.id, total, currentBalance);
          } catch (notifErr) {
            logger.error('Error sending insufficient balance notification:', notifErr);
          }
          throw new AppError(
            `Insufficient wallet balance. You need ₦${total.toLocaleString()} but your wallet only has ₦${currentBalance.toLocaleString()}. Please top up and try again.`,
            400
          );
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      const orderNumber = generateOrderNumber();

      logger.info('💾 Creating order document...', { orderNumber });

      // Resolve affiliate if a code was passed at checkout
      let walletAffiliateUserId: any = undefined;
      let walletAffiliateCommission = 0;
      let walletAffiliateLinkId: any = undefined;
      const normalizedWalletAffiliateCode = affiliateCode ? (affiliateCode as string).toUpperCase() : undefined;
      if (normalizedWalletAffiliateCode) {
        try {
          const linkRecord = await AffiliateLink.findOne({ code: normalizedWalletAffiliateCode, isActive: true });
          if (linkRecord && linkRecord.user.toString() !== req.user?.id) {
            let commissionSum = 0;
            if (linkRecord.product) {
              // Product-specific link: commission only on the affiliated product
              const affiliatedItem = orderItems.find(
                (item: any) => item.product.toString() === linkRecord.product!.toString()
              );
              if (affiliatedItem) {
                const prod: any = await Product.findById(linkRecord.product).select('affiliateCommission').lean();
                const rate = prod?.affiliateCommission || 3;
                commissionSum = (affiliatedItem.price || 0) * (affiliatedItem.quantity || 1) * (rate / 100);
              }
            } else {
              // General affiliate link: commission on full subtotal using per-product rates
              for (const item of orderItems) {
                const prod: any = await Product.findById(item.product).select('affiliateCommission').lean();
                const rate = prod?.affiliateCommission || 0;
                if (rate > 0) commissionSum += (item.price || 0) * (item.quantity || 1) * (rate / 100);
              }
              if (commissionSum === 0) commissionSum = subtotal * 0.03;
            }
            walletAffiliateUserId = linkRecord.user;
            walletAffiliateLinkId = linkRecord._id;
            walletAffiliateCommission = Math.round(commissionSum * 100) / 100;
            logger.info(`🤝 Affiliate code ${normalizedWalletAffiliateCode} resolved — commission: ₦${walletAffiliateCommission}`);
          }
        } catch (affiliateErr) {
          logger.error('Error resolving affiliate:', affiliateErr);
        }
      }

      // Detect first order for customer and vendors (count BEFORE creating)
      const priorCustomerOrders = await Order.countDocuments({ user: req.user?.id });
      const isFirstOrder = priorCustomerOrders === 0;
      const firstOrderVendorIds: string[] = [];
      for (const group of vendorGroups) {
        const priorVendorOrders = await Order.countDocuments({ 'items.vendor': new mongoose.Types.ObjectId(group.vendorId) });
        if (priorVendorOrders === 0) firstOrderVendorIds.push(group.vendorId);
      }

      const order = await Order.create({
        orderNumber,
        user: req.user?.id,
        items: orderItems,
        subtotal,
        discount,
        shippingCost: totalShippingCost,
        tax,
        serviceCharge,
        total,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
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

      logger.info(`✅ Order created: ${order._id}`);

      // Re-activate any closed conversations between the customer and each vendor in this order
      try {
        const vendorIds = [...new Set(orderItems.map((i: any) => i.vendor.toString()))];
        const customerId = req.user!.id;
        for (const vendorId of vendorIds) {
          await Conversation.updateMany(
            { participants: { $all: [customerId, vendorId] }, isActive: false },
            { isActive: true }
          );
        }
      } catch (convActivateErr) {
        logger.error('Error re-activating conversations on order create:', convActivateErr);
      }

      let paymentData = null;

      // ✅ WALLET PAYMENT ONLY (Paystack/Flutterwave blocked above)
      if (paymentMethod === PaymentMethod.WALLET) {
        logger.info('💰 Processing wallet payment...');
        
        // Atomic: deduct only if sufficient balance — prevents double-spend on concurrent wallet payments
        const wallet = await Wallet.findOneAndUpdate(
          { user: req.user?.id, balance: { $gte: total } },
          {
            $inc: { balance: -total, totalSpent: total },
            $push: {
              transactions: {
                type: TransactionType.DEBIT,
                amount: total,
                purpose: WalletPurpose.PURCHASE,
                reference: orderNumber,
                description: `Payment for order ${orderNumber}`,
                relatedOrder: order._id,
                status: 'completed',
                timestamp: new Date(),
              },
            },
          },
          { new: true }
        );

        if (!wallet) {
          // Race condition: balance dropped between the pre-check and here — delete the orphaned order
          await Order.findByIdAndDelete(order._id);
          logger.warn(`⚠️ Wallet race condition: deleted orphaned order ${order.orderNumber}`);
          throw new AppError('Insufficient wallet balance. Please top up and try again.', 400);
        }

        order.paymentStatus = PaymentStatus.COMPLETED;
        order.status = isDigitalOnly ? OrderStatus.DELIVERED : OrderStatus.PENDING;
        await order.save();

        logger.info('✅ Wallet payment completed');

        // ✅ For digital products, instant delivery
        if (isDigitalOnly) {
          logger.info(`✅ Digital order completed instantly: ${orderNumber}`);
        }

        // Points awarded on delivery (not payment) — see completeOrder

        // Affiliate commission credited on delivery — see completeOrder

        logger.info('📦 Shipment will be created when vendor confirms/processes order');
      } else {
        throw new AppError('Invalid payment method. Use /orders/initialize-payment for card payments.', 400);
      }

      // Clear cart
      cart.items = [];
      cart.couponCode = undefined;
      cart.discount = 0;
      await cart.save();

      logger.info('🛒 Cart cleared');

      // Update coupon usage
      if (order.couponCode) {
        const { Coupon } = await import('../models/Additional');
        await Coupon.findOneAndUpdate(
          { code: order.couponCode },
          {
            $inc: { usageCount: 1 },
            $push: { usedBy: user._id },
          }
        );
        logger.info(`🎟️ Coupon usage updated: ${order.couponCode}`);
      }

      // ✅ Update product sales
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { 
            totalSales: item.quantity,
          },
        });
      }

      // Reduce stock for physical products (wallet payment is already confirmed)
      for (const item of order.items) {
        const product: any = await Product.findById(item.product);
        if (!product) continue;
        const productType = product.productType?.toUpperCase();
        const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
        if (isPhysical) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { quantity: -item.quantity },
          });
          await notifyCartUsersAboutStock(
            item.product,
            product.name,
            product.quantity,
            item.quantity,
            req.user!.id,
            product.vendor?.toString() || '',
            product.lowStockThreshold ?? 10
          );
        }
      }

      logger.info('📊 Product sales & stock updated');

      // Send confirmation email + receipt PDF
      try {
        const vendorNameMap = new Map<string, string>(
          (order.vendorShipments || []).map((s: any) => [s.vendor.toString(), s.vendorName])
        );
        const emailItems = order.items.map((item: any) => ({
          productName: item.productName,
          productImage: item.productImage,
          quantity: item.quantity,
          price: item.price,
          vendorName: vendorNameMap.get(item.vendor.toString()),
        }));
        let receiptPdf: Buffer | undefined;
        try {
          receiptPdf = await generateReceiptPDF({
            orderNumber: order.orderNumber,
            date: order.createdAt,
            paymentMethod: order.paymentMethod,
            paymentReference: order.paymentReference,
            customer: { name: `${user.firstName} ${(user as any).lastName || ''}`.trim(), email: user.email },
            deliveryAddress: order.shippingAddress as any,
            items: order.items.map((item: any) => ({
              productName: item.productName,
              vendorName: vendorNameMap.get(item.vendor.toString()),
              quantity: item.quantity,
              price: item.price,
            })),
            subtotal: order.subtotal || 0,
            discount: order.discount || 0,
            shippingCost: order.shippingCost || 0,
            serviceCharge: order.serviceCharge || 0,
            total: order.total,
          });
        } catch (pdfErr: any) {
          logger.error('Receipt PDF generation failed:', pdfErr.message);
        }
        await sendOrderConfirmationEmail(user.email, order.orderNumber, order.total, user.firstName, emailItems, receiptPdf);
      } catch (error) {
        logger.error('Error sending confirmation email:', error);
      }

      // Send notifications to customer and vendors
      try {
        const vendorIds = [...new Set(order.items.map((item: any) => item.vendor.toString()))];
        await notificationService.orderPlaced(
          order._id.toString(),
          order.orderNumber,
          order.total,
          req.user!.id,
          vendorIds
        );
        await notificationService.paymentCompleted(
          order._id.toString(),
          order.orderNumber,
          order.total,
          req.user!.id
        );
        emitNewOrder({ orderId: order._id.toString(), orderNumber: order.orderNumber, vendorIds });
      } catch (error) {
        logger.error('Error sending order notifications:', error);
      }

      logger.info('🛒 ============================================');
      logger.info('🛒 CREATE ORDER COMPLETED (WALLET)');
      logger.info('🛒 ============================================');

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
    async initializePayment(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const {
        shippingAddress,
        paymentMethod,
        notes,
        deliveryType = 'standard',
        selectedDeliveryPrice,
        selectedCourier,
        vendorBreakdown,
        vendorDeliveries,
        vCreditsAmount = 0,
        affiliateCode,
      } = req.body;

      logger.info('💳 ============================================');
      logger.info('💳 INITIALIZE PAYMENT (NO ORDER YET)');
      logger.info('💳 ============================================');

      // Wallet payments should go through createOrder directly
      if (paymentMethod === PaymentMethod.WALLET && !vCreditsAmount) {
        throw new AppError('Wallet payments should use /orders/create endpoint directly', 400);
      }

      const cart = await Cart.findOne({ user: req.user?.id }).populate({
        path: 'items.product',
        populate: {
          path: 'vendor',
          select: 'firstName lastName email phone',
        },
      });

      if (!cart || cart.items.length === 0) {
        throw new AppError('Cart is empty', 400);
      }

      // Validate payment method for cart contents
      this.validatePaymentMethod(cart.items, paymentMethod, deliveryType);

      // Validate products & stock
      for (const item of cart.items) {
        const product: any = item.product;
        if (!product || product.status !== 'active') {
          throw new AppError(`Product ${product?.name || 'Unknown'} is not available`, 400);
        }
        const productType = product.productType?.toUpperCase();
        const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
        if (isPhysical && product.quantity < item.quantity) {
          throw new AppError(
            `Insufficient stock for ${product.name}. Only ${product.quantity} available`,
            400
          );
        }
      }

      const user = await User.findById(req.user?.id);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const isDigitalOnly = this.isDigitalOnly(cart.items);

      // Calculate total (same logic as createOrder)
      let totalShippingCost = 0;
      if (!isDigitalOnly && deliveryType !== 'pickup') {
        if (vendorDeliveries && vendorDeliveries.length > 0) {
          totalShippingCost = vendorDeliveries.reduce((sum: number, v: any) => sum + (v.price || 0), 0);
        } else if (selectedDeliveryPrice !== undefined && selectedDeliveryPrice !== null) {
          if (vendorBreakdown && vendorBreakdown.length > 0) {
            totalShippingCost = vendorBreakdown.reduce((sum: number, v: any) => sum + (v.price || 0), 0);
          } else {
            totalShippingCost = selectedDeliveryPrice;
          }
        } else {
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

      // Use the cart's stored subtotal — this is what the user saw at checkout.
      // Re-fetching live prices causes the total to jump if a vendor changed their price
      // between cart addition and payment, which is confusing and wrong from the user's perspective.
      const subtotal = cart.subtotal > 0
        ? cart.subtotal
        : cart.items.reduce((sum: number, item: any) => sum + (item.price || 0) * item.quantity, 0);
      const discount = Math.min(cart.discount, subtotal); // cap stale coupon discount to actual subtotal
      const tax = 0;
      const baseTotal = Math.max(0, subtotal - discount + totalShippingCost + tax);
      const serviceCharge = isDigitalOnly ? 0 : calculateServiceCharge(baseTotal);
      const total = Math.round(baseTotal + serviceCharge);

      // Validate VCredits balance now but do NOT deduct yet — deduction happens in
      // confirmPayment only after the card charge succeeds to prevent lost credits
      // if the user closes the app before completing payment.
      let validVCredits = 0;
      if (vCreditsAmount > 0) {
        const wallet = await Wallet.findOne({ user: req.user?.id });
        if (!wallet || (wallet.vCredits || 0) < vCreditsAmount) {
          throw new AppError('Insufficient VCredits balance', 400);
        }
        validVCredits = Math.min(vCreditsAmount, total);
        logger.info(`💎 VCredits reserved (not yet deducted): ${validVCredits}`);
      }

      const cardChargeAmount = total - validVCredits;

      // Generate a reference for this payment attempt
      const paymentReference = generateOrderNumber();

      logger.info('💰 Payment calculation:', { subtotal, discount, totalShippingCost, total, vCreditsApplied: validVCredits, cardChargeAmount, paymentReference });

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
        provider: paymentMethod === PaymentMethod.PAYSTACK ? 'paystack' : 'flutterwave',
        createdAt: new Date().toISOString(),
      };

      let paymentData: any = null;

      // Track this payment attempt — used by the webhook and recovery endpoint
      const { PendingPayment } = await import('../models/PendingPayment');
      await PendingPayment.findOneAndUpdate(
        { reference: paymentReference },
        {
          reference: paymentReference,
          userId: user._id.toString(),
          type: 'order',
          amount: cardChargeAmount,
          gateway: paymentMethod === PaymentMethod.PAYSTACK ? 'paystack' : 'flutterwave',
          status: 'pending',
          snapshotJson: JSON.stringify(checkoutSnapshot),
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        },
        { upsert: true, new: true }
      );

      if (paymentMethod === PaymentMethod.PAYSTACK) {
        logger.info('💳 Initializing Paystack...');
        try {
          const paystackResponse = await paystackService.initializePayment({
            email: user.email,
            amount: Math.round(cardChargeAmount * 100),
            reference: paymentReference,
            callback_url: `${process.env.FRONTEND_URL}/orders/${paymentReference}/payment-callback`,
            metadata: {
              checkoutSnapshot: JSON.stringify(checkoutSnapshot),
              userId: user._id.toString(),
              isDigital: isDigitalOnly,
              purpose: 'order',
            },
          });

          paymentData = {
            authorization_url: paystackResponse.data.authorization_url,
            access_code: paystackResponse.data.access_code,
            reference: paymentReference,
            provider: 'paystack',
          };
          logger.info('✅ Paystack initialized — no order created yet');
        } catch (error) {
          logger.error('❌ Paystack initialization failed:', error);
          throw new AppError('Failed to initialize payment', 500);
        }
      } else if (paymentMethod === (PaymentMethod as any).FLUTTERWAVE) {
        logger.info('💳 Initializing Flutterwave...');
        try {
          // Gross up the amount so that after Flutterwave deducts their 1.4% fee
          // (capped at ₦2,000) the merchant receives exactly cardChargeAmount.
          // Formula: gross = ceil((amount) / (1 - 0.014)), fee capped at ₦2,000.
          const flutterwaveFee = cardChargeAmount > 0
            ? Math.min(Math.ceil(cardChargeAmount / 0.986) - cardChargeAmount, 2000)
            : 0;
          const flutterwaveGrossAmount = cardChargeAmount + flutterwaveFee;

          const flutterwaveResponse = await flutterwaveService.initializePayment({
            tx_ref: paymentReference,
            amount: flutterwaveGrossAmount,
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
          logger.info('✅ Flutterwave initialized — no order created yet');
        } catch (error) {
          logger.error('❌ Flutterwave initialization failed:', error);
          throw new AppError('Failed to initialize payment', 500);
        }
      } else {
        throw new AppError('Invalid payment method. Use paystack or flutterwave.', 400);
      }

      logger.info('💳 ============================================');
      logger.info('💳 PAYMENT INITIALIZED — AWAITING USER PAYMENT');
      logger.info('💳 ============================================');

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
    async confirmPayment(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { reference } = req.params;
      const { provider, transaction_id, checkoutSnapshot: snapshotFromClient } = req.body;

      logger.info('✅ ============================================');
      logger.info('✅ CONFIRM PAYMENT & CREATE ORDER');
      logger.info('✅ ============================================');

      // Step 0: Look up the server-stored PendingPayment to get the correct gateway.
      // This is the authoritative source — the client-supplied `provider` can be wrong
      // (e.g. app sends "paystack" even when Flutterwave was used).
      const { PendingPayment } = await import('../models/PendingPayment');
      const pendingRecord = await PendingPayment.findOne({ reference });
      const paymentProvider: string =
        pendingRecord?.gateway || snapshotFromClient?.provider || provider || 'paystack';

      logger.info('🔍 Reference:', { reference });
      logger.info('🔍 Provider (resolved):', { paymentProvider, clientProvider: provider, pendingGateway: pendingRecord?.gateway });

      // Step 1: Verify payment with the gateway
      let paymentSuccess = false;
      let snapshotFromGateway: any = null;
      let paidAmountNaira: number | null = null;

      try {
        if (paymentProvider === 'flutterwave') {
          logger.info('🔍 Verifying with Flutterwave...');
          let verification;
          if (transaction_id) {
            verification = await flutterwaveService.verifyPayment(transaction_id as string);
          } else {
            verification = await flutterwaveService.verifyPaymentByRef(reference);
          }
          if (verification.data?.status === 'successful') {
            paymentSuccess = true;
            paidAmountNaira = verification.data.amount;
            logger.info('✅ Flutterwave payment verified:', { amount: verification.data.amount });
            // Extract snapshot stored in Flutterwave meta during initializePayment
            const meta = verification.data.meta;
            if (meta?.checkoutSnapshot) {
              try {
                snapshotFromGateway = typeof meta.checkoutSnapshot === 'string'
                  ? JSON.parse(meta.checkoutSnapshot)
                  : meta.checkoutSnapshot;
              } catch {
                logger.warn('⚠️ Could not parse checkoutSnapshot from Flutterwave meta');
              }
            }
          }
        } else {
          logger.info('🔍 Verifying with Paystack...');
          const verification = await paystackService.verifyPayment(reference);
          if (verification.data.status === 'success') {
            paymentSuccess = true;
            paidAmountNaira = verification.data.amount / 100; // kobo → naira
            logger.info('✅ Paystack payment verified:', { amount: paidAmountNaira });
            // Extract snapshot stored in Paystack metadata during initializePayment
            const meta = verification.data.metadata;
            if (meta?.checkoutSnapshot) {
              try {
                snapshotFromGateway = typeof meta.checkoutSnapshot === 'string'
                  ? JSON.parse(meta.checkoutSnapshot)
                  : meta.checkoutSnapshot;
              } catch {
                logger.warn('⚠️ Could not parse checkoutSnapshot from Paystack metadata');
              }
            }
          }
        }
      } catch (error: any) {
        logger.error('❌ Payment verification failed:', error.message);
        throw new AppError('Payment verification failed', 400);
      }

      if (!paymentSuccess) {
        throw new AppError('Payment was not successful', 400);
      }

      // Step 2: Parse the checkout snapshot
      // Priority: client body → gateway metadata → PendingPayment.snapshotJson (server-stored, most reliable)
      let snapshotFromPending: any = null;
      if (pendingRecord?.snapshotJson) {
        try {
          snapshotFromPending = typeof pendingRecord.snapshotJson === 'string'
            ? JSON.parse(pendingRecord.snapshotJson)
            : pendingRecord.snapshotJson;
        } catch {
          logger.warn('⚠️ Could not parse snapshotJson from PendingPayment');
        }
      }

      const snapshot = snapshotFromClient || snapshotFromGateway || snapshotFromPending;
      if (!snapshot || snapshot.userId !== req.user?.id) {
        throw new AppError('Invalid checkout data', 400);
      }

      // Validate paid amount against what was expected
      if (paidAmountNaira !== null && snapshot.cardChargeAmount !== undefined) {
        if (paidAmountNaira < snapshot.cardChargeAmount - 1) { // 1 naira tolerance for rounding
          logger.error('❌ confirmPayment amount mismatch:', {
            expected: snapshot.cardChargeAmount,
            received: paidAmountNaira,
          });
          throw new AppError('Payment amount does not match order total', 400);
        }
      }

      // Step 3: Re-validate cart (stock may have changed while user was paying)
      const cart = await Cart.findOne({ user: req.user?.id }).populate({
        path: 'items.product',
        populate: {
          path: 'vendor',
          select: 'firstName lastName email phone',
        },
      });

      if (!cart || cart.items.length === 0) {
        // Payment succeeded but cart is empty — this is a problem
        // We should still create the order using the snapshot to avoid losing the payment
        logger.warn('⚠️ Cart is empty but payment succeeded — using snapshot to create order');
      }

      const cartToUse = cart && cart.items.length > 0 ? cart : null;

      // Re-validate stock for physical products
      if (cartToUse) {
        for (const item of cartToUse.items) {
          const product: any = item.product;
          if (!product || product.status !== 'active') {
            // Payment succeeded but product unavailable — still create order, vendor will handle
            logger.warn(`⚠️ Product ${product?.name || 'Unknown'} may be unavailable`);
          }
        }
      }

      const user = await User.findById(req.user?.id);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Step 4: Build order items from cart (or snapshot data)
      let orderItems: any[];
      let vendorGroups: VendorGroup[];
      let isDigitalOnly: boolean;

      if (cartToUse) {
        orderItems = cartToUse.items.map((item: any) => ({
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
      } else {
        // Fallback: we lost the cart somehow, but payment went through
        // Create a minimal order from snapshot so the payment isn't lost
        logger.error('❌ Cart lost after payment — creating minimal order from snapshot');
        orderItems = [];
        vendorGroups = [];
        isDigitalOnly = snapshot.isDigitalOnly || false;
      }

      // Step 5: Calculate shipping (use snapshot values — these were locked at checkout)
      const {
        shippingAddress,
        paymentMethod,
        notes,
        deliveryType,
        selectedDeliveryPrice,
        selectedCourier,
        vendorBreakdown: snapshotVendorBreakdown,
        vendorDeliveries: snapshotVendorDeliveries,
      } = snapshot;

      let totalShippingCost = 0;
      const vendorShipments: any[] = [];

      if (!isDigitalOnly && deliveryType !== 'pickup') {
        // ✅ NEW: per-vendor deliveries from new checkout UI
        if (snapshotVendorDeliveries && snapshotVendorDeliveries.length > 0) {
          for (const group of vendorGroups) {
            const physicalItems = group.items.filter(item => item.isPhysical);
            if (physicalItems.length === 0) continue;
            const vd = snapshotVendorDeliveries.find((v: any) => v.vendorId === group.vendorId);
            const shippingCost = vd != null ? (vd.price ?? 0) : this.getDefaultRate(deliveryType);
            totalShippingCost += shippingCost;
            vendorShipments.push({
              vendor: group.vendorId,
              vendorName: group.vendorName,
              items: group.items.filter(item => item.isPhysical).map(item => item.productId),
              origin: (() => { const o = (group as any).pickupAddress?.street ? (group as any).pickupAddress : group.vendorAddress; return { street: o.street || '', city: o.city, state: o.state, country: o.country }; })(),
              shippingCost,
              courier: vd?.courier || selectedCourier,
              requestedCourier: vd?.courier || selectedCourier,
              status: 'pending',
            });
          }
        } else if (selectedDeliveryPrice !== undefined && selectedDeliveryPrice !== null) {
          if (snapshotVendorBreakdown && snapshotVendorBreakdown.length > 0) {
            for (const group of vendorGroups) {
              const physicalItems = group.items.filter(item => item.isPhysical);
              if (physicalItems.length === 0) continue;

              const vendorShipping = snapshotVendorBreakdown.find(
                (v: any) => v.vendorId === group.vendorId
              );
              const shippingCost = vendorShipping?.price || this.getDefaultRate(deliveryType);
              totalShippingCost += shippingCost;

              vendorShipments.push({
                vendor: group.vendorId,
                vendorName: group.vendorName,
                items: group.items.map(item => item.productId),
                origin: (() => { const o = (group as any).pickupAddress?.street ? (group as any).pickupAddress : group.vendorAddress; return { street: o.street || '', city: o.city, state: o.state, country: o.country }; })(),
                shippingCost,
                courier: vendorShipping?.courier || selectedCourier,
                requestedCourier: vendorShipping?.courier || selectedCourier,
                status: 'pending',
              });
            }
          } else {
            totalShippingCost = selectedDeliveryPrice;
            for (const group of vendorGroups) {
              const physicalItems = group.items.filter(item => item.isPhysical);
              if (physicalItems.length === 0) continue;

              vendorShipments.push({
                vendor: group.vendorId,
                vendorName: group.vendorName,
                items: group.items.map(item => item.productId),
                origin: (() => { const o = (group as any).pickupAddress?.street ? (group as any).pickupAddress : group.vendorAddress; return { street: o.street || '', city: o.city, state: o.state, country: o.country }; })(),
                shippingCost: selectedDeliveryPrice,
                courier: selectedCourier,
                requestedCourier: selectedCourier,
                status: 'pending',
              });
            }
          }
        } else {
          for (const group of vendorGroups) {
            const physicalItems = group.items.filter(item => item.isPhysical);
            if (physicalItems.length === 0) continue;
            const fallbackCost = this.getDefaultRate(deliveryType);
            totalShippingCost += fallbackCost;
            vendorShipments.push({
              vendor: group.vendorId,
              vendorName: group.vendorName,
              items: group.items.map(item => item.productId),
              origin: (() => { const o = (group as any).pickupAddress?.street ? (group as any).pickupAddress : group.vendorAddress; return { street: o.street || '', city: o.city, state: o.state, country: o.country }; })(),
              shippingCost: fallbackCost,
              courier: selectedCourier || 'Standard Courier',
              requestedCourier: selectedCourier || 'Standard Courier',
              status: 'pending',
            });
          }
        }
      }

      const subtotal = cartToUse ? cartToUse.subtotal : snapshot.subtotal;
      const rawDiscount = cartToUse ? cartToUse.discount : snapshot.discount;
      const discount = Math.min(rawDiscount, subtotal); // cap stale coupon discount to actual subtotal
      const tax = 0;
      const baseTotal = Math.max(0, subtotal - discount + totalShippingCost + tax);
      const serviceCharge = isDigitalOnly ? 0 : calculateServiceCharge(baseTotal);
      const total = Math.round(baseTotal + serviceCharge);

      const orderNumber = reference; // Use the payment reference as order number

      // Step 6: Check for duplicate — prevent double-creation if user retries
      const existingOrder = await Order.findOne({ orderNumber });
      if (existingOrder) {
        logger.info('⚠️ Order already exists for this payment reference — returning existing');
        res.json({
          success: true,
          message: 'Order already confirmed',
          data: { order: existingOrder, isDigital: isDigitalOnly },
        });
        return;
      }

      // Step 7: Create order with COMPLETED payment status
      logger.info('💾 Creating order with verified payment...', { orderNumber, total });

      // Resolve affiliate if a code was passed at checkout
      let affiliateUserId: any = undefined;
      let affiliateCommissionAmount = 0;
      let affiliateLinkId: any = undefined;
      const snapshotAffiliateCode = snapshot.affiliateCode
        ? (snapshot.affiliateCode as string).toUpperCase()
        : undefined;
      if (snapshotAffiliateCode) {
        try {
          const linkRecord = await AffiliateLink.findOne({ code: snapshotAffiliateCode, isActive: true });
          if (linkRecord && linkRecord.user.toString() !== req.user?.id) {
            let commissionSum = 0;
            if (linkRecord.product) {
              // Product-specific link: commission only on the affiliated product
              const affiliatedItem = orderItems.find(
                (item: any) => item.product.toString() === linkRecord.product!.toString()
              );
              if (affiliatedItem) {
                const prod: any = await Product.findById(linkRecord.product).select('affiliateCommission').lean();
                const rate = prod?.affiliateCommission || 3;
                commissionSum = (affiliatedItem.price || 0) * (affiliatedItem.quantity || 1) * (rate / 100);
              }
            } else {
              // General affiliate link: commission on full subtotal using per-product rates
              for (const item of orderItems) {
                const prod: any = await Product.findById(item.product).select('affiliateCommission').lean();
                const rate = prod?.affiliateCommission || 0;
                if (rate > 0) commissionSum += (item.price || 0) * (item.quantity || 1) * (rate / 100);
              }
              if (commissionSum === 0) commissionSum = subtotal * 0.03;
            }
            affiliateUserId = linkRecord.user;
            affiliateLinkId = linkRecord._id;
            affiliateCommissionAmount = Math.round(commissionSum * 100) / 100;
            logger.info(`🤝 Affiliate code ${snapshotAffiliateCode} resolved — commission: ₦${affiliateCommissionAmount}`);
          }
        } catch (affiliateErr) {
          logger.error('Error resolving affiliate:', affiliateErr);
        }
      }

      // Detect first order for customer and vendors (count BEFORE creating)
      const priorCustomerOrders = await Order.countDocuments({ user: req.user?.id });
      const isFirstOrder = priorCustomerOrders === 0;
      const firstOrderVendorIds: string[] = [];
      for (const group of vendorGroups) {
        const priorVendorOrders = await Order.countDocuments({ 'items.vendor': new mongoose.Types.ObjectId(group.vendorId) });
        if (priorVendorOrders === 0) firstOrderVendorIds.push(group.vendorId);
      }

      const order = await Order.create({
        orderNumber,
        user: req.user?.id,
        items: orderItems,
        subtotal,
        discount,
        shippingCost: totalShippingCost,
        tax,
        serviceCharge,
        total,
        status: isDigitalOnly ? OrderStatus.DELIVERED : OrderStatus.PENDING,
        paymentStatus: PaymentStatus.COMPLETED,
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

      logger.info(`✅ Order created with verified payment: ${order._id}`);

      // Track order in Slack — customer channel (fire per order), vendor channel (fire per vendor)
      try {
        trackEvent(
          isFirstOrder ? SlackEvent.CUSTOMER_FIRST_ORDER : SlackEvent.CUSTOMER_ORDER_PLACED,
          {
            actor: {
              id: req.user?.id,
              name: (req.user as any)?.firstName && (req.user as any)?.lastName ? `${(req.user as any).firstName} ${(req.user as any).lastName}` : undefined,
              email: (req.user as any)?.email,
            },
            message: `${isFirstOrder ? '🎊 FIRST ORDER' : '🛒 Order placed'} — ${orderNumber}\n${vendorGroups.length} vendor${vendorGroups.length === 1 ? '' : 's'} · ${orderItems.length} item${orderItems.length === 1 ? '' : 's'} · Total ₦${total.toLocaleString()}`,
            meta: {
              orderNumber,
              total: `₦${total.toLocaleString()}`,
              itemCount: orderItems.length,
              vendorCount: vendorGroups.length,
              deliveryType,
              paymentMethod,
              shippingCost: `₦${totalShippingCost.toLocaleString()}`,
              currentStep: deliveryType === 'pickup' ? 'Vendor to prepare for pickup' : 'Vendor to fulfill + ShipBubble creates shipment',
              journeyStage: isFirstOrder ? '3 of 3 (Signup → OTP → First Order ✅)' : 'Returning customer order',
            },
          },
        );
        // High-value order flag
        if (total >= 100_000) {
          trackEvent(SlackEvent.CUSTOMER_HIGH_VALUE_ORDER, {
            actor: { id: req.user?.id, email: (req.user as any)?.email },
            message: `💰 High-value order — ${orderNumber} (₦${total.toLocaleString()})`,
            meta: { orderNumber, total: `₦${total.toLocaleString()}` },
          });
        }
        // Vendor-side: notify each vendor's channel; flag first-sale specifically
        for (const group of vendorGroups) {
          const priorSales = await Order.countDocuments({
            'items.vendor': new mongoose.Types.ObjectId(group.vendorId),
            _id: { $ne: order._id },
          });
          trackEvent(
            priorSales === 0 ? SlackEvent.VENDOR_FIRST_SALE : SlackEvent.VENDOR_ORDER_RECEIVED,
            {
              actor: { id: group.vendorId, name: group.vendorName },
              message: `${priorSales === 0 ? '🎊 FIRST SALE' : 'Order received'} — ${orderNumber}`,
              meta: {
                orderNumber,
                vendorName: group.vendorName,
                itemCount: group.items.length,
                subtotal: `₦${(group.items.reduce((s: number, i: any) => s + i.price * i.quantity, 0)).toLocaleString()}`,
              },
            },
          );
        }
      } catch (err: any) {
        logger.error('[Slack] Order tracking failed:', err?.message);
      }

      // Mark the pending payment record as done
      try {
        await PendingPayment.findOneAndUpdate(
          { reference },
          { status: 'completed', completedAt: new Date() }
        );
      } catch { /* non-critical */ }

      // Deduct VCredits NOW — payment is confirmed, safe to remove from wallet
      const vCreditsApplied = snapshot.vCreditsApplied || 0;
      if (vCreditsApplied > 0) {
        try {
          // Atomic: deduct only if sufficient vCredits exist — prevents race condition on concurrent orders
          // Using VCredits resets the 60-day expiry clock on the remaining balance
          const { rewardController } = await import('./reward.controller');
          const vcWallet = await Wallet.findOneAndUpdate(
            { user: snapshot.userId, vCredits: { $gte: vCreditsApplied } },
            {
              $inc: { vCredits: -vCreditsApplied },
              $set: { vCreditsExpiresAt: rewardController.vCreditsExpiry(), vCreditsRemindersSent: [] },
              $push: {
                transactions: {
                  type: TransactionType.DEBIT,
                  amount: vCreditsApplied,
                  purpose: WalletPurpose.PURCHASE,
                  reference: `VCREDITS-${order._id}`,
                  description: `VCredits applied to order #${order.orderNumber}`,
                  status: 'completed',
                  timestamp: new Date(),
                },
              },
            },
            { new: true }
          );
          if (vcWallet) {
            logger.info(`💎 VCredits deducted after payment confirmed: ${vCreditsApplied}`);
          } else {
            logger.warn(`⚠️ VCredits deduction skipped — insufficient balance or wallet not found`);
          }
        } catch (vcErr) {
          logger.error('Failed to deduct VCredits after payment confirm:', vcErr);
        }
      }

      // Re-activate any closed conversations between the customer and each vendor
      try {
        const vendorIds = [...new Set(orderItems.map((i: any) => i.vendor.toString()))];
        const customerId = req.user!.id;
        for (const vendorId of vendorIds) {
          await Conversation.updateMany(
            { participants: { $all: [customerId, vendorId] }, isActive: false },
            { isActive: true }
          );
        }
      } catch (convActivateErr) {
        logger.error('Error re-activating conversations on order create:', convActivateErr);
      }

      // Step 8: Clear cart
      if (cartToUse) {
        cartToUse.items = [];
        cartToUse.couponCode = undefined;
        cartToUse.discount = 0;
        await cartToUse.save();
        logger.info('🛒 Cart cleared after confirmed payment');
      }

      // Step 9: Update coupon usage
      if (order.couponCode) {
        const { Coupon } = await import('../models/Additional');
        await Coupon.findOneAndUpdate(
          { code: order.couponCode },
          {
            $inc: { usageCount: 1 },
            $push: { usedBy: user._id },
          }
        );
      }

      // Step 10: Reduce stock atomically & update sales
      for (const item of order.items) {
        const product: any = await Product.findById(item.product);
        if (!product) continue;
        const productType = product.productType?.toUpperCase();
        const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';

        if (isPhysical) {
          // Atomic decrement — only succeeds if sufficient stock remains.
          // This prevents two concurrent payments from both draining the last unit.
          const updated = await Product.findOneAndUpdate(
            { _id: item.product, quantity: { $gte: item.quantity } },
            { $inc: { quantity: -item.quantity, totalSales: item.quantity } },
            { new: true }
          );
          if (!updated) {
            logger.warn(`⚠️ Stock exhausted for product ${item.product} after payment — order ${order._id} oversold`);
          }
          await notifyCartUsersAboutStock(
            item.product,
            product.name,
            product.quantity,
            item.quantity,
            req.user!.id,
            product.vendor?.toString() || '',
            product.lowStockThreshold ?? 10
          );
        } else {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { totalSales: item.quantity },
          });
        }
      }

      // Points and affiliate commission credited on delivery — see completeOrder

      // Step 12: Send confirmation email + receipt PDF
      try {
        const vendorNameMap = new Map<string, string>(
          (order.vendorShipments || []).map((s: any) => [s.vendor.toString(), s.vendorName])
        );
        const emailItems = order.items.map((item: any) => ({
          productName: item.productName,
          productImage: item.productImage,
          quantity: item.quantity,
          price: item.price,
          vendorName: vendorNameMap.get(item.vendor.toString()),
        }));
        let receiptPdf: Buffer | undefined;
        try {
          receiptPdf = await generateReceiptPDF({
            orderNumber: order.orderNumber,
            date: order.createdAt,
            paymentMethod: order.paymentMethod,
            paymentReference: order.paymentReference,
            customer: { name: `${user.firstName} ${(user as any).lastName || ''}`.trim(), email: user.email },
            deliveryAddress: order.shippingAddress as any,
            items: order.items.map((item: any) => ({
              productName: item.productName,
              vendorName: vendorNameMap.get(item.vendor.toString()),
              quantity: item.quantity,
              price: item.price,
            })),
            subtotal: order.subtotal || 0,
            discount: order.discount || 0,
            shippingCost: order.shippingCost || 0,
            serviceCharge: order.serviceCharge || 0,
            total: order.total,
          });
        } catch (pdfErr: any) {
          logger.error('Receipt PDF generation failed:', pdfErr.message);
        }
        await sendOrderConfirmationEmail(user.email, order.orderNumber, order.total, user.firstName, emailItems, receiptPdf);
        logger.info('✅ Confirmation email sent');
      } catch (error) {
        logger.error('Error sending confirmation email:', error);
      }

      // Send notifications to customer and vendors
      try {
        const vendorIds = [...new Set(order.items.map((item: any) => item.vendor.toString()))];
        await notificationService.orderPlaced(
          order._id.toString(),
          order.orderNumber,
          order.total,
          req.user!.id,
          vendorIds
        );
        await notificationService.paymentCompleted(
          order._id.toString(),
          order.orderNumber,
          order.total,
          req.user!.id
        );
        emitNewOrder({ orderId: order._id.toString(), orderNumber: order.orderNumber, vendorIds });
      } catch (error) {
        logger.error('Error sending order notifications:', error);
      }

      logger.info('✅ ============================================');
      logger.info('✅ PAYMENT CONFIRMED & ORDER CREATED');
      logger.info('✅ ============================================');

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
    private async createVendorShipments(
      order: any,
      user: any,
      vendorGroups: VendorGroup[],
      deliveryType: string
    ) {
      logger.info('🚚 ============================================');
      logger.info('🚚 CREATE VENDOR SHIPMENTS STARTED');
      logger.info('🚚 ============================================');
      logger.info('📋 Shipment info:', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        vendorCount: vendorGroups.length,
        deliveryType,
      });

      for (let i = 0; i < vendorGroups.length; i++) {
        const group = vendorGroups[i];
        
        logger.info(`\n📦 -------- Vendor ${i + 1}/${vendorGroups.length} --------`);
        logger.info(`📦 Vendor: ${group.vendorName} (${group.vendorId})`);

        const physicalItems = group.items.filter(item => item.isPhysical);

        if (physicalItems.length === 0) {
          logger.info(`⏭️ Skipping ${group.vendorName} - no physical items`);
          continue;
        }

        logger.info(`📦 Physical items: ${physicalItems.length}/${group.items.length}`);

        // Re-fetch the order from DB to get the latest trackingNumber state.
        // This prevents duplicate Shipbubble labels when the vendor hits confirm
        // multiple times (each request saw an empty vendorShipments array and proceeded).
        const freshOrder = await Order.findById(order._id).select('vendorShipments').lean();
        const freshVS = (freshOrder as any)?.vendorShipments?.find((vs: any) => {
          const vsId = typeof vs.vendor === 'object' ? vs.vendor._id?.toString() : vs.vendor?.toString();
          return vsId === group.vendorId;
        });
        if (freshVS?.trackingNumber && freshVS.trackingNumber !== 'CREATING') {
          logger.info(`⏭️ Shipment already exists for vendor ${group.vendorName} (${freshVS.trackingNumber}) — skipping`);
          continue;
        }

        try {
          const vendor = await User.findById(group.vendorId);
          const vendorProfile = await VendorProfile.findOne({ user: group.vendorId });
          
          if (!vendor) {
            logger.warn(`⚠️ Vendor user not found: ${group.vendorId}`);
            continue;
          }

          logger.info('👤 Vendor details:', {
            name: `${vendor.firstName} ${vendor.lastName}`,
            email: vendor.email,
            phone: vendor.phone,
          });

          logger.info('🏢 Vendor profile:', {
            hasProfile: !!vendorProfile,
            businessName: vendorProfile?.businessName,
            businessAddress: vendorProfile?.businessAddress,
          });

          // Build addresses — prefer product-level pickupAddress over vendor business address
          const usingPickupAddress = !!(group as any).pickupAddress?.street;
          const senderOrigin = usingPickupAddress ? (group as any).pickupAddress : group.vendorAddress;
          const senderFullAddress = `${senderOrigin.street || 'Store Address'}, ${senderOrigin.city}, ${senderOrigin.state}, ${senderOrigin.country}`;
          const receiverFullAddress = `${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.country || 'Nigeria'}`;

          // ShipBubble requires a full-name (2+ words, letters + spaces only — no numbers, no symbols).
          // Business names like "Seyiscents" (1 word) or "Seyi's Scents" (apostrophe) get rejected.
          // Strip symbols + numbers, then require 2+ words. Fall back to owner name if not enough words.
          const shipBubbleSafeName = (preferred: string, fallback: string): string => {
            const clean = (s: string) =>
              (s || '').replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
            const cleanedPreferred = clean(preferred);
            if (cleanedPreferred.split(' ').filter(Boolean).length >= 2) return cleanedPreferred;
            const cleanedFallback = clean(fallback);
            if (cleanedFallback.split(' ').filter(Boolean).length >= 2) return cleanedFallback;
            // Last resort — pad the single word we have
            const single = cleanedPreferred || cleanedFallback || 'Store';
            return `${single} Vendor`;
          };
          const ownerFullName = vendor.firstName && vendor.lastName
            ? `${vendor.firstName} ${vendor.lastName}`
            : vendor.firstName || vendor.lastName || '';
          const senderName = shipBubbleSafeName(group.vendorName, ownerFullName);

          const senderAddress = {
            name: senderName,
            phone: vendorProfile?.businessPhone || vendor.phone || '+2348000000000',
            email: vendorProfile?.businessEmail || vendor.email || 'sender@store.com',
            address: senderFullAddress,
          };

          const receiverFallbackName = order.shippingAddress.fullName || `${user.firstName} ${user.lastName}`;
          const receiverName = shipBubbleSafeName(receiverFallbackName, `${user.firstName || ''} ${user.lastName || ''}`);

          const receiverAddress = {
            name: receiverName,
            phone: order.shippingAddress.phone || user.phone || '+2348000000000',
            email: user.email,
            address: receiverFullAddress,
          };

          logger.info('📍 SHIPBUBBLE ADDRESSES:', {
            addressSource: usingPickupAddress ? 'product pickupAddress' : 'vendor businessAddress',
            sender: {
              name: senderAddress.name,
              phone: senderAddress.phone,
              email: senderAddress.email,
              address: senderAddress.address,
            },
            receiver: {
              name: receiverAddress.name,
              phone: receiverAddress.phone,
              email: receiverAddress.email,
              address: receiverAddress.address,
            },
          });

          const packageItems = physicalItems.map((item: any) => ({
            name: item.productName,
            description: item.productName,
            unit_weight: item.weight.toString(),
            unit_amount: item.price.toString(),
            quantity: item.quantity.toString(),
          }));

          logger.info('📦 Package items:', packageItems);

          // ✅ FIX: Determine category for ShipBubble
          const categoryId = this.determineCategoryForItems(physicalItems);

          // Use stored ShipBubble address codes when available — skips redundant validation
          // and avoids re-hitting name-format errors on already-validated addresses.
          const storedSenderCode = usingPickupAddress
            ? (senderOrigin as any)?.shipBubble?.addressCode
            : (vendorProfile?.businessAddress as any)?.shipBubble?.addressCode;
          const storedReceiverCode = (order.shippingAddress as any)?.shipBubble?.addressCode;

          // Step 1: Get delivery rates
          logger.info('🔍 Fetching delivery rates from ShipBubble...', {
            usingStoredSenderCode: !!storedSenderCode,
            usingStoredReceiverCode: !!storedReceiverCode,
          });

          const ratesResponse = await shipBubbleService.getDeliveryRates(
            senderAddress,
            receiverAddress,
            packageItems,
            undefined,
            categoryId,
            storedSenderCode,
            storedReceiverCode,
          );

          logger.info('📊 Rates response:', {
            status: ratesResponse.status,
            message: ratesResponse.message,
            hasData: !!ratesResponse.data,
            requestToken: ratesResponse.data?.request_token,
            courierCount: ratesResponse.data?.couriers?.length || 0,
          });

          if (ratesResponse.status === 'success' && ratesResponse.data?.request_token) {
            logger.info('✅ Delivery rates fetched successfully');

            // Find the courier the customer originally chose for this vendor
            const storedVendorShipment = order.vendorShipments?.find(
              (vs: any) => {
                const vsId = typeof vs.vendor === 'object'
                  ? vs.vendor._id?.toString()
                  : vs.vendor?.toString();
                return vsId === group.vendorId;
              }
            );
            // Prefer requestedCourier (customer's original choice, never overwritten)
            // Fall back to courier for orders created before this field was added
            const storedCourierName: string | undefined =
              storedVendorShipment?.requestedCourier || storedVendorShipment?.courier;

            // Try to match the stored courier name against the fresh rate list
            let selectedCourier;
            if (storedCourierName && ratesResponse.data?.couriers?.length) {
              const normalizedStored = storedCourierName.toLowerCase();
              selectedCourier = ratesResponse.data.couriers.find(
                (c: any) => c.courier_name?.toLowerCase().includes(normalizedStored) ||
                            normalizedStored.includes(c.courier_name?.toLowerCase())
              );
              if (selectedCourier) {
                logger.info(`✅ Matched stored courier "${storedCourierName}" → "${selectedCourier.courier_name}"`);
              } else {
                logger.warn(`⚠️ Stored courier "${storedCourierName}" not in fresh rates, falling back`);
              }
            }

            // Fall back to cheapest/fastest when no stored courier matched
            if (!selectedCourier) {
              if (deliveryType === 'express' || deliveryType === 'same_day') {
                selectedCourier = ratesResponse.data.fastest_courier || ratesResponse.data.couriers[0];
                logger.info('⚡ Selected fastest courier (fallback)');
              } else {
                selectedCourier = ratesResponse.data.cheapest_courier || ratesResponse.data.couriers[0];
                logger.info('💰 Selected cheapest courier (fallback)');
              }
            }

            if (selectedCourier) {
              logger.info('🚚 Selected courier:', {
                name: selectedCourier.courier_name,
                id: selectedCourier.courier_id,
                serviceCode: selectedCourier.service_code,
                price: selectedCourier.total || selectedCourier.rate_card_amount,
                eta: selectedCourier.delivery_eta,
              });

              // Step 2: Create shipment
              logger.info('📝 Creating ShipBubble shipment...');
              logger.info('📤 Shipment request:', {
                requestToken: ratesResponse.data.request_token,
                courierId: selectedCourier.courier_id,
                serviceCode: selectedCourier.service_code,
              });

              const shipment = await shipBubbleService.createShipment(
                ratesResponse.data.request_token,
                selectedCourier.courier_id,
                selectedCourier.service_code,
                false // isInvoiceRequired
              );

              logger.info('📥 Shipment creation response:', {
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
              
              if (orderId) {
                logger.info('✅ Shipment created successfully:', {
                  orderId: orderId,
                  trackingUrl: trackingUrl,
                  shipmentId: shipment.data.shipment_id,
                  courier: selectedCourier.courier_name,
                });

                // Update order with tracking info
                const vendorShipment = order.vendorShipments.find(
                  (vs: any) => {
                    const vsId = typeof vs.vendor === 'object'
                      ? vs.vendor._id?.toString()
                      : vs.vendor?.toString();
                    return vsId === group.vendorId;
                  }
                );

                if (vendorShipment) {
                  // Always save orderId so the no-tracking guard doesn't re-trigger
                  vendorShipment.trackingNumber = orderId;
                  vendorShipment.shipmentId = shipment.data.shipment_id || orderId;
                  vendorShipment.courier = selectedCourier.courier_name;
                  vendorShipment.status = 'created';
                  if (trackingUrl) vendorShipment.trackingUrl = trackingUrl;

                  logger.info('✅ Updated order with tracking info:', {
                    trackingNumber: vendorShipment.trackingNumber,
                    shipmentId: vendorShipment.shipmentId,
                    courier: vendorShipment.courier,
                    trackingUrl: vendorShipment.trackingUrl,
                  });
                } else {
                  // No vendorShipment entry pre-created (e.g. old checkout flow or empty array).
                  // Push a new entry so tracking is recorded and future calls are blocked.
                  if (!order.vendorShipments) order.vendorShipments = [];
                  order.vendorShipments.push({
                    vendor: group.vendorId,
                    vendorName: group.vendorName,
                    items: [],
                    origin: { street: '', city: '', state: '', country: 'Nigeria' },
                    shippingCost: 0,
                    trackingNumber: orderId,
                    shipmentId: shipment.data.shipment_id || orderId,
                    courier: selectedCourier.courier_name,
                    status: 'created',
                    ...(trackingUrl && { trackingUrl }),
                  } as any);
                  logger.warn(`⚠️ No vendorShipment entry found for ${group.vendorName} — pushed new entry with tracking ${orderId}`);
                }

                await order.save();
                logger.info(`✅ Shipment created for vendor ${group.vendorName}. Order ID: ${orderId}`);
              } else {
                logger.error('❌ Missing order_id in shipment response:', {
                  hasOrderId: !!orderId,
                  hasTrackingUrl: !!trackingUrl,
                  response: shipment,
                });
              }
            } else {
              logger.error('❌ No courier selected from rates');
            }
          } else {
            logger.error('❌ Failed to get delivery rates:', {
              status: ratesResponse.status,
              message: ratesResponse.message,
            });
          }
        } catch (error: any) {
          logger.error(`❌ Error creating shipment for vendor ${group.vendorName}:`, {
            error: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            stack: error.stack,
          });
        }
      }

      logger.info('🚚 ============================================');
      logger.info('🚚 CREATE VENDOR SHIPMENTS COMPLETED');
      logger.info('🚚 ============================================\n');
    }

    /**
     * Verify payment - Supports Paystack and Flutterwave
     */
    /**
     * GET /orders/payment/status/:reference
     * Mobile recovery endpoint — called when user re-opens app after a dropped payment session.
     * Returns order if created, or re-verifies with Paystack and creates the order if payment succeeded.
     */
    async getPaymentStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { reference } = req.params;

      // 1. Order already created (happy path or webhook already handled it)
      const existingOrder = await Order.findOne({
        orderNumber: reference,
        user: req.user?.id,
      });
      if (existingOrder) {
        res.json({
          success: true,
          data: { status: 'completed', order: existingOrder },
        });
        return;
      }

      // 2. Check PendingPayment record
      const { PendingPayment } = await import('../models/PendingPayment');
      const pending = await PendingPayment.findOne({ reference, userId: req.user?.id });

      if (!pending) {
        res.json({ success: true, data: { status: 'not_found' } });
        return;
      }

      if (pending.status === 'failed') {
        res.json({ success: true, data: { status: 'failed' } });
        return;
      }

      // 3. Payment is pending — actively re-verify with the right gateway
      try {
        let paymentVerified = false;
        let paidAmountNaira = 0;

        if (pending.gateway === 'flutterwave') {
          const verification = await flutterwaveService.verifyPaymentByRef(reference);
          if (verification.data?.status === 'successful') {
            paymentVerified = true;
            paidAmountNaira = verification.data.charged_amount ?? verification.data.amount;
          }
        } else {
          // Default: Paystack
          const verification = await paystackService.verifyPayment(reference);
          if (verification.data.status === 'success') {
            paymentVerified = true;
            paidAmountNaira = verification.data.amount / 100;
          }
        }

        if (!paymentVerified) {
          res.json({ success: true, data: { status: 'pending' } });
          return;
        }

        // Payment DID succeed — webhook may have been delayed.
        // Re-use the snapshot we saved to build the order now.
        if (!pending.snapshotJson) {
          res.json({ success: true, data: { status: 'processing', message: 'Payment confirmed — order being created' } });
          return;
        }

        const snapshot = JSON.parse(pending.snapshotJson);

        // Validate amount
        if (paidAmountNaira < snapshot.cardChargeAmount - 1) {
          await PendingPayment.findOneAndUpdate({ reference }, { status: 'failed' });
          res.json({ success: true, data: { status: 'failed', message: 'Payment amount mismatch' } });
          return;
        }

        // Re-check idempotency (webhook may have just created it)
        const raceCheck = await Order.findOne({ orderNumber: reference });
        if (raceCheck) {
          res.json({ success: true, data: { status: 'completed', order: raceCheck } });
          return;
        }

        // Create order from snapshot (same core logic used by webhook handler)
        const cart = await Cart.findById(snapshot.cartId).populate({
          path: 'items.product',
          populate: { path: 'vendor', select: 'firstName lastName email' },
        });

        let orderItems: any[] = [];
        const isDigitalOnly: boolean = snapshot.isDigitalOnly || false;
        if (cart && cart.items.length > 0) {
          orderItems = cart.items.map((item: any) => ({
            product:      item.product._id,
            productName:  item.product.name,
            productImage: item.product.images?.[0],
            productType:  item.product.productType || 'physical',
            variant:      item.variant,
            quantity:     item.quantity,
            price:        item.price,
            vendor:       item.product.vendor._id,
          }));
        }

        const order = await Order.create({
          orderNumber:      reference,
          user:             req.user?.id,
          items:            orderItems,
          subtotal:         snapshot.subtotal,
          discount:         snapshot.discount || 0,
          shippingCost:     snapshot.totalShippingCost || 0,
          tax:              snapshot.tax || 0,
          serviceCharge:    snapshot.serviceCharge || 0,
          total:            snapshot.total,
          status:           isDigitalOnly ? OrderStatus.DELIVERED : OrderStatus.PENDING,
          paymentStatus:    PaymentStatus.COMPLETED,
          paymentMethod:    snapshot.paymentMethod,
          paymentReference: reference,
          shippingAddress:  isDigitalOnly ? undefined : snapshot.shippingAddress,
          couponCode:       snapshot.couponCode,
          notes:            snapshot.notes,
          deliveryType:     isDigitalOnly ? 'digital' : snapshot.deliveryType,
          isPickup:         snapshot.deliveryType === 'pickup' || isDigitalOnly,
          isDigital:        isDigitalOnly,
        });

        await PendingPayment.findOneAndUpdate(
          { reference },
          { status: 'completed', completedAt: new Date() }
        );

        // Deduct VCredits
        if ((snapshot.vCreditsApplied || 0) > 0) {
          await Wallet.findOneAndUpdate(
            { user: req.user?.id, vCredits: { $gte: snapshot.vCreditsApplied } },
            {
              $inc: { vCredits: -snapshot.vCreditsApplied },
              $push: {
                transactions: {
                  type: TransactionType.DEBIT, amount: snapshot.vCreditsApplied,
                  purpose: WalletPurpose.PURCHASE, reference: `VCREDITS-${order._id}`,
                  description: `VCredits applied to order #${order.orderNumber}`,
                  status: 'completed', timestamp: new Date(),
                },
              },
            }
          );
        }

        // Stock deduction
        for (const item of orderItems) {
          const isPhysical = item.productType?.toUpperCase() !== 'DIGITAL' && item.productType?.toUpperCase() !== 'SERVICE';
          if (isPhysical) {
            await Product.findOneAndUpdate(
              { _id: item.product, quantity: { $gte: item.quantity } },
              { $inc: { quantity: -item.quantity, totalSales: item.quantity } }
            );
          } else {
            await Product.findByIdAndUpdate(item.product, { $inc: { totalSales: item.quantity } });
          }
        }

        // Clear cart
        if (cart && cart.items.length > 0) { cart.items = []; await cart.save(); }

        // Notify
        try {
          const vendorIds = [...new Set(orderItems.map((i: any) => i.vendor.toString()))];
          await notificationService.orderPlaced(order._id.toString(), order.orderNumber, order.total, req.user!.id, vendorIds);
          await notificationService.paymentCompleted(order._id.toString(), order.orderNumber, order.total, req.user!.id);
        } catch { /* non-critical */ }

        logger.info(`[PaymentStatus] Order recovered for ${reference}: ${order._id}`);
        res.json({ success: true, data: { status: 'completed', order } });
      } catch (err: any) {
        logger.error(`[PaymentStatus] Error checking ${reference}:`, err.message);
        res.json({ success: true, data: { status: 'pending' } });
      }
    }

    async verifyPayment(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { reference } = req.params;
      const { provider, transaction_id } = req.query;

      logger.info('💳 ============================================');
      logger.info('💳 VERIFY PAYMENT STARTED');
      logger.info('💳 ============================================');
      logger.info('🔍 Payment reference:', reference);
      logger.info('🔍 Provider:', provider || 'paystack (default)');
      logger.info('🔍 Transaction ID:', transaction_id || 'N/A');

      const order = await Order.findOne({
        orderNumber: reference,
        user: req.user?.id,
      }).populate('items.product');
      if (!order) {
        throw new AppError('Order not found', 404);
      }

      logger.info('📦 Order found:', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
      });

      if (order.paymentStatus === PaymentStatus.COMPLETED) {
        logger.info('✅ Payment already verified');
        res.json({
          success: true,
          message: 'Payment already verified',
          data: { order },
        });
        return;
      }

      try {
        let paymentSuccess = false;
        const paymentProvider = provider as string || order.paymentMethod || 'paystack';

        // ✅ Verify with the correct provider
        if (paymentProvider === 'flutterwave') {
          logger.info('🔍 Verifying payment with Flutterwave...');
          
          let verification;
          if (transaction_id) {
            // Verify by Flutterwave transaction ID (from redirect URL params)
            verification = await flutterwaveService.verifyPayment(transaction_id as string);
          } else {
            // Verify by tx_ref (our order number)
            verification = await flutterwaveService.verifyPaymentByRef(reference);
          }

          logger.info('📥 Flutterwave verification response:', {
            status: verification.data?.status,
            amount: verification.data?.amount,
            currency: verification.data?.currency,
          });

          // Flutterwave uses 'successful' status
          if (verification.data?.status === 'successful') {
            // Verify amount matches
            if (verification.data.amount >= order.total) {
              paymentSuccess = true;
            } else {
              logger.error('❌ Amount mismatch:', {
                expected: order.total,
                received: verification.data.amount,
              });
              throw new AppError('Payment amount does not match order total', 400);
            }
          }
        } else {
          // Default: Paystack
          logger.info('🔍 Verifying payment with Paystack...');
          
          const verification = await paystackService.verifyPayment(reference);

          logger.info('📥 Paystack verification response:', {
            status: verification.data.status,
            amount: verification.data.amount,
          });

          if (verification.data.status === 'success') {
            // Paystack returns amount in kobo (100 kobo = ₦1)
            const paidNaira = verification.data.amount / 100;
            if (paidNaira >= order.total) {
              paymentSuccess = true;
            } else {
              logger.error('❌ Paystack amount mismatch:', {
                expected: order.total,
                received: paidNaira,
              });
              throw new AppError('Payment amount does not match order total', 400);
            }
          }
        }

        if (paymentSuccess) {
          logger.info('✅ Payment verified successfully');
          
          const isDigitalOnly = this.isDigitalOnly(order.items);
          
          logger.info('📦 Order type:', { isDigitalOnly });

          // Atomic: only mark completed if still pending — prevents double stock-decrement on concurrent calls
          const processedOrder = await Order.findOneAndUpdate(
            { _id: order._id, paymentStatus: PaymentStatus.PENDING },
            {
              paymentStatus: PaymentStatus.COMPLETED,
              status: isDigitalOnly ? OrderStatus.DELIVERED : OrderStatus.PENDING,
            },
            { new: true }
          );

          if (!processedOrder) {
            logger.info('⚠️ Order already completed by concurrent request — skipping stock decrement');
            res.json({ success: true, message: 'Payment already verified', data: { order } });
            return;
          }

          logger.info('✅ Order status updated:', {
            status: processedOrder.status,
            paymentStatus: processedOrder.paymentStatus,
          });

          // Reduce product quantities
          logger.info('📊 Updating product quantities...');

          for (const item of order.items) {
            const product: any = await Product.findById(item.product);
            if (!product) continue;

            const productType = product.productType?.toUpperCase();
            const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';

            if (isPhysical) {
              // Atomic: $gte guard prevents quantity going negative if two payments race
              const stockUpdated = await Product.findOneAndUpdate(
                { _id: item.product, quantity: { $gte: item.quantity } },
                { $inc: { quantity: -item.quantity, totalSales: item.quantity } }
              );
              if (!stockUpdated) {
                logger.warn(`⚠️ Stock exhausted for product ${item.product} in verifyPayment — oversold`);
              }
              logger.info(`✅ Updated physical product: ${product.name}`);
            } else {
              await Product.findByIdAndUpdate(item.product, {
                $inc: { totalSales: item.quantity },
              });
              logger.info(`✅ Updated digital product: ${product.name}`);
            }
          }

          // ✅ Digital products are instantly accessible
          if (isDigitalOnly) {
            logger.info(`✅ Digital order payment verified - instant access granted: ${order.orderNumber}`);
          }

          // ✅ Shipment will be created when vendor updates order status
          logger.info('📦 Shipment will be created when vendor confirms/processes order');

          // Points credited on delivery — see completeOrder

          // Send confirmation email + receipt PDF
          const user = await User.findById(order.user);
          if (user) {
            try {
              const vendorNameMap = new Map<string, string>(
                (order.vendorShipments || []).map((s: any) => [s.vendor.toString(), s.vendorName])
              );
              const emailItems = order.items.map((item: any) => ({
                productName: item.productName,
                productImage: item.productImage,
                quantity: item.quantity,
                price: item.price,
                vendorName: vendorNameMap.get(item.vendor.toString()),
              }));
              let receiptPdf: Buffer | undefined;
              try {
                receiptPdf = await generateReceiptPDF({
                  orderNumber: order.orderNumber,
                  date: order.createdAt,
                  paymentMethod: order.paymentMethod,
                  paymentReference: order.paymentReference,
                  customer: { name: `${user.firstName} ${(user as any).lastName || ''}`.trim(), email: user.email },
                  deliveryAddress: order.shippingAddress as any,
                  items: order.items.map((item: any) => ({
                    productName: item.productName,
                    vendorName: vendorNameMap.get(item.vendor.toString()),
                    quantity: item.quantity,
                    price: item.price,
                  })),
                  subtotal: order.subtotal || 0,
                  discount: order.discount || 0,
                  shippingCost: order.shippingCost || 0,
                  serviceCharge: order.serviceCharge || 0,
                  total: order.total,
                });
              } catch (pdfErr: any) {
                logger.error('Receipt PDF generation failed:', pdfErr.message);
              }
              await sendOrderConfirmationEmail(user.email, order.orderNumber, order.total, user.firstName, emailItems, receiptPdf);
              logger.info('✅ Confirmation email sent');
            } catch (error) {
              logger.error('Error sending confirmation email:', error);
            }
          }

          logger.info('💳 ============================================');
          logger.info('💳 VERIFY PAYMENT COMPLETED');
          logger.info('💳 ============================================\n');

          res.json({
            success: true,
            message: 'Payment verified successfully',
            data: { 
              order,
              isDigital: isDigitalOnly,
            },
          });
        } else {
          logger.error('❌ Payment verification failed');
          
          order.paymentStatus = PaymentStatus.FAILED;
          order.status = OrderStatus.FAILED;
          await order.save();

          throw new AppError('Payment verification failed', 400);
        }
      } catch (error: any) {
        logger.error('❌ Payment verification error:', error.message);
        if (error instanceof AppError) throw error;
        throw new AppError('Failed to verify payment', 500);
      }
    }

    /**
     * Check if the current user has an active order involving a counterparty.
     * Customers check by vendor (items.vendor), vendors check by buyer (user).
     */
    async checkActiveOrderWith(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { counterpartyId } = req.params;
      const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
      const userId = req.user!.id;

      // Always check both directions — a vendor can also be a buyer
      const [asSeller, asBuyer] = await Promise.all([
        // counterparty placed an order with me as vendor
        Order.findOne({
          'items.vendor': userId,
          user: counterpartyId,
          status: { $in: ACTIVE_STATUSES },
        }).select('_id').lean(),
        // I placed an order with counterparty as vendor
        Order.findOne({
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
    async getActivePartners(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
      const userId = req.user!.id;

      // Always check both directions — a vendor can also be a buyer
      const [asSeller, asBuyer] = await Promise.all([
        // Orders where this user is a vendor → return buyer IDs
        Order.find({ 'items.vendor': userId, status: { $in: ACTIVE_STATUSES } })
          .select('user').lean(),
        // Orders where this user is the buyer → return vendor IDs
        Order.find({ user: userId, status: { $in: ACTIVE_STATUSES } })
          .select('items.vendor').lean(),
      ]);

      const sellerPartners = asSeller.map((o: any) => o.user.toString());
      const buyerPartners = asBuyer.flatMap((o: any) => o.items.map((i: any) => i.vendor.toString()));
      const partnerIds = [...new Set([...sellerPartners, ...buyerPartners])];

      res.json({ success: true, data: { partnerIds } });
    }

    /**
     * Return count of active orders for the current user (tab badge)
     * GET /orders/active-count
     */
    async getActiveOrderCount(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
      const userId = req.user!.id;
      const role = req.user!.role;

      // Vendors see their incoming orders; customers see their placed orders
      // A vendor who also shops uses the vendor count for the tab badge
      let count = 0;
      if (role === 'vendor') {
        count = await Order.countDocuments({
          'items.vendor': userId,
          status: { $in: ACTIVE_STATUSES },
        });
      } else {
        count = await Order.countDocuments({
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
    async getActiveOrdersWith(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { counterpartyId } = req.params;
      const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
      const userId = req.user!.id;

      // Always check both directions — a vendor can also be a buyer
      const [asSeller, asBuyer] = await Promise.all([
        // counterparty placed an order with me as vendor → show my items
        Order.find({
          'items.vendor': userId,
          user: counterpartyId,
          status: { $in: ACTIVE_STATUSES },
        }).select('orderNumber status items').lean(),
        // I placed an order with counterparty as vendor → show their items
        Order.find({
          user: userId,
          'items.vendor': counterpartyId,
          status: { $in: ACTIVE_STATUSES },
        }).select('orderNumber status items').lean(),
      ]);

      const formatAsSeller = (o: any) => {
        const myItems = o.items.filter((i: any) => i.vendor?.toString() === userId);
        return {
          _id: o._id,
          orderNumber: o.orderNumber,
          status: o.status,
          isSeller: true,
          items: myItems.map((i: any) => ({
            name: i.productName,
            image: i.productImage,
            quantity: i.quantity,
            price: i.price,
          })),
          vendorTotal: myItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0),
        };
      };

      const formatAsBuyer = (o: any) => {
        const theirItems = o.items.filter((i: any) => i.vendor?.toString() === counterpartyId);
        return {
          _id: o._id,
          orderNumber: o.orderNumber,
          status: o.status,
          isSeller: false,
          items: theirItems.map((i: any) => ({
            name: i.productName,
            image: i.productImage,
            quantity: i.quantity,
            price: i.price,
          })),
          vendorTotal: theirItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0),
        };
      };

      // Merge, dedup by _id (an order can't appear in both queries), sort newest first
      const seen = new Set<string>();
      const orders: any[] = [];
      for (const o of asSeller) {
        const id = o._id.toString();
        if (!seen.has(id)) { seen.add(id); orders.push(formatAsSeller(o)); }
      }
      for (const o of asBuyer) {
        const id = o._id.toString();
        if (!seen.has(id)) { seen.add(id); orders.push(formatAsBuyer(o)); }
      }

      res.json({ success: true, data: { orders } });
    }

    /**
     * Get user orders
     */
    async getUserOrders(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
      const skip = (page - 1) * limit;

      const filter: any = { user: req.user?.id };
      if (req.query.status) {
        filter.status = req.query.status;
      }

      const orders = await Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('items.product', 'name images');

      const total = await Order.countDocuments(filter);

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
    async getOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { id } = req.params;

      // Support lookup by either MongoDB _id or orderNumber (payment reference)
      const query = mongoose.isValidObjectId(id)
        ? { $or: [{ _id: id }, { orderNumber: id }], user: req.user?.id }
        : { orderNumber: id, user: req.user?.id };

      const order = await Order.findOne(query)
        .populate('items.product', 'name images slug productType digitalFile')
        .populate('items.vendor', 'firstName lastName email businessName businessLogo')
        .populate('vendorShipments.vendor', 'firstName lastName');

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      const totalCustomerOrders = await Order.countDocuments({ user: req.user?.id });

      res.json({
        success: true,
        data: { order: { ...order.toObject(), isFirstCustomerOrder: totalCustomerOrders === 1 } },
      });
    }

    /**
     * Get single order for vendor
     */
    async getVendorOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const order = await Order.findById(req.params.id)
        .populate('user', 'firstName lastName email phone')
        .populate('items.product', 'name images slug productType digitalFile')
        .populate('items.vendor', 'firstName lastName email')
        .populate('vendorShipments.vendor', 'firstName lastName');

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      const hasVendorItems = order.items.some(
        item => item.vendor && item.vendor.toString() === req.user?.id ||
                (typeof item.vendor === 'object' && (item.vendor as any)._id?.toString() === req.user?.id)
      );

      if (!hasVendorItems) {
        throw new AppError('Not authorized to view this order', 403);
      }

      const vendorItems = order.items.filter(
        item => item.vendor && (
          item.vendor.toString() === req.user?.id ||
          (typeof item.vendor === 'object' && (item.vendor as any)._id?.toString() === req.user?.id)
        )
      );

      const vendorShipment = (order as any).vendorShipments?.find(
        (shipment: any) => {
          const shipVendorId = typeof shipment.vendor === 'object' 
            ? shipment.vendor._id?.toString() 
            : shipment.vendor?.toString();
          return shipVendorId === req.user?.id;
        }
      );

      const [totalVendorOrders, vendorProfile] = await Promise.all([
        Order.countDocuments({ 'items.vendor': new mongoose.Types.ObjectId(req.user!.id) }),
        VendorProfile.findOne({ user: req.user!.id }).select('businessName businessLogo').lean(),
      ]);

      const orderData = {
        ...order.toObject(),
        items: vendorItems,
        vendorShipment: vendorShipment || null,
        isFirstVendorOrder: totalVendorOrders === 1,
        vendorStoreName: (vendorProfile as any)?.businessName || null,
        vendorStoreLogo: (vendorProfile as any)?.businessLogo || null,
      };

      res.json({
        success: true,
        data: { order: orderData },
      });
    }

    /**
     * Get user's digital products
     */
    async getUserDigitalProducts(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const orders = await Order.find({
        user: req.user?.id,
        paymentStatus: PaymentStatus.COMPLETED,
      })
        .populate('items.product')
        .sort({ createdAt: -1 });

      const digitalProducts = [];
      
      for (const order of orders) {
        for (let i = 0; i < order.items.length; i++) {
          const item = order.items[i];
          const product: any = item.product;
          if (!product) continue;
          
          const productType = product.productType?.toUpperCase();
          const isDigital = productType === 'DIGITAL' || productType === 'SERVICE';
          
          if (isDigital) {
            digitalProducts.push({
              orderId: order._id,
              orderNumber: order.orderNumber,
              itemId: (item as any)._id || `${order._id}-${i}`,
              product: {
                _id: product._id,
                name: product.name,
                slug: product.slug,
                image: product.images[0],
                productType: product.productType,
              },
              purchaseDate: (order as any).createdAt,
              downloadUrl: product.digitalFile?.url || product.downloadLink,
              fileSize: product.digitalFile?.fileSize,
              fileType: product.digitalFile?.fileType,
              version: product.digitalFile?.version,
            });
          }
        }
      }

      logger.info(`📦 Found ${digitalProducts.length} digital products for user ${req.user?.id}`);

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
    async downloadDigitalProduct(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { id: orderId, itemId } = req.params;

      const order = await Order.findOne({
        _id: orderId,
        user: req.user?.id,
        paymentStatus: PaymentStatus.COMPLETED,
      }).populate('items.product');

      if (!order) {
        throw new AppError('Order not found or payment not completed', 404);
      }

      let item: any = null;
      
      if (itemId.includes('-')) {
        const index = parseInt(itemId.split('-').pop() || '0');
        item = order.items[index];
      } else {
        item = order.items.find((i: any) => i._id?.toString() === itemId);
      }
      
      if (!item) {
        throw new AppError('Product not found in order', 404);
      }

      const product: any = item.product;
      if (!product) {
        throw new AppError('Product not found', 404);
      }

      const productType = product.productType?.toUpperCase();
      const isDigital = productType === 'DIGITAL' || productType === 'SERVICE';
      
      if (!isDigital) {
        throw new AppError('This product is not a digital product', 400);
      }

      const cloudinaryUrl: string = product.digitalFile?.url || product.downloadLink;

      if (!cloudinaryUrl) {
        throw new AppError('Download URL not available', 404);
      }

      logger.info(`📥 User ${req.user?.id} downloading product ${product.name} from order ${order.orderNumber}`);

      const ext = (product.digitalFile?.fileType || 'bin').toLowerCase();
      const safeName = (product.name as string)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);

      const MIME_MAP: Record<string, string> = {
        pdf: 'application/pdf',
        zip: 'application/zip',
        mp4: 'video/mp4',
        mp3: 'audio/mpeg',
        epub: 'application/epub+zip',
      };
      const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

      // Fetch from Cloudinary and pipe straight to the client — this avoids
      // any CDN access-control issues that arise when the mobile app hits
      // Cloudinary directly.
      const fileStream = await axios.get(cloudinaryUrl, {
        responseType: 'stream',
        validateStatus: (s) => s >= 200 && s < 400,
      });

      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${ext}"`);
      res.setHeader('Content-Type', contentType);
      if (product.digitalFile?.fileSize) {
        res.setHeader('Content-Length', String(product.digitalFile.fileSize));
      }

      fileStream.data.pipe(res);
    }

    /**
     * Track order shipment
     */
    async trackOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { id } = req.params;

      logger.info('📍 ============================================');
      logger.info('📍 TRACK ORDER REQUEST');
      logger.info('📍 ============================================');
      logger.info('📦 Order ID:', id);

      const order = await Order.findOne({
        _id: id,
        user: req.user?.id,
      }).populate('vendorShipments.vendor', 'firstName lastName');

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      logger.info('📦 Order found:', {
        orderNumber: order.orderNumber,
        status: order.status,
        hasVendorShipments: !!(order as any).vendorShipments?.length,
      });

      // ✅ Handle multi-vendor shipments
      if ((order as any).vendorShipments && (order as any).vendorShipments.length > 0) {
        logger.info(`📦 Multi-vendor order with ${(order as any).vendorShipments.length} shipment(s)`);
        
        const trackingData = await Promise.all(
          (order as any).vendorShipments.map(async (shipment: any) => {
            const trackingInfo = {
              vendor: shipment.vendorName,
              trackingNumber: shipment.trackingNumber,
              trackingUrl: shipment.trackingUrl,
              tracking: null as any,
              status: shipment.status,
              courier: shipment.courier,
            };

            if (!shipment.trackingNumber && !shipment.trackingUrl) {
              logger.warn(`⚠️ No tracking info for vendor ${shipment.vendorName}`);
              return trackingInfo;
            }

            if (shipment.trackingNumber) {
              try {
                logger.info(`🔍 Fetching tracking for ${shipment.trackingNumber}...`);
                const tracking = await shipBubbleService.trackShipment(shipment.trackingNumber);
                trackingInfo.tracking = tracking.data;
                logger.info(`✅ Tracking retrieved for ${shipment.trackingNumber}`);
              } catch (error) {
                logger.error(`❌ Error tracking shipment ${shipment.trackingNumber}:`, error);
              }
            }

            return trackingInfo;
          })
        );

        logger.info(`✅ Returning tracking data for ${trackingData.length} shipment(s)`);

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
      logger.info('📦 Single shipment order');

      if ((order as any).trackingUrl) {
        logger.info('✅ Tracking URL available:', (order as any).trackingUrl);
        
        res.json({
          success: true,
          data: {
            order,
            trackingUrl: (order as any).trackingUrl,
            tracking: null,
          },
        });
        return;
      }

      if (!order.trackingNumber) {
        logger.info('⚠️ No tracking information available yet');
        
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
        logger.info(`🔍 Fetching tracking for ${order.trackingNumber}...`);
        
        const tracking = await shipBubbleService.trackShipment(order.trackingNumber);

        logger.info('✅ Tracking retrieved successfully');

        res.json({
          success: true,
          data: {
            order,
            tracking: tracking.data,
          },
        });
      } catch (error) {
        logger.error('❌ Error tracking shipment:', error);
        
        res.json({
          success: true,
          message: 'Could not retrieve tracking information',
          data: {
            order,
            tracking: null,
            trackingUrl: (order as any).trackingUrl || null,
          },
        });
      }
    }

    /**
     * Cancel order
     */
    async cancelOrder(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { cancelReason } = req.body;

      // Atomically flip status to CANCELLED — prevents double-cancel from concurrent requests
      const order = await Order.findOneAndUpdate(
        {
          _id: req.params.id,
          user: req.user?.id,
          status: { $in: [OrderStatus.PENDING, OrderStatus.CONFIRMED] },
        },
        { $set: { status: OrderStatus.CANCELLED, cancelReason } },
        { new: true, populate: [{ path: 'items.product' }, { path: 'items.vendor' }] }
      );

      if (!order) {
        const existing = await Order.findOne({ _id: req.params.id, user: req.user?.id }).select('status');
        if (!existing) throw new AppError('Order not found', 404);
        throw new AppError('Order cannot be cancelled at this stage', 400);
      }

      // Cancel shipments — always mark status cancelled; only call ShipBubble if tracked
      if ((order as any).vendorShipments && (order as any).vendorShipments.length > 0) {
        for (const shipment of (order as any).vendorShipments) {
          shipment.status = 'cancelled';
          if (shipment.trackingNumber) {
            try {
              await shipBubbleService.cancelShipment(shipment.trackingNumber);
              logger.info(`ShipBubble shipment cancelled: ${shipment.trackingNumber}`);
            } catch (error) {
              logger.error(`Error cancelling ShipBubble shipment ${shipment.trackingNumber}:`, error);
            }
          }
        }
        await order.save();
      }

      if (order.trackingNumber) {
        try {
          await shipBubbleService.cancelShipment(order.trackingNumber);
          logger.info(`ShipBubble shipment cancelled: ${order.trackingNumber}`);
        } catch (error) {
          logger.error('Error cancelling ShipBubble shipment:', error);
        }
      }

      // Restore product quantities (physical products only)
      for (const item of order.items) {
        const product = await Product.findById(item.product);
        if (!product) continue;
        
        const productType = product.productType?.toUpperCase();
        const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
        
        if (isPhysical) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { 
              quantity: item.quantity,
              totalSales: -item.quantity,
            },
          });
        }
      }

      // Refund if payment completed
      if (order.paymentStatus === PaymentStatus.COMPLETED) {
        const refundAmount = Math.max(0, order.total);
        if (refundAmount > 0) {
          await Wallet.findOneAndUpdate(
            { user: req.user?.id },
            {
              $inc: { balance: refundAmount, totalEarned: refundAmount },
              $push: {
                transactions: {
                  type: TransactionType.CREDIT,
                  amount: refundAmount,
                  purpose: WalletPurpose.REFUND,
                  reference: `REF-${order.orderNumber}`,
                  description: `Refund for cancelled order ${order.orderNumber}`,
                  relatedOrder: order._id,
                  status: 'completed',
                  timestamp: new Date(),
                },
              },
            },
            { upsert: true }
          );
        }

        await Order.findByIdAndUpdate(order._id, {
          $set: { paymentStatus: PaymentStatus.REFUNDED, refundAmount, refundReason: cancelReason },
        });

        // Notify customer about refund
        try {
          await notificationService.refundIssued(req.user!.id, order.orderNumber, order.total);
        } catch (error) {
          logger.error('Error sending refund notification:', error);
        }

        // Email: refund + cancellation (with refund amount)
        try {
          const customerUser = await User.findById(req.user!.id).select('email firstName');
          if (customerUser) {
            enqueueEmail(EmailJobType.ORDER_CANCELLED, customerUser.email, customerUser.firstName, 0, {
              orderNumber: order.orderNumber,
              cancelReason,
              refundAmount,
            }).catch(() => {});
            enqueueEmail(EmailJobType.REFUND_PROCESSED, customerUser.email, customerUser.firstName, 0, {
              orderNumber: order.orderNumber,
              refundAmount,
            }).catch(() => {});
          }
        } catch (error) {
          logger.error('Error enqueueing cancellation/refund emails:', error);
        }
      } else {
        // Cancelled without refund — still email the customer
        try {
          const customerUser = await User.findById(req.user!.id).select('email firstName');
          if (customerUser) {
            enqueueEmail(EmailJobType.ORDER_CANCELLED, customerUser.email, customerUser.firstName, 0, {
              orderNumber: order.orderNumber,
              cancelReason,
            }).catch(() => {});
          }
        } catch (error) {
          logger.error('Error enqueueing cancellation email:', error);
        }
      }

      // Notify vendors about cancellation
      try {
        const vendorIds = [...new Set(order.items.map((item: any) => item.vendor.toString()))];
        await notificationService.orderCancelled(
          order._id.toString(),
          order.orderNumber,
          req.user!.id,
          vendorIds,
          'customer'
        );
      } catch (error) {
        logger.error('Error sending cancel notifications:', error);
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
    async cancelVendorShipment(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { cancelReason } = req.body;
      const { id: orderId, vendorId } = req.params;

      const order = await Order.findOne({ _id: orderId, user: req.user?.id });
      if (!order) throw new AppError('Order not found', 404);

      const shipments = (order as any).vendorShipments as IVendorShipment[];
      if (!shipments || shipments.length === 0) {
        throw new AppError('This order has no vendor shipments', 400);
      }

      const shipment = shipments.find(
        (s: any) => s.vendor.toString() === vendorId
      );
      if (!shipment) throw new AppError('Vendor shipment not found', 404);

      if (shipment.status === 'cancelled') {
        throw new AppError('This shipment is already cancelled', 400);
      }
      if (['shipped', 'in_transit', 'delivered'].includes(shipment.status)) {
        throw new AppError('This shipment cannot be cancelled — it has already been shipped', 400);
      }

      // Mark the shipment cancelled
      shipment.status = 'cancelled';

      // Cancel ShipBubble shipment if tracked
      if (shipment.trackingNumber) {
        try {
          await shipBubbleService.cancelShipment(shipment.trackingNumber);
          logger.info(`ShipBubble shipment cancelled: ${shipment.trackingNumber}`);
        } catch (error) {
          logger.error(`Error cancelling ShipBubble shipment ${shipment.trackingNumber}:`, error);
        }
      }

      // Restore stock for this vendor's items only
      const vendorItems = order.items.filter(
        (item: any) => item.vendor.toString() === vendorId
      );
      for (const item of vendorItems) {
        const product = await Product.findById(item.product);
        if (!product) continue;
        const productType = product.productType?.toUpperCase();
        const isPhysical = productType !== 'DIGITAL' && productType !== 'SERVICE';
        if (isPhysical) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { quantity: item.quantity, totalSales: -item.quantity },
          });
        }
      }

      // Calculate refund: vendor items subtotal + their shipping cost
      const vendorItemsTotal = vendorItems.reduce(
        (sum: number, item: any) => sum + item.price * item.quantity,
        0
      );
      const refundAmount = vendorItemsTotal + (shipment.shippingCost || 0);

      // If all shipments are now cancelled → cancel the whole order
      const allCancelled = shipments.every((s: any) => s.status === 'cancelled');
      if (allCancelled) {
        order.status = OrderStatus.CANCELLED;
        (order as any).cancelReason = cancelReason;
      }

      await order.save();

      // Refund if payment was completed
      if (order.paymentStatus === PaymentStatus.COMPLETED && refundAmount > 0) {
        await Wallet.findOneAndUpdate(
          { user: req.user?.id },
          {
            $inc: { balance: refundAmount, totalEarned: refundAmount },
            $push: {
              transactions: {
                type: TransactionType.CREDIT,
                amount: refundAmount,
                purpose: WalletPurpose.REFUND,
                reference: `REF-${order.orderNumber}-${vendorId.slice(-6)}`,
                description: `Refund for cancelled shipment from ${shipment.vendorName} on order ${order.orderNumber}`,
                relatedOrder: order._id,
                status: 'completed',
                timestamp: new Date(),
              },
            },
          },
          { upsert: true }
        );

        if (allCancelled) {
          order.paymentStatus = PaymentStatus.REFUNDED;
          (order as any).refundAmount = refundAmount;
        }
        (order as any).refundReason = cancelReason;
        await order.save();

        // Notify customer about refund
        try {
          await notificationService.refundIssued(req.user!.id, order.orderNumber, refundAmount);
        } catch (error) {
          logger.error('Error sending refund notification:', error);
        }
      }

      // Notify the specific vendor
      try {
        await notificationService.orderCancelled(
          order._id.toString(),
          order.orderNumber,
          req.user!.id,
          [vendorId],
          'customer'
        );
      } catch (error) {
        logger.error('Error sending cancel notification to vendor:', error);
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
    async getVendorOrders(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      const { status } = req.query;

      // Always fetch by vendor's items; status filter applied per-shipment below
      const query: any = { 'items.vendor': req.user?.id };

      const orders = await Order.find(query)
        .sort({ createdAt: -1 })
        .populate('user', 'firstName lastName email')
        .populate('items.product', 'name images');

      const mapped = orders.map(order => {
        const vendorItems = order.items.filter(
          item => item.vendor.toString() === req.user?.id
        );

        const vendorShipment = (order as any).vendorShipments?.find(
          (shipment: any) => shipment.vendor.toString() === req.user?.id
        );

        // Effective status: vendorShipment.status if present, else order.status
        // order.status=cancelled always wins for whole-order cancels
        const effectiveStatus = order.status === 'cancelled'
          ? 'cancelled'
          : (vendorShipment?.status || order.status);

        const vendorTotal = vendorItems.reduce(
          (sum: number, item: any) => sum + item.price * item.quantity, 0
        );
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
    async updateOrderStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { status } = req.body;

      logger.info('🔄 ============================================');
      logger.info('🔄 UPDATE ORDER STATUS STARTED');
      logger.info('🔄 ============================================');
      logger.info('📋 Status update request:', {
        orderId: req.params.id,
        newStatus: status,
        vendorId: req.user?.id,
      });

      const order = await Order.findById(req.params.id)
        .populate('user')
        .populate('items.product');
        
      if (!order) {
        throw new AppError('Order not found', 404);
      }

      logger.info('📦 Order found:', {
        orderNumber: order.orderNumber,
        currentStatus: order.status,
        isDigital: (order as any).isDigital,
        deliveryType: (order as any).deliveryType,
      });

      const hasVendorItems = order.items.some(
        item => item.vendor.toString() === req.user?.id
      );

      if (!hasVendorItems) {
        throw new AppError('Not authorized', 403);
      }

      logger.info('✅ Vendor has items in order');

      // Once ShipBubble has a tracking number, statuses beyond 'processing' are
      // driven by ShipBubble webhooks — block manual overrides to avoid conflicts
      const vendorShipmentForGuard = (order as any).vendorShipments?.find((s: any) => {
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

      // Guard: if the vendor's shipment is already at this status, do nothing —
      // UNLESS it's 'processing' with no tracking number yet (allows ShipBubble retry)
      const currentVendorStatus = vendorShipmentForGuard?.status || order.status;
      const isMissingShipment =
        status === 'processing' && !vendorShipmentForGuard?.trackingNumber;
      if (currentVendorStatus === status && !isMissingShipment) {
        res.json({
          success: true,
          message: 'Order is already at this status',
          data: { order },
        });
        return;
      }

      // Update status
      const oldStatus = order.status;
      const vendorShipmentsList = (order as any).vendorShipments as IVendorShipment[] | undefined;
      const isMultiVendor = vendorShipmentsList && vendorShipmentsList.length > 1;

      if (isMultiVendor) {
        // Update only this vendor's shipment entry (store the full order-status vocabulary)
        const thisVendorShipment = vendorShipmentsList.find((s: any) => {
          const vid = typeof s.vendor === 'object'
            ? (s.vendor._id?.toString() ?? s.vendor.toString())
            : s.vendor?.toString();
          return vid === req.user?.id;
        });

        if (thisVendorShipment) {
          thisVendorShipment.status = status as IVendorShipment['status'];
        }

        // Derive the overall order status from all vendor shipments.
        // Uses minimum-progress: the order only advances when ALL active vendors reach that stage.
        const allShipmentStatuses = vendorShipmentsList.map((s: any) => s.status as string);
        const activeStatuses = allShipmentStatuses.filter(s => s !== 'cancelled');

        if (allShipmentStatuses.every(s => s === 'cancelled')) {
          order.status = OrderStatus.CANCELLED;
        } else if (activeStatuses.every(s => s === 'delivered')) {
          // All active vendors delivered (also covers some-cancelled + rest-delivered)
          order.status = OrderStatus.DELIVERED;
        } else if (activeStatuses.every(s => ['in_transit', 'delivered'].includes(s))) {
          order.status = OrderStatus.IN_TRANSIT;
        } else if (activeStatuses.every(s => ['shipped', 'in_transit', 'delivered'].includes(s))) {
          order.status = OrderStatus.SHIPPED;
        } else if (activeStatuses.every(s => ['processing', 'shipped', 'in_transit', 'delivered'].includes(s))) {
          order.status = OrderStatus.PROCESSING;
        } else if (activeStatuses.every(s => ['confirmed', 'processing', 'shipped', 'in_transit', 'delivered'].includes(s))) {
          order.status = OrderStatus.CONFIRMED;
        } else {
          order.status = OrderStatus.PENDING;
        }
      } else {
        // Single-vendor order: update the order status directly
        order.status = status;
        // Keep the single vendorShipment entry in sync so the mobile app's
        // vendorStatus = shipment.status || order.status expression sees the new value
        if (vendorShipmentsList && vendorShipmentsList.length === 1) {
          (vendorShipmentsList[0] as any).status = status;
        }
      }

      await order.save();

      logger.info('✅ Order status updated:', {
        from: oldStatus,
        to: order.status,
        isMultiVendor,
      });

      // If vendor is cancelling — refund the customer for this vendor's items
      if (status === 'cancelled' && order.paymentStatus === PaymentStatus.COMPLETED) {
        try {
          const customerId = (order.user as any)._id
            ? (order.user as any)._id.toString()
            : order.user.toString();

          // Calculate refund: this vendor's items subtotal + their shipment's shipping cost
          const vendorItemsForRefund = order.items.filter(
            (item: any) => item.vendor.toString() === req.user?.id
          );
          const itemsTotal = vendorItemsForRefund.reduce(
            (sum: number, item: any) => sum + item.price * item.quantity, 0
          );
          const shipmentCost = vendorShipmentForGuard?.shippingCost || 0;
          const refundAmount = itemsTotal + shipmentCost;

          if (refundAmount > 0) {
            await Wallet.findOneAndUpdate(
              { user: customerId },
              {
                $inc: { balance: refundAmount, totalEarned: refundAmount },
                $push: {
                  transactions: {
                    type: TransactionType.CREDIT,
                    amount: refundAmount,
                    purpose: WalletPurpose.REFUND,
                    reference: `REF-${order.orderNumber}-${(req.user!.id as string).slice(-6)}`,
                    description: `Refund for vendor cancellation on order ${order.orderNumber}`,
                    relatedOrder: order._id,
                    status: 'completed',
                    timestamp: new Date(),
                  },
                },
              },
              { upsert: true }
            );
            logger.info(`✅ Refund of ₦${refundAmount} issued to customer ${customerId}`);

            // Notify customer about the refund
            await notificationService.refundIssued(customerId, order.orderNumber, refundAmount);
          }
        } catch (refundError: any) {
          logger.error('❌ Failed to process vendor-cancel refund:', refundError.message);
        }
      }

      // Notify customer about status change + push real-time socket event
      try {
        const customerId = (order.user as any)._id
          ? (order.user as any)._id.toString()
          : order.user.toString();
        await notificationService.orderStatusUpdated(
          order._id.toString(),
          order.orderNumber,
          status,
          customerId
        );

        const vendorIds = (order as any).vendorShipments
          ?.map((s: any) => (typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString()))
          .filter(Boolean) ?? [];

        emitOrderStatusUpdate({
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          status: order.status,
          customerId,
          vendorIds,
        });

        // Transactional emails based on new order status
        const customerUser = order.user as any;
        if (customerUser?.email) {
          if (order.status === OrderStatus.SHIPPED || order.status === OrderStatus.IN_TRANSIT) {
            const shipment = (order as any).vendorShipments?.find((s: any) => {
              const vid = typeof s.vendor === 'object' ? s.vendor._id?.toString() : s.vendor?.toString();
              return vid === req.user?.id;
            });
            enqueueEmail(EmailJobType.ORDER_SHIPPED, customerUser.email, customerUser.firstName, 0, {
              orderNumber: order.orderNumber,
              courier: shipment?.courier,
              trackingNumber: shipment?.trackingNumber,
              trackingUrl: shipment?.trackingUrl,
              estimatedDelivery: shipment?.estimatedDelivery
                ? new Date(shipment.estimatedDelivery).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
                : undefined,
            }).catch(() => {});
          } else if (order.status === OrderStatus.DELIVERED) {
            enqueueEmail(EmailJobType.ORDER_DELIVERED, customerUser.email, customerUser.firstName, 0, {
              orderNumber: order.orderNumber,
            }).catch(() => {});
            // Review request after 24 hours
            enqueueEmail(EmailJobType.REVIEW_REQUEST, customerUser.email, customerUser.firstName, 24 * 60 * 60 * 1000, {
              orderNumber: order.orderNumber,
            }).catch(() => {});
          }
        }
      } catch (error) {
        logger.error('Error sending status update notification:', error);
      }

      // ✅ Create shipment when vendor confirms/processes (only for physical products)
      const vendorShipment = (order as any).vendorShipments?.find(
        (shipment: any) => {
          const shipVendorId = typeof shipment.vendor === 'object' 
            ? shipment.vendor._id?.toString() 
            : shipment.vendor?.toString();
          return shipVendorId === req.user?.id;
        }
      );
      
      const shouldCreateShipment =
        status === 'processing' &&
        !(order as any).isDigital &&
        (order as any).deliveryType !== 'pickup' &&
        (!vendorShipment?.trackingNumber);
      
      if (shouldCreateShipment) {
        logger.info('🚚 Status change triggers shipment creation');
        logger.info('📋 Conditions met:', {
          newStatus: status,
          isDigital: (order as any).isDigital,
          deliveryType: (order as any).deliveryType,
          oldStatus,
          hasExistingTracking: !!vendorShipment?.trackingNumber,
        });

        const user = order.user as any;
        
        try {
          logger.info('📦 Building vendor groups from order items...');
          
          const vendorItems = order.items.filter(
            (item: any) => item.vendor.toString() === req.user?.id
          );
          
          if (vendorItems.length === 0) {
            logger.warn('⚠️ No items found for this vendor in order');
            return;
          }
          
          logger.info(`✅ Found ${vendorItems.length} items for vendor`);
          
          const vendorProfile = await VendorProfile.findOne({ user: req.user?.id });
          const vendor = await User.findById(req.user?.id);
          
          if (!vendor) {
            logger.error('❌ Vendor user not found');
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
          
          const vendorGroup: VendorGroup = {
            vendorId: req.user?.id,
            vendorName,
            vendorAddress,
            // Restore the product-level pickup address that was captured at checkout
            pickupAddress: vendorShipment?.origin ? {
              street: vendorShipment.origin.street || '',
              city: vendorShipment.origin.city,
              state: vendorShipment.origin.state,
              country: vendorShipment.origin.country,
            } : undefined,
            items: vendorItems.map((item: any) => {
              const product = item.product as any;
              const productType = product?.productType?.toUpperCase() || item.productType?.toUpperCase();
              const isPhysical = 
                productType === 'PHYSICAL' || 
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
          
          logger.info('✅ Vendor group built:', {
            vendorId: vendorGroup.vendorId,
            vendorName: vendorGroup.vendorName,
            itemCount: vendorGroup.items.length,
            physicalItems: vendorGroup.items.filter(i => i.isPhysical).length,
            totalWeight: vendorGroup.totalWeight,
          });
          
          await this.createVendorShipments(
            order, 
            user, 
            [vendorGroup],
            (order as any).deliveryType || 'standard'
          );
          
          logger.info('✅ Shipment creation completed');
          
        } catch (error: any) {
          logger.error('❌ Error creating shipment on status update:', {
            error: error.message,
            stack: error.stack,
          });
        }
      } else {
        const skipReason = (order as any).isDigital 
          ? 'Digital order' 
          : (order as any).deliveryType === 'pickup'
          ? 'Pickup delivery'
          : vendorShipment?.trackingNumber
          ? 'Tracking number already exists'
          : 'Status not confirmed/processing/shipped';
          
        logger.info('⏭️ Shipment creation not triggered:', {
          reason: skipReason,
          currentStatus: status,
          hasTracking: !!vendorShipment?.trackingNumber,
        });
      }

      logger.info('🔄 ============================================');
      logger.info('🔄 UPDATE ORDER STATUS COMPLETED');
      logger.info('🔄 ============================================\n');

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
    async completeOrder(req: AuthRequest, res: Response) {
      const { id } = req.params;
      const userId = req.user!.id;

      // Atomic: set fundsReleased=true in one operation — prevents double vendor payout
      // from concurrent customer clicks OR race with the 24-hour auto-complete job
      const order = await Order.findOneAndUpdate(
        {
          _id: id,
          user: userId,
          fundsReleased: { $ne: true },
          status: { $in: [OrderStatus.SHIPPED, OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED] },
          paymentStatus: PaymentStatus.COMPLETED,
        },
        {
          status: OrderStatus.DELIVERED,
          fundsReleased: true,
          $set: { deliveredAt: new Date() },
        },
        { new: true }
      );

      if (!order) {
        const existing = await Order.findById(id);
        if (!existing) throw new AppError('Order not found', 404);
        if (existing.user.toString() !== userId) throw new AppError('You are not authorized to complete this order', 403);
        if ((existing as any).fundsReleased) {
          res.json({ success: true, message: 'Order already completed', data: { order: existing } });
          return;
        }
        if (existing.paymentStatus !== PaymentStatus.COMPLETED) throw new AppError('Payment not completed', 400);
        throw new AppError(`Order cannot be completed from status "${existing.status}". Must be shipped or further.`, 400);
      }

      // Credit vendor wallets with their earnings
      try {
        // Group items by vendor and calculate each vendor's total
        const vendorEarnings = new Map<string, number>();
        for (const item of order.items) {
          const vendorId = item.vendor.toString();
          const itemTotal = item.price * item.quantity;
          vendorEarnings.set(vendorId, (vendorEarnings.get(vendorId) || 0) + itemTotal);
        }

        // Build per-vendor affiliate deduction map — vendor absorbs affiliate commission, not platform
        const affiliateVendorDeductions = new Map<string, number>();
        if (order.affiliateUser && order.affiliateCommission && order.affiliateLinkId) {
          try {
            const linkDoc = await AffiliateLink.findById(order.affiliateLinkId).select('product').lean() as any;
            if (linkDoc?.product) {
              // Product-specific link: only the vendor of that product bears the cost
              const affItem = order.items.find((item: any) => item.product.toString() === linkDoc.product.toString());
              if (affItem) {
                affiliateVendorDeductions.set(affItem.vendor.toString(), order.affiliateCommission);
              }
            } else {
              // General link: distribute proportionally by each vendor's subtotal share
              const totalSubtotal = [...vendorEarnings.values()].reduce((s, v) => s + v, 0);
              for (const [vid, sub] of vendorEarnings) {
                const deduction = Math.round((sub / totalSubtotal) * order.affiliateCommission * 100) / 100;
                if (deduction > 0) affiliateVendorDeductions.set(vid, deduction);
              }
            }
          } catch (e) {
            logger.error('Error computing affiliate vendor deductions:', e);
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
          await Wallet.findOneAndUpdate(
            { user: vendorId },
            {
              $inc: { balance: vendorAmount, totalEarned: vendorAmount },
              $push: {
                transactions: {
                  type: TransactionType.CREDIT,
                  amount: vendorAmount,
                  purpose: WalletPurpose.COMMISSION,
                  reference: `order_${order.orderNumber}_${vendorId}`,
                  description: `Payment for Order #${order.orderNumber} (${Math.round(commissionRate * 100)}% platform fee${affiliateDeduction > 0 ? `, ₦${affiliateDeduction} affiliate commission` : ''} deducted)`,
                  relatedOrder: order._id,
                  status: 'completed',
                  timestamp: new Date(),
                },
              },
            },
            { upsert: true }
          );
          logger.info(`Credited ₦${vendorAmount} to vendor ${vendorId} for order ${order.orderNumber} (commission: ₦${commission} at ${Math.round(commissionRate * 100)}%, original: ₦${amount})`);

          // Notify vendor their funds have been released
          notificationService.vendorSaleCompleted(vendorId, order.orderNumber, amount, vendorAmount).catch(() => {});
        }

        // Handle affiliate commission — atomic guard prevents double-credit
        if (order.affiliateUser && order.affiliateCommission) {
          const claimed = await Order.findOneAndUpdate(
            { _id: order._id, affiliateCommissionPaid: { $ne: true } },
            { $set: { affiliateCommissionPaid: true } }
          );
          if (claimed) {
            const commissionAmount = order.affiliateCommission;
            await Wallet.findOneAndUpdate(
              { user: order.affiliateUser },
              {
                $inc: { balance: commissionAmount, totalEarned: commissionAmount },
                $push: {
                  transactions: {
                    type: TransactionType.CREDIT,
                    amount: commissionAmount,
                    purpose: WalletPurpose.COMMISSION,
                    reference: `affiliate_${order.orderNumber}`,
                    description: `Affiliate commission for Order #${order.orderNumber}`,
                    relatedOrder: order._id,
                    status: 'completed',
                    timestamp: new Date(),
                  },
                },
              },
              { upsert: true }
            );
            if (order.affiliateLinkId) {
              await AffiliateLink.findByIdAndUpdate(order.affiliateLinkId, {
                $inc: { conversions: 1, totalEarned: commissionAmount },
              });
            }
            logger.info(`Credited ₦${commissionAmount} affiliate commission for order ${order.orderNumber}`);
          }
        }
      } catch (walletError) {
        logger.error(`Error crediting vendor wallets for order ${order.orderNumber}:`, walletError);
      }

      // Award points on delivery
      try {
        const { rewardController } = await import('./reward.controller');
        await rewardController.awardOrderPoints(order._id.toString());
        await rewardController.awardCustomerReferralPoints(order.user.toString(), order._id.toString());
        logger.info(`✅ Points awarded on delivery for order ${order.orderNumber}`);

        // Unlock vendor referral points if any vendor is making their first sale
        const uniqueVendorIds = [...new Set(order.items.map((item: any) => item.vendor.toString()))];
        for (const vendorId of uniqueVendorIds) {
          // Atomic: only unlock if referralRewarded is not already true
          const claimed = await VendorProfile.findOneAndUpdate(
            { user: vendorId, referredBy: { $exists: true }, referralRewarded: { $ne: true } },
            { $set: { referralRewarded: true } }
          );
          if (claimed) {
            await rewardController.unlockVendorReferralPoints(vendorId);
            logger.info(`✅ Vendor referral unlocked for vendor ${vendorId}`);
          }
          // Ambassador 60% commission — fire regardless of referralRewarded flag (separate system)
          import('./ambassador.controller').then(({ handleVendorFirstSale }) => {
            handleVendorFirstSale(vendorId);
          }).catch(() => {});
        }

        // Ambassador customer commission (3% on first 3 completed orders)
        import('./ambassador.controller').then(({ handleCustomerOrderCompleted }) => {
          handleCustomerOrderCompleted(order.user.toString(), order._id.toString(), order.total);
        }).catch(() => {});
      } catch (error) {
        logger.error('Error awarding points on delivery:', error);
      }

      // Deactivate conversation for each vendor in this order — only if no other active order exists
      try {
        const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
        const vendorIds = [...new Set(order.items.map((item: any) => item.vendor.toString()))];
        for (const vendorId of vendorIds) {
          const otherActive = await Order.findOne({
            _id: { $ne: order._id },
            user: userId,
            'items.vendor': vendorId,
            status: { $in: ACTIVE_STATUSES },
          }).select('_id').lean();
          if (!otherActive) {
            await Conversation.updateMany(
              { participants: { $all: [userId, vendorId] } },
              { isActive: false }
            );
          }
        }
      } catch (convErr) {
        logger.error('Error deactivating conversations on order complete:', convErr);
      }

      logger.info(`Order ${order.orderNumber} completed by customer ${userId}`);

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
    async completeVendorShipment(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
      const { id, vendorId } = req.params;
      const userId = req.user!.id;

      const order = await Order.findById(id);
      if (!order) throw new AppError('Order not found', 404);
      if (order.user.toString() !== userId) throw new AppError('Not authorized', 403);
      if (order.status === OrderStatus.CANCELLED) throw new AppError('Order is cancelled', 400);
      if (order.paymentStatus !== PaymentStatus.COMPLETED) throw new AppError('Payment not completed', 400);

      const shipments = (order as any).vendorShipments as IVendorShipment[];
      if (!shipments || shipments.length === 0) throw new AppError('No vendor shipments found', 400);

      const shipment = shipments.find((s: any) => {
        const svId = typeof s.vendor === 'object' ? (s.vendor as any)._id?.toString() : s.vendor?.toString();
        return svId === vendorId;
      }) as any;

      if (!shipment) throw new AppError('Vendor shipment not found in this order', 404);
      if (shipment.paidAt) throw new AppError('This shipment has already been received and payment released', 400);

      shipment.status = 'delivered';
      (shipment as any).paidAt = new Date();

      // Credit this vendor's wallet
      const vendorItems = order.items.filter((item: any) => {
        const iVendorId = typeof item.vendor === 'object' ? (item.vendor as any)._id?.toString() : item.vendor?.toString();
        return iVendorId === vendorId;
      });
      const vendorSubtotal = vendorItems.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);

      try {
        const vendorProfile = await VendorProfile.findOne({ user: vendorId }).select('commissionRate');
        const commissionRate = (vendorProfile?.commissionRate ?? 8) / 100;
        const commission = Math.round(vendorSubtotal * commissionRate * 100) / 100;

        // Determine this vendor's affiliate deduction — vendor absorbs it, not platform
        let affiliateDeduction = 0;
        if (order.affiliateUser && order.affiliateCommission && order.affiliateLinkId) {
          try {
            const linkDoc = await AffiliateLink.findById(order.affiliateLinkId).select('product').lean() as any;
            if (linkDoc?.product) {
              // Product-specific: only this vendor pays if they own the affiliated product
              const affItem = vendorItems.find((item: any) => item.product.toString() === linkDoc.product.toString());
              if (affItem) affiliateDeduction = order.affiliateCommission;
            } else {
              // General link: this vendor's proportional share of the order subtotal
              const orderSubtotal = order.items.reduce((s: number, item: any) => s + item.price * item.quantity, 0);
              affiliateDeduction = orderSubtotal > 0
                ? Math.round((vendorSubtotal / orderSubtotal) * order.affiliateCommission * 100) / 100
                : 0;
            }
          } catch (e) {
            logger.error('Error computing affiliate deduction for vendor shipment:', e);
          }
        }

        const vendorAmount = Math.max(0, Math.round((vendorSubtotal - commission - affiliateDeduction) * 100) / 100);

        await Wallet.findOneAndUpdate(
          { user: vendorId },
          {
            $inc: { balance: vendorAmount, totalEarned: vendorAmount },
            $push: {
              transactions: {
                type: TransactionType.CREDIT,
                amount: vendorAmount,
                purpose: WalletPurpose.COMMISSION,
                reference: `order_${order.orderNumber}_vendor_${vendorId}`,
                description: `Payment for Order #${order.orderNumber} (${Math.round(commissionRate * 100)}% platform fee${affiliateDeduction > 0 ? `, ₦${affiliateDeduction} affiliate commission` : ''} deducted)`,
                relatedOrder: order._id,
                status: 'completed',
                timestamp: new Date(),
              },
            },
          },
          { upsert: true }
        );
        logger.info(`Credited ₦${vendorAmount} to vendor ${vendorId} for shipment in order ${order.orderNumber}${affiliateDeduction > 0 ? ` (₦${affiliateDeduction} affiliate deducted)` : ''}`);

        // Notify vendor their funds have been released
        notificationService.vendorSaleCompleted(vendorId, order.orderNumber, vendorSubtotal, vendorAmount).catch(() => {});
      } catch (walletError) {
        logger.error('Error crediting vendor wallet on vendor shipment completion:', walletError);
      }

      // Check if all vendor shipments are now delivered
      const allDelivered = shipments.every((s: any) => s.status === 'delivered' || s.status === 'cancelled');
      if (allDelivered) {
        order.status = OrderStatus.DELIVERED;
        (order as any).deliveredAt = (order as any).deliveredAt || new Date();
        (order as any).fundsReleased = true;

        // Award points now that all shipments are confirmed received
        try {
          const { rewardController } = await import('./reward.controller');
          await rewardController.awardOrderPoints(order._id.toString());
          await rewardController.awardCustomerReferralPoints(order.user.toString(), order._id.toString());
          logger.info(`✅ Points awarded on full shipment receipt for order ${order.orderNumber}`);

          // Unlock vendor referral points for first-sale vendors
          const uniqueVendorIds = [...new Set(order.items.map((item: any) => item.vendor.toString()))];
          for (const vId of uniqueVendorIds) {
            // Atomic: only unlock if referralRewarded is not already true
            const vClaimed = await VendorProfile.findOneAndUpdate(
              { user: vId, referredBy: { $exists: true }, referralRewarded: { $ne: true } },
              { $set: { referralRewarded: true } }
            );
            if (vClaimed) await rewardController.unlockVendorReferralPoints(vId);
            // Ambassador 60% commission
            import('./ambassador.controller').then(({ handleVendorFirstSale }) => {
              handleVendorFirstSale(vId);
            }).catch(() => {});
          }

          // Ambassador customer commission (3% on first 3 completed orders)
          import('./ambassador.controller').then(({ handleCustomerOrderCompleted }) => {
            handleCustomerOrderCompleted(order.user.toString(), order._id.toString(), order.total);
          }).catch(() => {});
        } catch (pointsError) {
          logger.error('Error awarding points on full shipment receipt:', pointsError);
        }

        // Handle affiliate commission — atomic guard prevents double-credit across completeOrder and completeVendorShipment
        if (order.affiliateUser && order.affiliateCommission) {
          try {
            const claimed = await Order.findOneAndUpdate(
              { _id: order._id, affiliateCommissionPaid: { $ne: true } },
              { $set: { affiliateCommissionPaid: true } }
            );
            if (claimed) {
              const commissionAmount = order.affiliateCommission;
              await Wallet.findOneAndUpdate(
                { user: order.affiliateUser },
                {
                  $inc: { balance: commissionAmount, totalEarned: commissionAmount },
                  $push: {
                    transactions: {
                      type: TransactionType.CREDIT,
                      amount: commissionAmount,
                      purpose: WalletPurpose.COMMISSION,
                      reference: `affiliate_${order.orderNumber}`,
                      description: `Affiliate commission for Order #${order.orderNumber}`,
                      relatedOrder: order._id,
                      status: 'completed',
                      timestamp: new Date(),
                    },
                  },
                },
                { upsert: true }
              );
              if (order.affiliateLinkId) {
                await AffiliateLink.findByIdAndUpdate(order.affiliateLinkId, {
                  $inc: { conversions: 1, totalEarned: commissionAmount },
                });
              }
              logger.info(`Credited ₦${commissionAmount} affiliate commission for order ${order.orderNumber}`);
            }
          } catch (affiliateErr) {
            logger.error('Error crediting affiliate commission on full delivery:', affiliateErr);
          }
        }

        // Deactivate conversation — only if no other active order exists with each vendor
        try {
          const ACTIVE_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit'];
          const uniqueVendorIds = [...new Set(order.items.map((item: any) => item.vendor.toString()))];
          for (const vId of uniqueVendorIds) {
            const otherActive = await Order.findOne({
              _id: { $ne: order._id },
              user: userId,
              'items.vendor': vId,
              status: { $in: ACTIVE_STATUSES },
            }).select('_id').lean();
            if (!otherActive) {
              await Conversation.updateMany(
                { participants: { $all: [userId, vId] } },
                { isActive: false }
              );
            }
          }
        } catch (convErr) {
          logger.error('Error deactivating conversations on full delivery:', convErr);
        }
      }

      await order.save();

      // Notify the vendor that their shipment was received
      try {
        await notificationService.orderStatusUpdated(
          order._id.toString(),
          order.orderNumber,
          allDelivered ? 'delivered' : 'shipment_received',
          vendorId
        );
      } catch (notifErr) {
        logger.error('Error sending shipment received notification:', notifErr);
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
    private getDefaultRate(deliveryType: string): number {
      const defaultRates: { [key: string]: number } = {
        standard: 2500,
        express: 5000,
        same_day: 8000,
      };
      return defaultRates[deliveryType] || 2500;
    }

    private getDefaultEstimate(deliveryType: string): string {
      const defaultEstimates: { [key: string]: string } = {
        standard: '5-7 days',
        express: '2-3 days',
        same_day: 'Same day',
      };
      return defaultEstimates[deliveryType] || '5-7 days';
    }

    private getDefaultDescription(deliveryType: string): string {
      const descriptions: { [key: string]: string } = {
        standard: 'Delivery within 5-7 business days',
        express: 'Delivery within 2-3 business days',
        same_day: 'Delivery within 24 hours',
      };
      return descriptions[deliveryType] || 'Standard delivery';
    }

    private getVendorFallbackRates(): any[] {
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

    private getFallbackRates(): DeliveryRateResponse[] {
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

  /**
   * Admin retry: re-trigger ShipBubble label creation for all stuck
   * vendorShipments (no trackingNumber) on a given order.
   */
  async adminRetryShipment(orderId: string, force = false): Promise<{ retried: number }> {
    const order = await Order.findById(orderId)
      .populate('user')
      .populate('items.product');

    if (!order) throw new AppError('Order not found', 404);

    const allShipments = (order as any).vendorShipments || [];

    // force=true: retry even when tracking exists (e.g. stale test-mode labels)
    const stuckShipments = force
      ? allShipments.filter((vs: any) => vs.status !== 'delivered' && vs.status !== 'cancelled')
      : allShipments.filter((vs: any) => !vs.trackingNumber);

    if (stuckShipments.length === 0) {
      throw new AppError(
        force
          ? 'No eligible vendor shipments to retry'
          : 'All shipments already have tracking numbers — use force retry to override',
        400
      );
    }

    // When forcing, clear the old (possibly test-mode) tracking data so a fresh label is created
    if (force) {
      for (const vs of stuckShipments) {
        vs.trackingNumber = undefined;
        vs.trackingUrl = undefined;
      }
      await order.save();
      logger.info(`[AdminRetry] Cleared tracking data for ${stuckShipments.length} shipment(s) on order ${orderId} (force retry)`);
    }

    const vendorGroups: VendorGroup[] = [];

    for (const vs of stuckShipments) {
      const vendorId =
        typeof vs.vendor === 'object'
          ? vs.vendor._id?.toString()
          : vs.vendor?.toString();

      const [vendorProfile, vendor] = await Promise.all([
        VendorProfile.findOne({ user: vendorId }),
        User.findById(vendorId),
      ]);

      if (!vendor) continue;

      const vendorItems = order.items.filter(
        (item: any) => item.vendor.toString() === vendorId
      );

      const vendorAddress = vendorProfile?.businessAddress
        ? {
            street: vendorProfile.businessAddress.street || '',
            city: vendorProfile.businessAddress.city,
            state: vendorProfile.businessAddress.state,
            country: vendorProfile.businessAddress.country,
          }
        : {
            street: '',
            city: process.env.SHIPBUBBLE_SENDER_CITY || '',
            state: process.env.SHIPBUBBLE_SENDER_STATE || '',
            country: process.env.SHIPBUBBLE_SENDER_COUNTRY || 'Nigeria',
          };

      const group: VendorGroup = {
        vendorId,
        // Always prefer the current DB value so stale order snapshots don't win
        vendorName:
          vendorProfile?.businessName ||
          vs.vendorName ||
          `${vendor.firstName} ${vendor.lastName}`,
        vendorAddress,
        // Restore the pickup address that was captured at checkout
        pickupAddress: vs.origin?.street
          ? {
              street: vs.origin.street,
              city: vs.origin.city,
              state: vs.origin.state,
              country: vs.origin.country,
            }
          : undefined,
        items: vendorItems.map((item: any) => {
          const product = item.product as any;
          const productType =
            product?.productType?.toUpperCase() ||
            item.productType?.toUpperCase();
          const isPhysical =
            productType === 'PHYSICAL' ||
            (!productType ||
              (productType !== 'DIGITAL' && productType !== 'SERVICE'));
          return {
            productId: product?._id?.toString() || item.product.toString(),
            productName: item.productName,
            quantity: item.quantity,
            weight: product?.weight || 0.5,
            isPhysical,
            price: item.price,
            category: product?.category,
          };
        }),
        totalWeight: 0,
      };

      group.totalWeight = group.items
        .filter((i) => i.isPhysical)
        .reduce((sum, i) => sum + i.weight * i.quantity, 0);

      vendorGroups.push(group);
    }

    if (vendorGroups.length === 0) {
      throw new AppError('Could not build vendor groups — vendor data missing', 400);
    }

    // Reset order and stuck vendorShipment statuses back to 'processing'
    // so ShipBubble webhooks can drive the correct sequence after label creation
    order.status = 'processing' as any;
    for (const vs of stuckShipments) {
      vs.status = 'processing';
    }
    await order.save();

    await this.createVendorShipments(
      order,
      order.user as any,
      vendorGroups,
      (order as any).deliveryType || 'standard'
    );

    return { retried: vendorGroups.length };
  }

  async downloadReceipt(req: AuthRequest, res: Response): Promise<void> {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate('user', 'firstName lastName email')
      .lean();

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const userId  = req.user!.id;
    const isAdmin = [UserRole.ADMIN as string, UserRole.SUPER_ADMIN as string].includes(req.user!.role);

    if (!isAdmin) {
      const isCustomer = (order as any).user?._id?.toString() === userId;
      const isVendor   = ((order as any).items || []).some(
        (item: any) => (item.vendor?._id || item.vendor)?.toString() === userId,
      );
      if (!isCustomer && !isVendor) {
        res.status(403).json({ success: false, message: 'Not authorized to access this receipt' });
        return;
      }
    }

    const user           = (order as any).user;
    const vendorNameMap  = new Map<string, string>(
      ((order as any).vendorShipments || []).map((s: any) => [s.vendor.toString(), s.vendorName]),
    );

    const pdfBuffer = await generateReceiptPDF({
      orderNumber:      (order as any).orderNumber,
      date:             (order as any).createdAt,
      paymentMethod:    (order as any).paymentMethod,
      paymentReference: (order as any).paymentReference,
      customer: {
        name:  `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Customer',
        email: user?.email || '',
      },
      deliveryAddress: (order as any).shippingAddress,
      items: ((order as any).items || []).map((item: any) => ({
        productName: item.productName,
        vendorName:  vendorNameMap.get((item.vendor?._id || item.vendor)?.toString()),
        quantity:    item.quantity,
        price:       item.price,
      })),
      subtotal:      (order as any).subtotal      || 0,
      discount:      (order as any).discount      || 0,
      shippingCost:  (order as any).shippingCost  || 0,
      serviceCharge: (order as any).serviceCharge || 0,
      total:         (order as any).total         || 0,
    });

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Vendorspot-Receipt-${(order as any).orderNumber}.pdf"`);
    res.setHeader('Content-Length',      pdfBuffer.length);
    res.send(pdfBuffer);
  }

  } // end OrderController

  export const orderController = new OrderController();