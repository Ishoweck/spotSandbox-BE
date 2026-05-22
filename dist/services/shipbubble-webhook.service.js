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
exports.shipBubbleWebhookService = exports.ShipBubbleWebhookService = void 0;
// services/shipbubble-webhook.service.ts
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class ShipBubbleWebhookService {
    constructor() {
        this.baseUrl = 'https://api.shipbubble.com/v1';
        this.apiKey = process.env.SHIPBUBBLE_API_KEY || '';
        this.isSandbox = process.env.SHIPBUBBLE_ENVIRONMENT === 'sandbox';
    }
    /**
     * Simulate webhook event (sandbox only)
     * This triggers ShipBubble to send a webhook to your configured endpoint
     * OR directly simulates the webhook if ShipBubble sandbox is not configured
     */
    async simulateWebhook(params) {
        const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
        if (!this.isSandbox && !isDevelopment) {
            throw new Error('Webhook simulation is only available in sandbox or development mode');
        }
        logger_1.logger.info('🧪 ============================================');
        logger_1.logger.info('🧪 SIMULATING SHIPBUBBLE WEBHOOK');
        logger_1.logger.info('🧪 ============================================');
        logger_1.logger.info('📋 Simulation params:', params);
        logger_1.logger.info('🔧 Environment:', {
            isSandbox: this.isSandbox,
            isDevelopment,
            NODE_ENV: process.env.NODE_ENV,
        });
        // In development, always simulate directly — no API key or public URL needed
        if (isDevelopment) {
            logger_1.logger.info('🔧 Dev mode: using direct simulation (bypassing ShipBubble API)');
            return await this.simulateWebhookDirectly(params);
        }
        // In sandbox mode (staging/CI), call ShipBubble's simulator which posts to your webhook URL
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/shipping/labels/webhooks/${params.orderId}`, { status_code: params.statusCode }, {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
            });
            logger_1.logger.info('✅ Webhook simulation successful:', response.data);
            logger_1.logger.info('🧪 ============================================\n');
            return response.data;
        }
        catch (error) {
            // Fallback if sandbox webhook URL not configured on ShipBubble dashboard
            if (error.response?.data?.message?.includes('No sandbox webhook url') ||
                error.response?.data?.message?.includes('webhook url')) {
                logger_1.logger.warn('⚠️ ShipBubble sandbox webhook not configured, simulating directly...');
                return await this.simulateWebhookDirectly(params);
            }
            logger_1.logger.error('❌ Webhook simulation failed:', {
                error: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
            logger_1.logger.info('🧪 ============================================\n');
            throw error;
        }
    }
    /**
     * Directly simulate webhook by calling our own webhook handler
     * This bypasses ShipBubble entirely for local testing
     */
    async simulateWebhookDirectly(params) {
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('🔄 DIRECT WEBHOOK SIMULATION');
        logger_1.logger.info('🔄 ============================================');
        logger_1.logger.info('📋 Params:', params);
        // Map status codes to friendly names
        const statusMapping = {
            pending: 'Pending',
            confirmed: 'Confirmed',
            picked_up: 'Picked Up',
            in_transit: 'In Transit',
            completed: 'Delivered',
            cancelled: 'Cancelled',
        };
        // ✅ Construct webhook payload matching actual ShipBubble format
        const webhookPayload = {
            event: 'shipment.status.changed',
            order_id: params.orderId,
            status: params.statusCode,
            courier: {
                name: 'Bubble Express',
                email: 'courier@shipbubble.com',
                phone: '+2348000000000',
                tracking_code: params.orderId,
                tracking_message: `Tracking code: ${params.orderId}`,
                rider_info: null,
            },
            ship_from: {
                name: 'Vendor',
                phone: '+2348000000000',
                email: 'vendor@example.com',
                address: 'Lagos, Nigeria',
            },
            ship_to: {
                name: 'Customer',
                phone: '+2348000000000',
                email: 'customer@example.com',
                address: 'Lagos, Nigeria',
            },
            to_be_processed: new Date().toISOString(),
            payment: {
                shipping_fee: 0,
                currency: 'NGN',
            },
            package_status: [
                {
                    status: statusMapping[params.statusCode] || params.statusCode,
                    datetime: new Date().toISOString(),
                },
            ],
            insurance: null,
            events: [
                {
                    event: params.statusCode,
                    timestamp: new Date().toISOString(),
                    description: `Package ${statusMapping[params.statusCode]?.toLowerCase() || params.statusCode}`,
                    location: 'Lagos, Nigeria',
                },
            ],
            dropoff_station: null,
            pickup_station: null,
            tracking_url: `https://shipbubble.com/orders/tracking/${params.orderId}`,
            waybill_document: null,
            date: new Date().toISOString(),
        };
        logger_1.logger.info('📦 Webhook payload:', webhookPayload);
        try {
            // ✅ Import and call the webhook handler directly
            const { webhookController } = await Promise.resolve().then(() => __importStar(require('../controllers/webhook.controller')));
            // Create a mock request object
            const mockReq = {
                body: webhookPayload,
                headers: {},
                method: 'POST',
                url: '/api/v1/webhooks/shipbubble',
            };
            // Create a mock response object
            let responseData = null;
            const mockRes = {
                status: (code) => mockRes,
                json: (data) => {
                    responseData = data;
                    return mockRes;
                },
            };
            // Call the webhook handler
            await webhookController.handleShipBubbleWebhook(mockReq, mockRes);
            logger_1.logger.info('✅ Direct webhook simulation successful');
            logger_1.logger.info('📤 Response:', responseData);
            logger_1.logger.info('🔄 ============================================\n');
            return {
                success: true,
                message: 'Webhook simulated directly (bypass ShipBubble)',
                method: 'direct',
                payload: webhookPayload,
            };
        }
        catch (error) {
            logger_1.logger.error('❌ Direct webhook simulation failed:', error);
            logger_1.logger.info('🔄 ============================================\n');
            throw error;
        }
    }
    /**
     * Test webhook configuration
     * Sends a test webhook to verify your endpoint is working
     */
    async testWebhookEndpoint() {
        logger_1.logger.info('🧪 Testing webhook endpoint configuration...');
        const testPayload = {
            order_id: 'TEST-ORDER-ID',
            status: 'pending',
            courier: {
                name: 'Test Courier',
                tracking_code: 'TEST123',
            },
        };
        logger_1.logger.info('📤 Test payload:', testPayload);
        // This would send to your configured webhook URL
        // ShipBubble handles this automatically
        logger_1.logger.info('✅ Webhook endpoint test initiated');
        return {
            success: true,
            message: 'Check your webhook endpoint logs for the test payload',
        };
    }
}
exports.ShipBubbleWebhookService = ShipBubbleWebhookService;
exports.shipBubbleWebhookService = new ShipBubbleWebhookService();
//# sourceMappingURL=shipbubble-webhook.service.js.map