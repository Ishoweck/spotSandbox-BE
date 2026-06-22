export interface ReceiptData {
    orderNumber: string;
    date: Date | string;
    paymentMethod: string;
    paymentReference?: string;
    customer: {
        name: string;
        email: string;
    };
    deliveryAddress?: {
        street?: string;
        city?: string;
        state?: string;
        country?: string;
    };
    items: {
        productName: string;
        vendorName?: string;
        quantity: number;
        price: number;
    }[];
    subtotal: number;
    discount: number;
    shippingCost: number;
    serviceCharge: number;
    total: number;
}
export declare function generateReceiptPDF(data: ReceiptData): Promise<Buffer>;
//# sourceMappingURL=receipt.service.d.ts.map