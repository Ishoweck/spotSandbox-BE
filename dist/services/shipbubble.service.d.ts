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
    unit_weight: string;
    unit_amount: string;
    quantity: string;
}
export declare class ShipBubbleService {
    private headers;
    private addressCache;
    constructor();
    private validateConfig;
    /**
     * Generate cache key for an address
     */
    private getAddressCacheKey;
    /**
     * Validate and get address code
     */
    validateAddress(address: ShipBubbleAddress): Promise<ValidatedAddress>;
    /**
     * Get delivery rates using ShipBubble's fetch_rates endpoint
     * ✅ FIXED: Removed hardcoded service_type to get ALL courier types
     */
    getDeliveryRates(senderAddress: ShipBubbleAddress, receiverAddress: ShipBubbleAddress, packageItems: PackageItem[], packageDimension?: {
        length: number;
        width: number;
        height: number;
    }, categoryId?: number, senderAddressCode?: number, // skip validation if already stored
    receiverAddressCode?: number): Promise<any>;
    /**
     * Get package categories
     */
    getCategories(): Promise<any>;
    /**
     * Get category ID by name (helper function)
     * Updated with actual ShipBubble category IDs from their API
     */
    getCategoryIdByName(categoryName: string): number;
    /**
     * Get all validated addresses
     */
    getAddresses(): Promise<any>;
    /**
     * Get single address by code
     */
    getAddressByCode(addressCode: number): Promise<any>;
    /**
     * Update address
     */
    updateAddress(addressCode: number, updates: {
        name?: string;
        email?: string;
        phone?: string;
    }): Promise<any>;
    /**
     * Create shipment (book a shipment after getting rates)
     * ✅ UPDATED TO SUPPORT service_code
     */
    createShipment(requestToken: string, courierId: string | number, serviceCode: string, isInvoiceRequired?: boolean): Promise<any>;
    /**
     * Track shipment
     */
    trackShipment(trackingNumber: string): Promise<any>;
    /**
     * Cancel shipment
     */
    cancelShipment(orderId: string): Promise<any>;
    /**
     * Clear address cache
     */
    clearAddressCache(): void;
}
export declare const shipBubbleService: ShipBubbleService;
export {};
//# sourceMappingURL=shipbubble.service.d.ts.map