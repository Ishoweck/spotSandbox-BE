// Fees, holds and limits for vendor payment links and product checkout links.
// Every number here is read at request time, so changing a value only needs a
// redeploy, not a migration.

// Fee Vendorspot keeps on a direct payment link (covers Paystack's cut).
export const PAYMENT_LINK_FEE_PERCENT = 3.5;

// Commission on product sales that came through a vendor's checkout link,
// instead of the vendor's normal marketplace rate (8 / 6 / 5%). Kept equal to the
// payment-link fee so vendors see one rate for every kind of link.
export const CHECKOUT_LINK_COMMISSION_PERCENT = PAYMENT_LINK_FEE_PERCENT;

// Payment-link money is held this long before it becomes withdrawable, so it
// lines up with Paystack settling to us and leaves a window to catch fraud.
export const PAYMENT_LINK_HOLD_HOURS = 24;

// Amount bounds for a single payment-link payment (naira).
export const PAYMENT_LINK_MIN_AMOUNT = 100;
export const PAYMENT_LINK_MAX_AMOUNT = 500_000;

// Rolling 24-hour cap on what one vendor can receive through payment links.
// Vendors verified for less than PAYMENT_LINK_TRUSTED_AFTER_DAYS get the lower cap.
export const PAYMENT_LINK_DAILY_LIMIT_NEW = 200_000;
export const PAYMENT_LINK_DAILY_LIMIT_TRUSTED = 1_000_000;
export const PAYMENT_LINK_TRUSTED_AFTER_DAYS = 30;

export const calculatePaymentLinkFee = (amount: number): number =>
  Math.round(amount * (PAYMENT_LINK_FEE_PERCENT / 100) * 100) / 100;
