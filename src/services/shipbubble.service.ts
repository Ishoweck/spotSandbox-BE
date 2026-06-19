// services/shipbubble.service.ts
// ✅ FIXED: Removed hardcoded service_type: 'pickup' to get ALL courier options
import axios from 'axios';
import { logger } from '../utils/logger';

const SHIPBUBBLE_API_KEY = process.env.SHIPBUBBLE_API_KEY || '';
const SHIPBUBBLE_BASE_URL = process.env.SHIPBUBBLE_BASE_URL || 'https://api.shipbubble.com/v1';

interface ShipBubbleAddress {
  name: string;
  phone: string;
  email: string;
  address: string;
  latitude?: number;
  longitude?: number;
}

interface ValidatedAddress {
  address_code: number;
  formatted_address: string;
  city: string;
  state: string;
  country: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
}

interface PackageItem {
  name: string;
  description: string;
  unit_weight: string; // in KG
  unit_amount: string; // price
  quantity: string;
}

interface FetchRatesRequest {
  sender_address_code: number;
  reciever_address_code: number; // Note: ShipBubble uses 'reciever' (their spelling)
  pickup_date: string; // format: "yyyy-mm-dd"
  category_id: number;
  package_items: PackageItem[];
  package_dimension: {
    length: number;
    width: number;
    height: number;
  };
  service_type?: 'pickup' | 'dropoff';
  delivery_instructions?: string;
}

export class ShipBubbleService {
  private headers = {
    Authorization: `Bearer ${SHIPBUBBLE_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // Cache for address codes to avoid duplicate API calls
  private addressCache = new Map<string, number>();

  constructor() {
    this.validateConfig();
  }

  private validateConfig() {
    logger.info('🔍 Validating ShipBubble configuration...');
    
    if (!SHIPBUBBLE_API_KEY) {
      logger.error('❌ SHIPBUBBLE_API_KEY is not set!');
    } else {
      logger.info('✅ ShipBubble API Key is set');
    }
  }

  /**
   * Generate cache key for an address
   */
  private getAddressCacheKey(address: ShipBubbleAddress): string {
    return `${address.email}-${address.phone}-${address.address}`;
  }

  /**
   * Validate and get address code
   */
  async validateAddress(address: ShipBubbleAddress): Promise<ValidatedAddress> {
    try {
      // Check cache first
      const cacheKey = this.getAddressCacheKey(address);
      const cachedCode = this.addressCache.get(cacheKey);
      
      if (cachedCode) {
        logger.info('✅ Using cached address code:', cachedCode);
        return {
          address_code: cachedCode,
          formatted_address: address.address,
          city: '',
          state: '',
          country: 'Nigeria',
        };
      }

      logger.info('📍 Validating ShipBubble address:', {
        name: address.name,
        address: address.address,
      });

      // Log the exact payload being sent
      const payload = {
        name: address.name,
        email: address.email,
        phone: address.phone,
        address: address.address,
        latitude: address.latitude,
        longitude: address.longitude,
      };
      
      logger.info('📤 Sending to ShipBubble:', payload);

      const response = await axios.post(
        `${SHIPBUBBLE_BASE_URL}/shipping/address/validate`,
        payload,
        { headers: this.headers }
      );

      logger.info('📥 ShipBubble response:', {
        status: response.data.status,
        hasAddressCode: !!response.data.data?.address_code,
        data: response.data.data,
      });

      if (response.data.status === 'success' && response.data.data?.address_code) {
        const validatedData: ValidatedAddress = {
          address_code: response.data.data.address_code,
          formatted_address: response.data.data.formatted_address || address.address,
          city: response.data.data.city || '',
          state: response.data.data.state || '',
          country: response.data.data.country || 'Nigeria',
          postal_code: response.data.data.postal_code,
          latitude: response.data.data.latitude,
          longitude: response.data.data.longitude,
        };

        // Cache the address code
        this.addressCache.set(cacheKey, validatedData.address_code);

        logger.info('✅ Address validated with code:', validatedData.address_code);
        
        return validatedData;
      }

      throw new Error('Address validation failed - no address code returned');
    } catch (error: any) {
      logger.error('❌ ShipBubble address validation error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        requestPayload: {
          name: address.name,
          email: address.email,
          phone: address.phone,
          address: address.address,
        },
      });
      throw new Error('Failed to validate ShipBubble address');
    }
  }

  /**
   * Get delivery rates using ShipBubble's fetch_rates endpoint
   * ✅ FIXED: Removed hardcoded service_type to get ALL courier types
   */
  async getDeliveryRates(
    senderAddress: ShipBubbleAddress,
    receiverAddress: ShipBubbleAddress,
    packageItems: PackageItem[],
    packageDimension?: { length: number; width: number; height: number },
    categoryId?: number,
    senderAddressCode?: number,   // skip validation if already stored
    receiverAddressCode?: number, // skip validation if already stored
  ) {
    try {
      logger.info('📦 ============================================');
      logger.info('📦 FETCHING SHIPBUBBLE DELIVERY RATES');
      logger.info('📦 ============================================');

      // Step 1: Resolve sender and receiver address codes
      // Use stored codes when available to avoid redundant Shipbubble API calls
      let senderValidated: ValidatedAddress;
      let receiverValidated: ValidatedAddress;

      if (senderAddressCode) {
        logger.info('✅ Using stored sender address code:', senderAddressCode);
        senderValidated = { address_code: senderAddressCode, formatted_address: senderAddress.address, city: '', state: '', country: 'Nigeria' };
      } else {
        try {
          logger.info('📍 Validating SENDER address (no stored code)...');
          senderValidated = await this.validateAddress(senderAddress);
          logger.info('✅ Sender validated:', senderValidated.address_code);
        } catch (error: any) {
          logger.error('❌ SENDER validation failed:', error.message);
          throw error;
        }
      }

      if (receiverAddressCode) {
        logger.info('✅ Using stored receiver address code:', receiverAddressCode);
        receiverValidated = { address_code: receiverAddressCode, formatted_address: receiverAddress.address, city: '', state: '', country: 'Nigeria' };
      } else {
        try {
          logger.info('📍 Validating RECEIVER address (no stored code)...');
          receiverValidated = await this.validateAddress(receiverAddress);
          logger.info('✅ Receiver validated:', receiverValidated.address_code);
        } catch (error: any) {
          logger.error('❌ RECEIVER validation failed:', error.message);
          throw error;
        }
      }

      logger.info('✅ Both addresses resolved:', {
        senderCode: senderValidated.address_code,
        receiverCode: receiverValidated.address_code,
      });

      // Step 2: Prepare pickup date (tomorrow)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const pickupDate = tomorrow.toISOString().split('T')[0]; // yyyy-mm-dd

      // Step 3: Determine category - use provided or default to Electronics and gadgets
      const selectedCategoryId = categoryId || 77179563;

      // Step 4: Fetch rates
      // ✅ FIX: Do NOT hardcode service_type — let ShipBubble return ALL courier types
      //         Previously had `service_type: 'pickup'` which filtered out dropoff-only couriers
      const requestBody: FetchRatesRequest = {
        sender_address_code: senderValidated.address_code,
        reciever_address_code: receiverValidated.address_code,
        pickup_date: pickupDate,
        category_id: selectedCategoryId,
        package_items: packageItems,
        package_dimension: packageDimension || {
          length: 20,
          width: 20,
          height: 20,
        },
        // ✅ REMOVED: service_type: 'pickup'
        // Without service_type, ShipBubble returns ALL available couriers
        // (both pickup and dropoff) for the route, giving users more options
      };

      logger.info('📡 ShipBubble fetch_rates request:', {
        endpoint: `${SHIPBUBBLE_BASE_URL}/shipping/fetch_rates`,
        senderAddressCode: senderValidated.address_code,
        receiverAddressCode: receiverValidated.address_code,
        pickupDate,
        categoryId: selectedCategoryId,
        itemCount: packageItems.length,
        packageItems: packageItems,
      });
      
      logger.info('📤 Full request body:', JSON.stringify(requestBody, null, 2));

      // Attempt fetch_rates with automatic retry if the stored sender code is stale (422)
      let response: any;
      let freshSenderCode: number | undefined;

      try {
        response = await axios.post(
          `${SHIPBUBBLE_BASE_URL}/shipping/fetch_rates`,
          requestBody,
          { headers: this.headers, timeout: 30000 }
        );
      } catch (fetchError: any) {
        const is422 = fetchError.response?.status === 422;

        if (is422 && senderAddressCode) {
          logger.warn('⚠️ 422 with stored sender address code — evicting cache and re-validating...');
          logger.warn('⚠️ Stale-code errors:', fetchError.response?.data?.errors);

          // Evict the stale code from in-memory cache so validateAddress fetches a fresh one
          const cacheKey = this.getAddressCacheKey(senderAddress);
          this.addressCache.delete(cacheKey);

          const freshSender = await this.validateAddress(senderAddress);
          freshSenderCode = freshSender.address_code;
          logger.info('✅ Re-validated sender address code:', freshSenderCode);

          // Retry with the fresh code
          const retryBody = { ...requestBody, sender_address_code: freshSenderCode };
          response = await axios.post(
            `${SHIPBUBBLE_BASE_URL}/shipping/fetch_rates`,
            retryBody,
            { headers: this.headers, timeout: 30000 }
          );
        } else {
          logger.error('❌ ========================================');
          logger.error('❌ SHIPBUBBLE FETCH_RATES ERROR');
          logger.error('❌ ========================================');
          logger.error('❌ Error Message:', fetchError.message);
          logger.error('❌ Response Status:', fetchError.response?.status);
          logger.error('❌ Response Status Text:', fetchError.response?.statusText);
          logger.error('❌ Response Data:', JSON.stringify(fetchError.response?.data, null, 2));

          if (fetchError.response?.status === 401) {
            logger.error('🔐 Unauthorized - Check your SHIPBUBBLE_API_KEY');
          } else if (fetchError.response?.status === 400) {
            logger.error('⚠️ Bad Request - Invalid parameters');
          } else if (fetchError.response?.status === 422) {
            logger.error('⚠️ Unprocessable Entity - Validation failed:', {
              errors: fetchError.response?.data?.errors,
            });
          }

          throw fetchError;
        }
      }

      logger.info('📥 ========================================');
      logger.info('📥 SHIPBUBBLE RATES RESPONSE');
      logger.info('📥 ========================================');
      logger.info('📥 Status Code:', response.status);
      logger.info('📥 Response Status:', response.data.status);
      logger.info('📥 Response Message:', response.data.message);
      logger.info('📥 Full Response Data:', JSON.stringify(response.data.data, null, 2));

      if (response.data.data) {
        logger.info('📥 Response Details:', {
          requestToken: response.data.data.request_token,
          courierCount: response.data.data.couriers?.length || 0,
          hasCheapest: !!response.data.data.cheapest_courier,
          hasFastest: !!response.data.data.fastest_courier,
          hasBestValue: !!response.data.data.best_value_courier,
        });

        if (response.data.data.couriers) {
          logger.info('📦 Available Couriers:');
          response.data.data.couriers.forEach((courier: any, index: number) => {
            logger.info(`  ${index + 1}. ${courier.courier_name}:`, {
              courier_id: courier.courier_id,
              service_code: courier.service_code,
              service_type: courier.service_type,
              price: courier.total || courier.rate_card_amount,
              eta: courier.delivery_eta,
              pickup_eta: courier.pickup_eta,
            });
          });
        }
      }

      logger.info('✅ ShipBubble rates retrieved successfully');

      // Include freshSenderCode so the controller can persist it and avoid future stale-code 422s
      return freshSenderCode ? { ...response.data, freshSenderCode } : response.data;
    } catch (error: any) {
      logger.error('❌ ShipBubble getDeliveryRates failed:', error.message);
      throw error;
    }
  }

  /**
   * Get package categories
   */
  async getCategories() {
    try {
      logger.info('📦 Fetching package categories...');

      const response = await axios.get(
        `${SHIPBUBBLE_BASE_URL}/shipping/labels/categories`,
        { headers: this.headers }
      );

      logger.info('✅ Categories retrieved:', response.data.data?.length || 0);
      
      return response.data;
    } catch (error: any) {
      logger.error('❌ ShipBubble categories error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error('Failed to get categories');
    }
  }

  /**
   * Get category ID by name (helper function)
   * Updated with actual ShipBubble category IDs from their API
   */
  getCategoryIdByName(categoryName: string): number {
    const categories: { [key: string]: number } = {
      // Food
      'hot food': 98190590,
      'food': 98190590,
      'dry food': 24032950,
      'dry food and supplements': 24032950,
      // Electronics
      'electronics': 77179563,
      'electronics and gadgets': 77179563,
      'electronic gadgets': 77179563,
      'gadgets': 77179563,
      'phones': 77179563,
      'computers': 77179563,
      'appliances': 77179563,
      // Groceries
      'groceries': 2178251,
      'grocery': 2178251,
      'supermarket': 2178251,
      // Sensitive / Documents
      'sensitive items': 67658572,
      'documents': 67658572,
      // Light weight
      'light weight': 20754594,
      'light weight items': 20754594,
      'books': 20754594,
      'stationery': 20754594,
      // Machinery
      'machinery': 67008831,
      'tools': 67008831,
      'industrial': 67008831,
      // Medical
      'medical supplies': 57487393,
      'health': 57487393,
      'pharmacy': 57487393,
      // Beauty
      'health and beauty': 99652979,
      'beauty': 99652979,
      'skincare': 99652979,
      'cosmetics': 99652979,
      'hair care': 99652979,
      'personal care': 99652979,
      'wellness': 99652979,
      // Furniture
      'furniture': 25590994,
      'furniture and fittings': 25590994,
      'home decor': 25590994,
      'home and living': 25590994,
      'home & living': 25590994,
      'interior': 25590994,
      // Fashion
      'fashion': 74794423,
      'fashion wears': 74794423,
      'clothing': 74794423,
      'apparel': 74794423,
      'shoes': 74794423,
      'footwear': 74794423,
      'accessories': 74794423,
      'bags': 74794423,
      'jewelry': 74794423,
      'jewellery': 74794423,
      'watches': 74794423,
      'sportswear': 74794423,
      'kids fashion': 74794423,
      'men fashion': 74794423,
      'women fashion': 74794423,
      'default': 77179563,
    };

    const normalized = categoryName.toLowerCase().trim();
    // Try exact match first, then partial match
    if (categories[normalized]) return categories[normalized];
    const partialKey = Object.keys(categories).find(k => normalized.includes(k) || k.includes(normalized));
    return partialKey ? categories[partialKey] : categories['default'];
  }

  /**
   * Get all validated addresses
   */
  async getAddresses() {
    try {
      logger.info('📍 Fetching all validated addresses');

      const response = await axios.get(
        `${SHIPBUBBLE_BASE_URL}/shipping/address`,
        { headers: this.headers }
      );

      logger.info('✅ Addresses retrieved:', response.data.data?.results?.length || 0);
      
      return response.data;
    } catch (error: any) {
      logger.error('❌ ShipBubble get addresses error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error('Failed to get addresses');
    }
  }

  /**
   * Get single address by code
   */
  async getAddressByCode(addressCode: number) {
    try {
      logger.info('📍 Fetching address:', addressCode);

      const response = await axios.get(
        `${SHIPBUBBLE_BASE_URL}/shipping/address/${addressCode}`,
        { headers: this.headers }
      );

      logger.info('✅ Address retrieved');
      
      return response.data;
    } catch (error: any) {
      logger.error('❌ ShipBubble get address error:', {
        addressCode,
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error('Failed to get address');
    }
  }

  /**
   * Update address
   */
  async updateAddress(
    addressCode: number,
    updates: { name?: string; email?: string; phone?: string }
  ) {
    try {
      logger.info('📍 Updating address:', addressCode);

      const response = await axios.patch(
        `${SHIPBUBBLE_BASE_URL}/shipping/address/${addressCode}`,
        updates,
        { headers: this.headers }
      );

      logger.info('✅ Address updated');
      
      return response.data;
    } catch (error: any) {
      logger.error('❌ ShipBubble update address error:', {
        addressCode,
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error('Failed to update address');
    }
  }

  /**
   * Create shipment (book a shipment after getting rates)
   * ✅ UPDATED TO SUPPORT service_code
   */
  async createShipment(
    requestToken: string,
    courierId: string | number,
    serviceCode: string,
    isInvoiceRequired: boolean = false
  ) {
    try {
      logger.info('📦 ========================================');
      logger.info('📦 CREATE SHIPMENT API CALL');
      logger.info('📦 ========================================');
      logger.info('📤 Request parameters:', {
        requestToken,
        courierId,
        serviceCode,
        isInvoiceRequired,
      });

      const requestBody: any = {
        request_token: requestToken,
        service_code: serviceCode,
        courier_id: courierId,
        is_invoice_required: isInvoiceRequired,
      };

      logger.info('📤 Full request body:', requestBody);
      logger.info('📤 Endpoint:', `${SHIPBUBBLE_BASE_URL}/shipping/labels`);
      logger.info('📤 Headers:', {
        Authorization: `Bearer ${SHIPBUBBLE_API_KEY ? '***' + SHIPBUBBLE_API_KEY.slice(-4) : 'NOT SET'}`,
        'Content-Type': 'application/json',
      });

      const response = await axios.post(
        `${SHIPBUBBLE_BASE_URL}/shipping/labels`,
        requestBody,
        { headers: this.headers }
      );

      logger.info('📥 ========================================');
      logger.info('📥 CREATE SHIPMENT RESPONSE');
      logger.info('📥 ========================================');
      logger.info('📥 Status Code:', response.status);
      logger.info('📥 Full Response:', JSON.stringify(response.data, null, 2));
      logger.info('📥 Response Status:', response.data.status);
      logger.info('📥 Response Message:', response.data.message);
      
      if (response.data.data) {
        logger.info('📥 Response Data:', {
          order_id: response.data.data.order_id,
          tracking_number: response.data.data.tracking_number,
          shipment_id: response.data.data.shipment_id,
          courier: response.data.data.courier,
          status: response.data.data.status,
          payment: response.data.data.payment,
        });
      }

      logger.info('✅ ShipBubble shipment created:', {
        trackingNumber: response.data.data?.tracking_number,
        orderId: response.data.data?.order_id,
        label: response.data.data?.label,
      });

      return response.data;
    } catch (error: any) {
      logger.error('❌ ========================================');
      logger.error('❌ CREATE SHIPMENT ERROR');
      logger.error('❌ ========================================');
      logger.error('❌ Error Message:', error.message);
      logger.error('❌ Response Status:', error.response?.status);
      logger.error('❌ Response Status Text:', error.response?.statusText);
      logger.error('❌ Response Headers:', error.response?.headers);
      logger.error('❌ Response Data:', JSON.stringify(error.response?.data, null, 2));
      logger.error('❌ Request Config:', {
        url: error.config?.url,
        method: error.config?.method,
        data: error.config?.data,
      });
      
      if (error.response?.status === 401) {
        logger.error('🔐 AUTHENTICATION ERROR - Check SHIPBUBBLE_API_KEY');
      } else if (error.response?.status === 400) {
        logger.error('⚠️ BAD REQUEST - Invalid parameters');
        logger.error('⚠️ Validation errors:', error.response?.data?.errors);
      } else if (error.response?.status === 422) {
        logger.error('⚠️ UNPROCESSABLE ENTITY - Validation failed');
        logger.error('⚠️ Errors:', error.response?.data?.errors);
      }
      
      throw new Error('Failed to create shipment');
    }
  }

  /**
   * Track shipment
   */
  async trackShipment(trackingNumber: string) {
    try {
      logger.info('📍 Tracking shipment:', trackingNumber);

      const response = await axios.get(
        `${SHIPBUBBLE_BASE_URL}/shipping/track/${trackingNumber}`,
        { headers: this.headers }
      );

      logger.info('✅ Tracking info retrieved:', trackingNumber);
      return response.data;
    } catch (error: any) {
      logger.error('❌ ShipBubble tracking error:', {
        trackingNumber,
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error('Failed to track shipment');
    }
  }

  /**
   * Cancel shipment
   */
  async cancelShipment(orderId: string) {
    try {
      logger.info('🚫 Cancelling shipment:', orderId);

      const response = await axios.post(
        `${SHIPBUBBLE_BASE_URL}/shipping/labels/cancel/${orderId}`,
        {},
        { headers: this.headers }
      );

      logger.info('✅ Shipment cancelled:', orderId);
      return response.data;
    } catch (error: any) {
      logger.error('❌ ShipBubble cancel error:', {
        orderId,
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error('Failed to cancel shipment');
    }
  }

  /**
   * Clear address cache
   */
  clearAddressCache() {
    this.addressCache.clear();
    logger.info('🗑️ Address cache cleared');
  }
}

export const shipBubbleService = new ShipBubbleService();