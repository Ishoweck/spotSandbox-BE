import crypto from 'crypto';
import mongoose from 'mongoose';
import PaymentLink, { IPaymentLink } from '../models/PaymentLink';
import PaymentLinkPayment from '../models/PaymentLinkPayment';
import { PendingPayment } from '../models/PendingPayment';
import User from '../models/User';
import Wallet from '../models/Wallet';
import VendorProfile from '../models/VendorProfile';
import { AppError } from '../middleware/error';
import { logger } from '../utils/logger';
import { notificationService } from './notification.service';
import { sendPaymentLinkReceiptEmail, sendPaymentLinkReceivedEmail } from '../utils/email';
import {
  CHECKOUT_LINK_COMMISSION_PERCENT,
  PAYMENT_LINK_DAILY_LIMIT_NEW,
  PAYMENT_LINK_DAILY_LIMIT_TRUSTED,
  PAYMENT_LINK_HOLD_HOURS,
  PAYMENT_LINK_TRUSTED_AFTER_DAYS,
  calculatePaymentLinkFee,
} from '../config/payment-links';
import {
  NotificationType,
  TransactionType,
  UserRole,
  UserStatus,
  VendorVerificationStatus,
  WalletPurpose,
} from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export const walletReferenceFor = (paymentReference: string) => `PL-${paymentReference}`;

/** Short, readable, unguessable code: "seyiscents-x7k2m" */
export async function generateLinkCode(vendorSlug?: string): Promise<string> {
  const base = (vendorSlug || 'pay').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'pay';
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = crypto.randomBytes(4).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5);
    const code = `${base}-${suffix}`;
    if (!(await PaymentLink.exists({ code }))) return code;
  }
  throw new AppError('Could not generate a unique link code, please try again', 500);
}

/** Throws unless the vendor may create or receive through payment links. */
export async function assertVendorCanUseLinks(vendorUserId: string) {
  const profile = await VendorProfile.findOne({ user: vendorUserId })
    .select('businessName slug businessLogo verificationStatus verifiedAt isActive createdAt');
  if (!profile) throw new AppError('Vendor profile not found', 404);
  if (profile.verificationStatus !== VendorVerificationStatus.VERIFIED) {
    throw new AppError('Only verified vendors can use payment links. Complete your KYC to get started.', 403);
  }
  if (profile.isActive === false) {
    throw new AppError('This store is currently unavailable', 403);
  }
  return profile;
}

export function dailyLimitFor(profile: { verifiedAt?: Date; createdAt?: Date }): number {
  const since = profile.verifiedAt || profile.createdAt;
  const trusted = !!since && Date.now() - new Date(since).getTime() >= PAYMENT_LINK_TRUSTED_AFTER_DAYS * DAY_MS;
  return trusted ? PAYMENT_LINK_DAILY_LIMIT_TRUSTED : PAYMENT_LINK_DAILY_LIMIT_NEW;
}

export async function receivedInLast24h(vendorUserId: string): Promise<number> {
  const [row] = await PaymentLinkPayment.aggregate([
    {
      $match: {
        vendor: new mongoose.Types.ObjectId(vendorUserId),
        paidAt: { $gte: new Date(Date.now() - DAY_MS) },
        status: { $ne: 'REVERSED' },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return row?.total || 0;
}

/**
 * Find the buyer's account by email, or quietly create a guest one (same shape
 * as /auth/guest-register). No tokens are issued: paying through a link never
 * signs anyone in, so matching an existing email leaks nothing.
 */
export async function findOrCreatePayer(input: { name: string; email: string; phone?: string }) {
  const email = input.email.trim().toLowerCase();
  const existing = await User.findOne({ email }).select('_id firstName email phone');
  if (existing) return existing;

  const normalizedPhone = input.phone
    ? (input.phone.startsWith('0') ? `+234${input.phone.slice(1)}` : input.phone)
    : undefined;
  const phoneTaken = normalizedPhone ? await User.exists({ phone: normalizedPhone }) : null;
  const [firstName, ...rest] = input.name.trim().split(/\s+/);

  const user = await User.create({
    firstName: firstName || 'Guest',
    lastName: rest.join(' ') || 'User',
    email,
    ...(normalizedPhone && !phoneTaken ? { phone: normalizedPhone } : {}),
    password: crypto.randomBytes(8).toString('hex'),
    role: UserRole.CUSTOMER,
    emailVerified: true,
    status: UserStatus.ACTIVE,
  });
  await Wallet.create({ user: user._id });
  return user;
}

/**
 * Record a successful payment-link charge. Safe to call more than once for the
 * same reference (webhook + buyer's verify call): the unique reference on
 * PaymentLinkPayment makes every call after the first a no-op.
 *
 * Amounts come from the server-stored PendingPayment snapshot, never from the
 * client; the gateway's paid amount must cover it.
 */
export async function fulfillPaymentLinkPayment(reference: string, paidAmountNaira: number): Promise<void> {
  if (await PaymentLinkPayment.exists({ reference })) return;

  // Atomic claim: only the first caller flips the record off 'pending' and
  // goes on to record the payment. Doesn't rely on the unique index being built.
  const now = new Date();
  const pending = await PendingPayment.findOneAndUpdate(
    { reference, type: 'payment_link', status: 'pending' },
    { $set: { status: 'completed', completedAt: now } }
  );
  if (!pending) {
    if (!(await PendingPayment.exists({ reference, type: 'payment_link' }))) {
      logger.error(`[PaymentLink] No pending record for ${reference}`);
    }
    return; // already handled by a concurrent call, or marked failed
  }
  const releaseClaim = () =>
    PendingPayment.updateOne({ reference }, { $set: { status: 'pending' }, $unset: { completedAt: 1 } });

  if (!pending.snapshotJson) {
    logger.error(`[PaymentLink] No snapshot for ${reference}`);
    await PendingPayment.updateOne({ reference }, { status: 'failed' });
    return;
  }
  const snap = JSON.parse(pending.snapshotJson);

  if (paidAmountNaira + 0.01 < snap.amount) {
    logger.error(`[PaymentLink] Underpayment on ${reference}: paid ${paidAmountNaira}, expected ${snap.amount}`);
    await PendingPayment.updateOne({ reference }, { status: 'failed' });
    return;
  }

  const link = await PaymentLink.findById(snap.linkId);
  if (!link) {
    logger.error(`[PaymentLink] Link ${snap.linkId} missing for ${reference}`);
    await releaseClaim();
    return;
  }

  const fee = calculatePaymentLinkFee(snap.amount);
  const netAmount = Math.round((snap.amount - fee) * 100) / 100;

  try {
    await PaymentLinkPayment.create({
      link: link._id,
      vendor: link.vendor,
      payer: snap.payerId,
      payerName: snap.payerName,
      payerEmail: snap.payerEmail,
      payerPhone: snap.payerPhone,
      note: snap.note,
      amount: snap.amount,
      chargedAmount: Math.round(paidAmountNaira * 100) / 100,
      fee,
      netAmount,
      reference,
      status: 'HELD',
      paidAt: now,
      releaseAt: new Date(now.getTime() + PAYMENT_LINK_HOLD_HOURS * 60 * 60 * 1000),
    });
  } catch (err: any) {
    if (err.code === 11000) return; // recorded by a concurrent call
    await releaseClaim(); // let the webhook retry / verify call try again
    throw err;
  }

  await PaymentLink.updateOne(
    { _id: link._id },
    {
      $inc: { paymentsCount: 1, totalReceived: snap.amount },
      ...(link.singleUse ? { $set: { status: 'USED' } } : {}),
    }
  );

  // Shows in the vendor's wallet history straight away as pending; the balance
  // itself only moves when the hold ends (releaseDuePaymentLinkPayments).
  await Wallet.updateOne(
    { user: link.vendor },
    {
      $push: {
        transactions: {
          type: TransactionType.CREDIT,
          amount: netAmount,
          purpose: WalletPurpose.PAYMENT_LINK,
          reference: walletReferenceFor(reference),
          description: `Payment link from ${snap.payerName} (${link.title}), ₦${fee.toLocaleString()} fee deducted. Available after ${PAYMENT_LINK_HOLD_HOURS}h`,
          status: 'pending',
          timestamp: now,
        },
      },
    },
    { upsert: true }
  );

  logger.info(`[PaymentLink] ${reference}: ₦${snap.amount} to vendor ${link.vendor} via ${link.code} (net ₦${netAmount})`);

  notificationService.send({
    userId: link.vendor.toString(),
    type: NotificationType.PAYMENT,
    title: 'Payment received',
    message: `${snap.payerName} paid ₦${snap.amount.toLocaleString()} via "${link.title}". ₦${netAmount.toLocaleString()} will be available in ${PAYMENT_LINK_HOLD_HOURS} hours.`,
    link: '/vendor/payment-links',
    data: { paymentLinkId: link._id.toString(), reference },
    referenceId: `payment_link:${reference}`,
  }).catch((e: any) => logger.error('[PaymentLink] vendor notification failed', { error: e.message }));

  const vendorUser = await User.findById(link.vendor).select('email firstName');
  const vendorProfile = await VendorProfile.findOne({ user: link.vendor }).select('businessName');
  const vendorName = vendorProfile?.businessName || vendorUser?.firstName || 'the vendor';

  sendPaymentLinkReceiptEmail(snap.payerEmail, {
    payerName: snap.payerName,
    vendorName,
    title: link.title,
    amount: snap.amount,
    chargedAmount: Math.round(paidAmountNaira * 100) / 100,
    reference,
  }).catch((e: any) => logger.error('[PaymentLink] payer receipt failed', { error: e.message }));

  if (vendorUser?.email) {
    sendPaymentLinkReceivedEmail(vendorUser.email, {
      vendorName,
      payerName: snap.payerName,
      title: link.title,
      amount: snap.amount,
      fee,
      netAmount,
      holdHours: PAYMENT_LINK_HOLD_HOURS,
      reference,
    }).catch((e: any) => logger.error('[PaymentLink] vendor email failed', { error: e.message }));
  }
}

/** Move held payments whose hold has ended into the vendor's withdrawable balance. */
export async function releaseDuePaymentLinkPayments(): Promise<number> {
  const due = await PaymentLinkPayment.find({ status: 'HELD', releaseAt: { $lte: new Date() } })
    .select('_id')
    .limit(500);
  let released = 0;

  for (const { _id } of due) {
    // Atomic claim so two server instances never credit the same payment twice
    const payment = await PaymentLinkPayment.findOneAndUpdate(
      { _id, status: 'HELD' },
      { $set: { status: 'RELEASED', releasedAt: new Date() } },
      { new: true }
    );
    if (!payment) continue;

    const walletRef = walletReferenceFor(payment.reference);
    const updated = await Wallet.updateOne(
      { user: payment.vendor, 'transactions.reference': walletRef },
      {
        $inc: { balance: payment.netAmount, totalEarned: payment.netAmount },
        $set: { 'transactions.$.status': 'completed' },
      }
    );
    if (updated.modifiedCount === 0) {
      // Pending entry missing (e.g. wallet created after payment): credit with a fresh entry
      await Wallet.updateOne(
        { user: payment.vendor },
        {
          $inc: { balance: payment.netAmount, totalEarned: payment.netAmount },
          $push: {
            transactions: {
              type: TransactionType.CREDIT,
              amount: payment.netAmount,
              purpose: WalletPurpose.PAYMENT_LINK,
              reference: walletRef,
              description: `Payment link from ${payment.payerName}`,
              status: 'completed',
              timestamp: new Date(),
            },
          },
        },
        { upsert: true }
      );
    }
    released++;
  }

  if (released > 0) logger.info(`[PaymentLink] Released ${released} held payment(s) to vendor wallets`);
  return released;
}

/**
 * Admin reversal for fraud or a chargeback. A held payment is simply cancelled;
 * a released one is debited from the vendor's balance, which must cover it.
 */
export async function reversePaymentLinkPayment(paymentId: string, adminId: string, reason: string) {
  const payment = await PaymentLinkPayment.findById(paymentId);
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.status === 'REVERSED') throw new AppError('Payment already reversed', 400);

  const walletRef = walletReferenceFor(payment.reference);
  const wasReleased = payment.status === 'RELEASED';

  const claimed = await PaymentLinkPayment.findOneAndUpdate(
    { _id: payment._id, status: payment.status },
    { $set: { status: 'REVERSED', reversedAt: new Date(), reversedBy: adminId, reversalReason: reason } },
    { new: true }
  );
  if (!claimed) throw new AppError('Payment changed while reversing, please retry', 409);

  if (wasReleased) {
    const debited = await Wallet.findOneAndUpdate(
      { user: payment.vendor, balance: { $gte: payment.netAmount } },
      {
        $inc: { balance: -payment.netAmount, totalEarned: -payment.netAmount },
        $push: {
          transactions: {
            type: TransactionType.DEBIT,
            amount: payment.netAmount,
            purpose: WalletPurpose.PAYMENT_LINK,
            reference: `${walletRef}-REV`,
            description: `Reversal of payment link ${payment.reference}: ${reason}`,
            status: 'completed',
            timestamp: new Date(),
          },
        },
      }
    );
    if (!debited) {
      // Roll the status back so the record matches the wallet
      await PaymentLinkPayment.updateOne(
        { _id: payment._id },
        { $set: { status: 'RELEASED' }, $unset: { reversedAt: 1, reversedBy: 1, reversalReason: 1 } }
      );
      throw new AppError("Vendor's balance is too low to reverse this payment. Recover it manually.", 400);
    }
  } else {
    await Wallet.updateOne(
      { user: payment.vendor, 'transactions.reference': walletRef },
      { $set: { 'transactions.$.status': 'failed', 'transactions.$.description': `Reversed: ${reason}` } }
    );
  }

  return claimed;
}

/**
 * Validate a product checkout link for the items being bought. Returns the
 * snapshot stored on the order, or undefined when the code is absent. The
 * reduced rate only applies if the cart actually contains the link vendor's items.
 */
export async function resolveCheckoutLink(
  code: string | undefined,
  cartVendorIds: string[]
): Promise<{ link: string; code: string; vendor: string; commissionRate: number } | undefined> {
  if (!code) return undefined;
  const link: IPaymentLink | null = await PaymentLink.findOne({
    code: String(code).toLowerCase(),
    type: 'PRODUCT',
    status: 'ACTIVE',
  });
  if (!link) return undefined; // stale or disabled link: fall back to a normal order
  const vendorId = link.vendor.toString();
  if (!cartVendorIds.includes(vendorId)) return undefined;
  return { link: link._id.toString(), code: link.code, vendor: vendorId, commissionRate: CHECKOUT_LINK_COMMISSION_PERCENT };
}

/**
 * Re-resolve a checkout link carried in a payment snapshot. Snapshots can come
 * from the client, so only the code is trusted; vendor and rate are looked up again.
 */
export async function trustedCheckoutLink(snapshotLink: any, orderItems: any[]) {
  const vendorIds = (orderItems || [])
    .map((i: any) => (i.vendor?._id || i.vendor)?.toString())
    .filter(Boolean);
  return resolveCheckoutLink(snapshotLink?.code, vendorIds);
}

/** Commission override for one vendor on an order, or null to use their normal rate. */
export function checkoutLinkRateFor(order: any, vendorId: string): number | null {
  const cl = order?.checkoutLink;
  if (!cl?.vendor || cl.commissionRate == null) return null;
  return cl.vendor.toString() === vendorId.toString() ? cl.commissionRate : null;
}
