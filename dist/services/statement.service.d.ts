export interface StatementData {
    vendor: {
        name: string;
        email: string;
        storeName: string;
    };
    period: {
        start: Date;
        end: Date;
    };
    summary: {
        totalRevenue: number;
        earnedRevenue: number;
        totalOrders: number;
        totalItems: number;
        walletBalance: number;
        pendingBalance: number;
        totalWithdrawn: number;
    };
    orders: {
        orderNumber: string;
        date: Date;
        customer: string;
        vendorAmount: number;
        status: string;
        itemCount: number;
    }[];
    txns: {
        date: Date;
        type: string;
        purpose: string;
        amount: number;
        description: string;
    }[];
    disputes: {
        disputeNumber: string;
        date: Date;
        orderNumber: string;
        reason: string;
        status: string;
        refundAmount?: number;
    }[];
}
export declare function gatherStatementData(vendorId: string, startDate: Date, endDate: Date): Promise<StatementData>;
export declare function generateStatementPDF(data: StatementData): Promise<Buffer>;
//# sourceMappingURL=statement.service.d.ts.map