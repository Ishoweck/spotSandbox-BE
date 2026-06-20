import { Request, Response } from 'express';
export declare function getTierRate(ordinalPosition: number): number;
export declare const submitApplication: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const verifyInvite: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const getAllApplications: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const getApplication: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const approveApplication: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const rejectApplication: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const addNote: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const getAmbassadorReferrals: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const updateApplication: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const deleteApplication: (req: Request, res: Response, next: import("express").NextFunction) => void;
export declare const getMyDashboard: (req: Request, res: Response, next: import("express").NextFunction) => void;
/**
 * Called when a vendor's product is approved AND vendor account is verified.
 * Checks if this vendor was referred by an ambassador. If so, credits 40% commission.
 */
export declare function handleVendorProductApproved(vendorUserId: string): Promise<void>;
/**
 * Called when a vendor makes their first completed sale.
 * Releases the remaining 60% commission to their referring ambassador.
 */
export declare function handleVendorFirstSale(vendorUserId: string): Promise<void>;
/**
 * Called when a customer's order is completed.
 * Awards 3% commission on the customer's first 3 completed orders if they were referred by an ambassador.
 */
export declare function handleCustomerOrderCompleted(customerUserId: string, orderId: string, orderAmount: number): Promise<void>;
/**
 * Creates an AmbassadorReferral record when a referred user registers.
 * Determines ordinalPosition and tierRate for vendor referrals.
 */
export declare function createReferralRecord(ambassadorUserId: string, referredUserId: string, referredUserType: 'vendor' | 'customer'): Promise<void>;
//# sourceMappingURL=ambassador.controller.d.ts.map