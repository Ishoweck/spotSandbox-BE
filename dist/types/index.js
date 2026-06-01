"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChallengeStatus = exports.ChallengeType = exports.NotificationType = exports.DeliveryStatus = exports.VendorVerificationStatus = exports.WalletPurpose = exports.TransactionType = exports.PaymentMethod = exports.PaymentStatus = exports.OrderStatus = exports.ProductStatus = exports.ProductType = exports.UserStatus = exports.UserRole = void 0;
// User Roles
var UserRole;
(function (UserRole) {
    UserRole["CUSTOMER"] = "customer";
    UserRole["VENDOR"] = "vendor";
    UserRole["ADMIN"] = "admin";
    UserRole["SUPER_ADMIN"] = "super_admin";
    UserRole["FINANCIAL_ADMIN"] = "financial_admin";
    UserRole["AFFILIATE"] = "affiliate";
})(UserRole || (exports.UserRole = UserRole = {}));
// User Status
var UserStatus;
(function (UserStatus) {
    UserStatus["ACTIVE"] = "active";
    UserStatus["INACTIVE"] = "inactive";
    UserStatus["SUSPENDED"] = "suspended";
    UserStatus["PENDING_VERIFICATION"] = "pending_verification";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
// Product Types
var ProductType;
(function (ProductType) {
    ProductType["PHYSICAL"] = "physical";
    ProductType["DIGITAL"] = "digital";
})(ProductType || (exports.ProductType = ProductType = {}));
// Product Status
var ProductStatus;
(function (ProductStatus) {
    ProductStatus["DRAFT"] = "draft";
    ProductStatus["ACTIVE"] = "active";
    ProductStatus["INACTIVE"] = "inactive";
    ProductStatus["OUT_OF_STOCK"] = "out_of_stock";
    ProductStatus["PENDING_APPROVAL"] = "pending_approval";
    ProductStatus["VENDOR_SUSPENDED"] = "vendor_suspended";
})(ProductStatus || (exports.ProductStatus = ProductStatus = {}));
// Order Status
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["PENDING"] = "pending";
    OrderStatus["CONFIRMED"] = "confirmed";
    OrderStatus["PROCESSING"] = "processing";
    OrderStatus["SHIPPED"] = "shipped";
    OrderStatus["IN_TRANSIT"] = "in_transit";
    OrderStatus["DELIVERED"] = "delivered";
    OrderStatus["CANCELLED"] = "cancelled";
    OrderStatus["REFUNDED"] = "refunded";
    OrderStatus["FAILED"] = "failed";
    OrderStatus["DISPUTED"] = "disputed";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
// Payment Status
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["PENDING"] = "pending";
    PaymentStatus["PROCESSING"] = "processing";
    PaymentStatus["COMPLETED"] = "completed";
    PaymentStatus["FAILED"] = "failed";
    PaymentStatus["REFUNDED"] = "refunded";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
// Payment Method
var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["PAYSTACK"] = "paystack";
    PaymentMethod["FLUTTERWAVE"] = "flutterwave";
    PaymentMethod["WALLET"] = "wallet";
})(PaymentMethod || (exports.PaymentMethod = PaymentMethod = {}));
// Transaction Types
var TransactionType;
(function (TransactionType) {
    TransactionType["CREDIT"] = "credit";
    TransactionType["DEBIT"] = "debit";
})(TransactionType || (exports.TransactionType = TransactionType = {}));
// Wallet Transaction Purpose
var WalletPurpose;
(function (WalletPurpose) {
    WalletPurpose["PURCHASE"] = "purchase";
    WalletPurpose["REFUND"] = "refund";
    WalletPurpose["WITHDRAWAL"] = "withdrawal";
    WalletPurpose["COMMISSION"] = "commission";
    WalletPurpose["REWARD"] = "reward";
    WalletPurpose["CASHBACK"] = "cashback";
    WalletPurpose["TOP_UP"] = "top_up";
})(WalletPurpose || (exports.WalletPurpose = WalletPurpose = {}));
// Vendor Verification Status
var VendorVerificationStatus;
(function (VendorVerificationStatus) {
    VendorVerificationStatus["PENDING"] = "pending";
    VendorVerificationStatus["VERIFIED"] = "verified";
    VendorVerificationStatus["REJECTED"] = "rejected";
})(VendorVerificationStatus || (exports.VendorVerificationStatus = VendorVerificationStatus = {}));
// Delivery Status
var DeliveryStatus;
(function (DeliveryStatus) {
    DeliveryStatus["PENDING"] = "pending";
    DeliveryStatus["ASSIGNED"] = "assigned";
    DeliveryStatus["PICKED_UP"] = "picked_up";
    DeliveryStatus["IN_TRANSIT"] = "in_transit";
    DeliveryStatus["DELIVERED"] = "delivered";
    DeliveryStatus["FAILED"] = "failed";
    DeliveryStatus["CANCELLED"] = "cancelled";
})(DeliveryStatus || (exports.DeliveryStatus = DeliveryStatus = {}));
// Notification Types
var NotificationType;
(function (NotificationType) {
    NotificationType["ORDER"] = "order";
    NotificationType["PAYMENT"] = "payment";
    NotificationType["DELIVERY"] = "delivery";
    NotificationType["PROMOTION"] = "promotion";
    NotificationType["ACCOUNT"] = "account";
    NotificationType["CHAT"] = "chat";
    NotificationType["REVIEW"] = "review";
    NotificationType["SYSTEM"] = "system";
    NotificationType["CHALLENGE"] = "challenge";
})(NotificationType || (exports.NotificationType = NotificationType = {}));
// Challenge Types
var ChallengeType;
(function (ChallengeType) {
    ChallengeType["BUYER"] = "buyer";
    ChallengeType["SELLER"] = "seller";
    ChallengeType["AFFILIATE"] = "affiliate";
})(ChallengeType || (exports.ChallengeType = ChallengeType = {}));
// Challenge Status
var ChallengeStatus;
(function (ChallengeStatus) {
    ChallengeStatus["ACTIVE"] = "active";
    ChallengeStatus["INACTIVE"] = "inactive";
    ChallengeStatus["COMPLETED"] = "completed";
})(ChallengeStatus || (exports.ChallengeStatus = ChallengeStatus = {}));
//# sourceMappingURL=index.js.map