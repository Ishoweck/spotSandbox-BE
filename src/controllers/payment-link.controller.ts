import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest, ApiResponse, ProductStatus } from '../types';
import PaymentLink from '../models/PaymentLink';
import PaymentLinkPayment from '../models/PaymentLinkPayment';
import { PendingPayment } from '../models/PendingPayment';
import Product from '../models/Product';
import VendorProfile from '../models/VendorProfile';
import { AppError } from '../middleware/error';
import { logger } from '../utils/logger';
import { escapeRegex } from '../utils/helpers';
import { paystackService } from '../services/paystack.service';
import {
  assertVendorCanUseLinks,
  dailyLimitFor,
  findOrCreatePayer,
  fulfillPaymentLinkPayment,
  generateLinkCode,
  receivedInLast24h,
  reversePaymentLinkPayment,
} from '../services/payment-link.service';
import {
  CHECKOUT_LINK_COMMISSION_PERCENT,
  PAYMENT_LINK_FEE_PERCENT,
  PAYMENT_LINK_HOLD_HOURS,
  PAYMENT_LINK_MAX_AMOUNT,
  PAYMENT_LINK_MIN_AMOUNT,
} from '../config/payment-links';

const websiteUrl = () => process.env.FRONTEND_URL || 'https://vendorspotng.com';
const linkUrl = (code: string) => `${websiteUrl()}/pay/${code}`;

const generatePaymentReference = () =>
  `PL${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

const serializeLink = (link: any) => ({
  id: link._id,
  code: link.code,
  url: linkUrl(link.code),
  type: link.type,
  title: link.title,
  description: link.description,
  amount: link.amount ?? null,
  product: link.product ?? null,
  singleUse: link.singleUse,
  status: link.status,
  paymentsCount: link.paymentsCount,
  totalReceived: link.totalReceived,
  createdAt: link.createdAt,
});

export class PaymentLinkController {
  // ─── Vendor ────────────────────────────────────────────────────────────────

  async createLink(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const vendorId = req.user!.id;
    const profile = await assertVendorCanUseLinks(vendorId);
    const { type, title, description, amount, singleUse, productId } = req.body;

    if (type === 'PRODUCT') {
      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        throw new AppError('Choose a product for this checkout link', 400);
      }
      const product = await Product.findOne({ _id: productId, vendor: vendorId }).select('name status');
      if (!product) throw new AppError('Product not found in your store', 404);
      if (product.status !== ProductStatus.ACTIVE) {
        throw new AppError('Only approved, active products can have a checkout link', 400);
      }
      // One reusable link per product is enough; hand back the existing one
      const existing = await PaymentLink.findOne({ vendor: vendorId, type: 'PRODUCT', product: product._id, status: 'ACTIVE' });
      if (existing) {
        res.json({ success: true, message: 'Checkout link ready', data: { link: serializeLink(existing) } });
        return;
      }
      const link = await PaymentLink.create({
        vendor: vendorId,
        code: await generateLinkCode(profile.slug),
        type: 'PRODUCT',
        title: (title || product.name).toString().slice(0, 120),
        description,
        product: product._id,
        singleUse: false,
      });
      res.status(201).json({ success: true, message: 'Checkout link created', data: { link: serializeLink(link) } });
      return;
    }

    if (type !== 'PAYMENT') throw new AppError('type must be PAYMENT or PRODUCT', 400);
    if (!title || !String(title).trim()) throw new AppError('Give the link a title, e.g. "Payment for 2 perfumes"', 400);

    let fixedAmount: number | undefined;
    if (amount !== undefined && amount !== null && amount !== '') {
      fixedAmount = Number(amount);
      if (!Number.isFinite(fixedAmount) || fixedAmount < PAYMENT_LINK_MIN_AMOUNT || fixedAmount > PAYMENT_LINK_MAX_AMOUNT) {
        throw new AppError(`Amount must be between ₦${PAYMENT_LINK_MIN_AMOUNT.toLocaleString()} and ₦${PAYMENT_LINK_MAX_AMOUNT.toLocaleString()}`, 400);
      }
    }
    if (singleUse && fixedAmount === undefined) {
      throw new AppError('A one-time link needs a fixed amount', 400);
    }

    const link = await PaymentLink.create({
      vendor: vendorId,
      code: await generateLinkCode(profile.slug),
      type: 'PAYMENT',
      title: String(title).trim().slice(0, 120),
      description,
      amount: fixedAmount,
      singleUse: !!singleUse,
    });

    res.status(201).json({ success: true, message: 'Payment link created', data: { link: serializeLink(link) } });
  }

  async getMyLinks(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const vendorId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const filter: any = { vendor: vendorId };
    if (req.query.type === 'PAYMENT' || req.query.type === 'PRODUCT') filter.type = req.query.type;

    const [links, total, totals] = await Promise.all([
      PaymentLink.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('product', 'name images price slug'),
      PaymentLink.countDocuments(filter),
      PaymentLinkPayment.aggregate([
        { $match: { vendor: new mongoose.Types.ObjectId(vendorId), status: { $in: ['HELD', 'RELEASED'] } } },
        { $group: { _id: '$status', net: { $sum: '$netAmount' } } },
      ]),
    ]);

    const profile = await VendorProfile.findOne({ user: vendorId }).select('verifiedAt createdAt');
    const usedToday = await receivedInLast24h(vendorId);
    const dailyLimit = profile ? dailyLimitFor(profile) : 0;

    res.json({
      success: true,
      message: 'Payment links retrieved',
      data: {
        links: links.map(serializeLink),
        summary: {
          heldAmount: totals.find((t) => t._id === 'HELD')?.net || 0,
          releasedAmount: totals.find((t) => t._id === 'RELEASED')?.net || 0,
          dailyLimit,
          receivedLast24h: usedToday,
          feePercent: PAYMENT_LINK_FEE_PERCENT,
          checkoutCommissionPercent: CHECKOUT_LINK_COMMISSION_PERCENT,
          holdHours: PAYMENT_LINK_HOLD_HOURS,
        },
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  }

  async getMyPayments(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const vendorId = req.user!.id;
    const filter: any = { vendor: vendorId };
    if (req.query.linkId && mongoose.Types.ObjectId.isValid(req.query.linkId as string)) {
      filter.link = req.query.linkId;
    }
    const payments = await PaymentLinkPayment.find(filter)
      .sort({ paidAt: -1 })
      .limit(100)
      .populate('link', 'title code type')
      .select('-payer');
    res.json({ success: true, message: 'Payments retrieved', data: { payments } });
  }

  async updateMyLink(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const link = await PaymentLink.findOne({ _id: req.params.id, vendor: req.user!.id });
    if (!link) throw new AppError('Link not found', 404);
    const { status, title, description } = req.body;

    if (status !== undefined) {
      if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new AppError('status must be ACTIVE or INACTIVE', 400);
      if (link.status === 'USED') throw new AppError('This one-time link has already been paid', 400);
      if (status === 'ACTIVE' && link.deactivatedBy) {
        throw new AppError('This link was disabled by Vendorspot. Contact support.', 403);
      }
      link.status = status;
    }
    if (title !== undefined) link.title = String(title).trim().slice(0, 120);
    if (description !== undefined) link.description = description;
    await link.save();

    res.json({ success: true, message: 'Link updated', data: { link: serializeLink(link) } });
  }

  // ─── Public (buyer) ────────────────────────────────────────────────────────

  async getPublicLink(req: Request, res: Response<ApiResponse>): Promise<void> {
    const link = await PaymentLink.findOne({ code: String(req.params.code).toLowerCase() });
    if (!link) throw new AppError('This link does not exist', 404);

    const profile = await VendorProfile.findOne({ user: link.vendor })
      .select('businessName businessLogo slug verificationStatus isActive');
    const vendorUsable = profile && profile.verificationStatus === 'verified' && profile.isActive !== false;

    let product: any = null;
    if (link.type === 'PRODUCT' && link.product) {
      product = await Product.findById(link.product)
        .select('name slug description price compareAtPrice images quantity status productType variants');
    }

    const available =
      link.status === 'ACTIVE' &&
      !!vendorUsable &&
      (link.type === 'PAYMENT' || (product && product.status === ProductStatus.ACTIVE));

    res.json({
      success: true,
      message: 'Link retrieved',
      data: {
        link: {
          code: link.code,
          type: link.type,
          title: link.title,
          description: link.description,
          amount: link.amount ?? null,
          status: link.status,
          available,
        },
        vendor: profile
          ? { businessName: profile.businessName, logo: profile.businessLogo, slug: profile.slug }
          : null,
        product: product && product.status === ProductStatus.ACTIVE
          ? {
              id: product._id,
              name: product.name,
              slug: product.slug,
              description: product.description,
              price: product.price,
              compareAtPrice: product.compareAtPrice,
              images: product.images,
              inStock: product.productType?.toUpperCase() === 'DIGITAL' || product.quantity > 0,
              hasVariants: Array.isArray(product.variants) && product.variants.length > 0,
            }
          : null,
        limits: { min: PAYMENT_LINK_MIN_AMOUNT, max: PAYMENT_LINK_MAX_AMOUNT },
      },
    });
  }

  async initializePublicPayment(req: Request, res: Response<ApiResponse>): Promise<void> {
    const { name, email, phone, amount, note } = req.body;
    const link = await PaymentLink.findOne({ code: String(req.params.code).toLowerCase(), type: 'PAYMENT' });
    if (!link || link.status !== 'ACTIVE') throw new AppError('This payment link is no longer active', 400);

    const profile = await assertVendorCanUseLinks(link.vendor.toString());

    const payAmount = link.amount ?? Number(amount);
    if (!Number.isFinite(payAmount) || payAmount < PAYMENT_LINK_MIN_AMOUNT || payAmount > PAYMENT_LINK_MAX_AMOUNT) {
      throw new AppError(`Amount must be between ₦${PAYMENT_LINK_MIN_AMOUNT.toLocaleString()} and ₦${PAYMENT_LINK_MAX_AMOUNT.toLocaleString()}`, 400);
    }
    const roundedAmount = Math.round(payAmount * 100) / 100;

    const limit = dailyLimitFor(profile);
    const used = await receivedInLast24h(link.vendor.toString());
    if (used + roundedAmount > limit) {
      logger.warn(`[PaymentLink] Daily limit hit for vendor ${link.vendor}: used ${used}, attempted ${roundedAmount}, limit ${limit}`);
      throw new AppError('This vendor cannot receive this payment right now. Please contact them or try again later.', 400);
    }

    const payer = await findOrCreatePayer({ name, email, phone });
    const reference = generatePaymentReference();

    const snapshot = {
      linkId: link._id.toString(),
      amount: roundedAmount,
      payerId: payer._id.toString(),
      payerName: String(name).trim(),
      payerEmail: String(email).trim().toLowerCase(),
      payerPhone: phone,
      note: note ? String(note).slice(0, 300) : undefined,
    };

    await PendingPayment.create({
      reference,
      userId: payer._id.toString(),
      type: 'payment_link',
      amount: roundedAmount,
      gateway: 'paystack',
      status: 'pending',
      snapshotJson: JSON.stringify(snapshot),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    let paystack: any;
    try {
      paystack = await paystackService.initializePayment({
        email: snapshot.payerEmail,
        amount: Math.round(roundedAmount * 100),
        reference,
        // Paystack appends ?reference=... on return
        callback_url: `${linkUrl(link.code)}/done`,
        metadata: { purpose: 'payment_link', linkId: link._id.toString(), vendorName: profile.businessName },
      });
    } catch (err) {
      await PendingPayment.updateOne({ reference }, { status: 'failed' });
      throw new AppError('Could not start the payment. Please try again.', 502);
    }

    res.json({
      success: true,
      message: 'Payment initialized',
      data: {
        reference,
        amount: roundedAmount,
        authorization_url: paystack.data.authorization_url,
        access_code: paystack.data.access_code,
      },
    });
  }

  async verifyPublicPayment(req: Request, res: Response<ApiResponse>): Promise<void> {
    const { reference } = req.params;
    const pending = await PendingPayment.findOne({ reference, type: 'payment_link' });
    if (!pending) throw new AppError('Payment not found', 404);

    if (pending.status !== 'completed') {
      const verification = await paystackService.verifyPayment(reference).catch(() => null);
      if (verification?.data?.status === 'success') {
        await fulfillPaymentLinkPayment(reference, verification.data.amount / 100);
      }
    }

    let payment = await PaymentLinkPayment.findOne({ reference }).populate('link', 'title code');

    // Payments recorded before chargedAmount existed: fill it from Paystack once
    if (payment && payment.chargedAmount == null) {
      const verification = await paystackService.verifyPayment(reference).catch(() => null);
      if (verification?.data?.status === 'success') {
        payment.chargedAmount = verification.data.amount / 100;
        await payment.save();
      }
    }
    const vendorProfile = payment
      ? await VendorProfile.findOne({ user: payment.vendor }).select('businessName slug businessLogo')
      : null;

    res.json({
      success: true,
      message: payment ? 'Payment successful' : 'Payment not completed',
      data: {
        paid: !!payment,
        reference,
        amount: payment?.amount ?? pending.amount,
        chargedAmount: payment?.chargedAmount ?? null,
        title: (payment?.link as any)?.title,
        vendorName: vendorProfile?.businessName,
        vendorSlug: vendorProfile?.slug,
        vendorLogo: vendorProfile?.businessLogo,
        paidAt: payment?.paidAt,
      },
    });
  }

  // ─── Admin ─────────────────────────────────────────────────────────────────

  async adminListLinks(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const filter: any = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
      const vendorIds = await VendorProfile.find({ businessName: rx }).distinct('user');
      filter.$or = [{ title: rx }, { code: rx }, { vendor: { $in: vendorIds } }];
    }

    const [links, total] = await Promise.all([
      PaymentLink.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PaymentLink.countDocuments(filter),
    ]);
    const profiles = await VendorProfile.find({ user: { $in: links.map((l) => l.vendor) } }).select('user businessName').lean();
    const nameFor = new Map(profiles.map((p: any) => [p.user.toString(), p.businessName]));

    res.json({
      success: true,
      message: 'Payment links retrieved',
      data: {
        links: links.map((l: any) => ({ ...serializeLink(l), vendorId: l.vendor, vendorName: nameFor.get(l.vendor.toString()) || null, deactivatedReason: l.deactivatedReason })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  }

  async adminListPayments(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const filter: any = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.linkId && mongoose.Types.ObjectId.isValid(req.query.linkId as string)) filter.link = req.query.linkId;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [{ reference: rx }, { payerName: rx }, { payerEmail: rx }];
    }

    const [payments, total, totals] = await Promise.all([
      PaymentLinkPayment.find(filter).sort({ paidAt: -1 }).skip((page - 1) * limit).limit(limit).populate('link', 'title code').lean(),
      PaymentLinkPayment.countDocuments(filter),
      PaymentLinkPayment.aggregate([{ $group: { _id: '$status', amount: { $sum: '$amount' }, fees: { $sum: '$fee' }, count: { $sum: 1 } } }]),
    ]);
    const profiles = await VendorProfile.find({ user: { $in: payments.map((p) => p.vendor) } }).select('user businessName').lean();
    const nameFor = new Map(profiles.map((p: any) => [p.user.toString(), p.businessName]));

    res.json({
      success: true,
      message: 'Payments retrieved',
      data: {
        payments: payments.map((p: any) => ({ ...p, vendorName: nameFor.get(p.vendor.toString()) || null })),
        totals,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  }

  async adminSetLinkStatus(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { status, reason } = req.body;
    if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new AppError('status must be ACTIVE or INACTIVE', 400);
    if (status === 'INACTIVE' && !reason) throw new AppError('A reason is required to disable a link', 400);

    const update = status === 'INACTIVE'
      ? { $set: { status, deactivatedBy: req.user!.id, deactivatedReason: reason } }
      : { $set: { status }, $unset: { deactivatedBy: 1, deactivatedReason: 1 } };
    const link = await PaymentLink.findOneAndUpdate({ _id: req.params.id, status: { $ne: 'USED' } }, update, { new: true });
    if (!link) throw new AppError('Link not found or already used', 404);

    res.json({ success: true, message: `Link ${status === 'ACTIVE' ? 'enabled' : 'disabled'}`, data: { link: serializeLink(link) } });
  }

  async adminReversePayment(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) throw new AppError('A reason is required', 400);
    const payment = await reversePaymentLinkPayment(req.params.id, req.user!.id, String(reason).trim());
    res.json({ success: true, message: 'Payment reversed', data: { payment } });
  }
}

export const paymentLinkController = new PaymentLinkController();
