import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthRequest, ApiResponse, NotificationType, ProductStatus } from '../types';
import { AppError } from '../middleware/error';
import { SalesEvent, SalesEventListing, ISalesEvent } from '../models/SalesEvent';
import Product from '../models/Product';
import VendorProfile from '../models/VendorProfile';
import { generateSlug } from '../utils/helpers';
import { uploadToCloudinary } from '../utils/cloudinary';
import { notificationService } from '../services/notification.service';
import {
  eventPhase,
  acceptingSubmissions,
  minAllowedEventPrice,
  syncSalesEvents,
  refreshProductSnapshots,
} from '../services/sales-event.service';
import { logger } from '../utils/logger';

const isObjectId = (v: string) => /^[a-f\d]{24}$/i.test(v);
const HEX = /^#[0-9a-f]{6}$/i;

function serializeEvent(e: any, extra: Record<string, any> = {}) {
  const obj = typeof e.toObject === 'function' ? e.toObject() : e;
  return {
    ...obj,
    id: obj._id.toString(),
    phase: eventPhase(obj),
    acceptingSubmissions: acceptingSubmissions(obj),
    ...extra,
  };
}

async function findEvent(idOrSlug: string) {
  return isObjectId(idOrSlug) ? SalesEvent.findById(idOrSlug) : SalesEvent.findOne({ slug: idOrSlug.toLowerCase() });
}

async function buildUniqueEventSlug(name: string, excludeId?: string): Promise<string> {
  const base = generateSlug(name) || 'event';
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await SalesEvent.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/** Fields admin may set. Returns a clean $set object or throws on invalid input. */
async function readEventInput(body: any, existing?: ISalesEvent): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  const str = (k: string) => {
    if (body[k] !== undefined) out[k] = body[k] === null ? '' : String(body[k]).trim();
  };
  ['name', 'tagline', 'description', 'vendorMessage', 'badgeText'].forEach(str);

  for (const k of ['themeColor', 'textColor']) {
    if (body[k] !== undefined) {
      if (!HEX.test(body[k])) throw new AppError(`${k} must be a hex colour like #111827`, 400);
      out[k] = body[k];
    }
  }
  for (const k of ['startsAt', 'endsAt', 'submissionDeadline']) {
    if (body[k] !== undefined) {
      if (body[k] === null || body[k] === '') {
        if (k === 'submissionDeadline') out[k] = null;
        else throw new AppError(`${k} is required`, 400);
        continue;
      }
      const d = new Date(body[k]);
      if (isNaN(d.getTime())) throw new AppError(`${k} is not a valid date`, 400);
      out[k] = d;
    }
  }
  if (body.minDiscountPercent !== undefined) {
    const v = Number(body.minDiscountPercent);
    if (!Number.isFinite(v) || v < 0 || v > 90) throw new AppError('minDiscountPercent must be between 0 and 90', 400);
    out.minDiscountPercent = v;
  }
  if (body.isPublished !== undefined) out.isPublished = !!body.isPublished;

  if (body.bannerImage !== undefined) {
    if (typeof body.bannerImage === 'string' && body.bannerImage.startsWith('data:')) {
      out.bannerImage = (await uploadToCloudinary(body.bannerImage, 'sales-events')).url;
    } else {
      out.bannerImage = body.bannerImage || '';
    }
  }

  const startsAt = out.startsAt ?? existing?.startsAt;
  const endsAt = out.endsAt ?? existing?.endsAt;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new AppError('End date must be after the start date', 400);
  }
  const deadline = out.submissionDeadline !== undefined ? out.submissionDeadline : existing?.submissionDeadline;
  if (deadline && endsAt && new Date(deadline) > new Date(endsAt)) {
    throw new AppError('Submission deadline cannot be after the event ends', 400);
  }
  return out;
}

async function businessNames(vendorIds: any[]): Promise<Map<string, string>> {
  const profiles = await VendorProfile.find({ user: { $in: vendorIds } }).select('user businessName slug').lean();
  return new Map(profiles.map((p: any) => [p.user.toString(), p.businessName]));
}

// ================================================================
// PUBLIC
// ================================================================

/** GET /sales-events — published events that have not ended (home banners). */
export const listPublicEvents = async (_req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const now = new Date();
  const events = await SalesEvent.find({ isPublished: true, endsAt: { $gt: now } }).sort({ startsAt: 1 }).lean();
  const counts = await SalesEventListing.aggregate([
    { $match: { event: { $in: events.map((e) => e._id) }, status: 'approved' } },
    { $group: { _id: '$event', n: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c: any) => [c._id.toString(), c.n]));
  res.json({
    success: true,
    message: 'Sales events fetched',
    data: {
      events: events
        .map((e) => serializeEvent(e, { productCount: countMap.get(e._id.toString()) || 0 }))
        .map(({ vendorMessage, createdBy, ...rest }: any) => rest),
    },
  });
};

/** GET /sales-events/:slug */
export const getPublicEvent = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const event = await findEvent(req.params.slug);
  if (!event || !event.isPublished) throw new AppError('Event not found', 404);
  const productCount = await SalesEventListing.countDocuments({ event: event._id, status: 'approved' });
  const { vendorMessage, createdBy, ...rest } = serializeEvent(event, { productCount });
  res.json({ success: true, message: 'Sales event fetched', data: { event: rest } });
};

/** Approved product ids for an event; used by GET /products?salesEvent=<slug|id>. */
export async function approvedProductIdsForEvent(idOrSlug: string): Promise<Types.ObjectId[] | null> {
  const event = await findEvent(idOrSlug);
  if (!event || !event.isPublished) return null;
  const listings = await SalesEventListing.find({ event: event._id, status: 'approved' }).select('product').lean();
  return listings.map((l) => l.product as Types.ObjectId);
}

// ================================================================
// VENDOR
// ================================================================

/** GET /sales-events/vendor/events — open + live events with this vendor's submissions. */
export const vendorListEvents = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const vendorId = req.user!.id;
  const now = new Date();
  const events = await SalesEvent.find({ isPublished: true, endsAt: { $gt: now } }).sort({ startsAt: 1 }).lean();
  const listings = await SalesEventListing.find({ vendor: vendorId, event: { $in: events.map((e) => e._id) } })
    .populate('product', 'name slug images price compareAtPrice status quantity')
    .sort({ createdAt: -1 })
    .lean();

  const byEvent = new Map<string, any[]>();
  for (const l of listings) {
    const k = l.event.toString();
    if (!byEvent.has(k)) byEvent.set(k, []);
    // While applied, product.price IS the event price; show the vendor their real price.
    const p: any = l.product;
    if (p && l.applied && l.originalPrice != null) p.price = l.originalPrice;
    byEvent.get(k)!.push(l);
  }

  res.json({
    success: true,
    message: 'Sales events fetched',
    data: {
      events: events.map((e) => serializeEvent(e, { myListings: byEvent.get(e._id.toString()) || [] })),
    },
  });
};

/** POST /sales-events/vendor/events/:eventId/listings  { productId, eventPrice } */
export const vendorSubmitListing = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const vendorId = req.user!.id;
  const { productId } = req.body;
  const eventPrice = Math.round(Number(req.body.eventPrice));

  if (!productId || !isObjectId(String(productId))) throw new AppError('productId is required', 400);
  if (!Number.isFinite(eventPrice) || eventPrice <= 0) throw new AppError('Enter a valid event price', 400);

  const event = await findEvent(req.params.eventId);
  if (!event || !event.isPublished) throw new AppError('Event not found', 404);
  if (!acceptingSubmissions(event)) throw new AppError('This event is no longer accepting products', 400);

  const product = await Product.findById(productId).select('vendor price status name salesEvent').lean();
  if (!product) throw new AppError('Product not found', 404);
  if (product.vendor.toString() !== vendorId) throw new AppError('Not authorized', 403);
  if (product.status !== ProductStatus.ACTIVE) {
    throw new AppError('Only approved, active products can join an event', 400);
  }

  const existing = await SalesEventListing.findOne({ event: event._id, product: product._id });

  // The product's normal price: if it's already carrying this event's price, use the stored original.
  let basePrice = product.price;
  const carrying: any = (product as any).salesEvent;
  if (carrying?.event) {
    if (carrying.event.toString() !== event._id.toString()) {
      throw new AppError(`This product is currently in the ${carrying.name} event`, 400);
    }
    if (existing?.originalPrice != null) basePrice = existing.originalPrice;
  }

  const maxPrice = minAllowedEventPrice(basePrice, event.minDiscountPercent);
  if (eventPrice >= basePrice || eventPrice > maxPrice) {
    throw new AppError(
      event.minDiscountPercent > 0
        ? `Event price must be at least ${event.minDiscountPercent}% below the normal price (max ${maxPrice})`
        : `Event price must be lower than the normal price (${basePrice})`,
      400
    );
  }

  // One product, one event at a time: block overlapping events.
  const overlapping = await SalesEvent.find({
    _id: { $ne: event._id },
    startsAt: { $lt: event.endsAt },
    endsAt: { $gt: event.startsAt },
  }).select('_id name');
  if (overlapping.length) {
    const clash = await SalesEventListing.findOne({
      product: product._id,
      event: { $in: overlapping.map((e) => e._id) },
      status: { $in: ['pending', 'approved'] },
    }).populate('event', 'name');
    if (clash) {
      throw new AppError(`This product is already in ${(clash.event as any)?.name || 'another event'} during these dates`, 400);
    }
  }

  let listing;
  if (existing) {
    existing.eventPrice = eventPrice;
    existing.status = 'pending'; // any change needs a fresh admin review
    existing.rejectionReason = undefined;
    existing.reviewedAt = undefined;
    existing.reviewedBy = undefined;
    listing = await existing.save();
  } else {
    listing = await SalesEventListing.create({
      event: event._id,
      product: product._id,
      vendor: vendorId,
      eventPrice,
      status: 'pending',
    });
  }

  // A re-submitted listing that was live must drop back to the normal price until re-approved.
  if (listing.applied) syncSalesEvents().catch(() => {});

  res.status(existing ? 200 : 201).json({
    success: true,
    message: 'Submitted for review. You will be notified once it is approved.',
    data: { listing },
  });
};

/** DELETE /sales-events/vendor/listings/:listingId */
export const vendorWithdrawListing = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const listing = await SalesEventListing.findById(req.params.listingId);
  if (!listing) throw new AppError('Listing not found', 404);
  if (listing.vendor.toString() !== req.user!.id) throw new AppError('Not authorized', 403);
  listing.status = 'withdrawn';
  await listing.save();
  await syncSalesEvents();
  res.json({ success: true, message: 'Product removed from the event', data: { listing } });
};

// ================================================================
// ADMIN
// ================================================================

/** GET /admin/sales-events */
export const adminListEvents = async (_req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const events = await SalesEvent.find().sort({ startsAt: -1 }).lean();
  const counts = await SalesEventListing.aggregate([
    { $group: { _id: { event: '$event', status: '$status' }, n: { $sum: 1 } } },
  ]);
  const map = new Map<string, Record<string, number>>();
  for (const c of counts) {
    const k = c._id.event.toString();
    if (!map.has(k)) map.set(k, { pending: 0, approved: 0, rejected: 0, withdrawn: 0 });
    map.get(k)![c._id.status] = c.n;
  }
  res.json({
    success: true,
    message: 'Sales events fetched',
    data: {
      events: events.map((e) =>
        serializeEvent(e, { counts: map.get(e._id.toString()) || { pending: 0, approved: 0, rejected: 0, withdrawn: 0 } })
      ),
    },
  });
};

/** GET /admin/sales-events/:id */
export const adminGetEvent = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const event = await findEvent(req.params.id);
  if (!event) throw new AppError('Event not found', 404);
  res.json({ success: true, message: 'Sales event fetched', data: { event: serializeEvent(event) } });
};

/** POST /admin/sales-events */
export const adminCreateEvent = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const input = await readEventInput(req.body);
  if (!input.name) throw new AppError('Event name is required', 400);
  if (!input.startsAt || !input.endsAt) throw new AppError('Start and end dates are required', 400);
  if (!input.badgeText) input.badgeText = input.name.slice(0, 24);

  const event = await SalesEvent.create({
    ...input,
    slug: await buildUniqueEventSlug(req.body.slug || input.name),
    createdBy: req.user!.id,
  });
  res.status(201).json({ success: true, message: 'Sales event created', data: { event: serializeEvent(event) } });
};

/** PATCH /admin/sales-events/:id */
export const adminUpdateEvent = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const event = await findEvent(req.params.id);
  if (!event) throw new AppError('Event not found', 404);

  const input = await readEventInput(req.body, event);
  if (input.name === '') throw new AppError('Event name is required', 400);
  if (input.badgeText === '') throw new AppError('Badge text is required', 400);
  if (req.body.slug && generateSlug(req.body.slug) !== event.slug) {
    input.slug = await buildUniqueEventSlug(req.body.slug, event._id.toString());
  }

  event.set(input);
  await event.save();

  await refreshProductSnapshots(event);
  await syncSalesEvents();

  res.json({ success: true, message: 'Sales event updated', data: { event: serializeEvent(event) } });
};

/** DELETE /admin/sales-events/:id — restores prices first. */
export const adminDeleteEvent = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const event = await findEvent(req.params.id);
  if (!event) throw new AppError('Event not found', 404);

  await SalesEventListing.updateMany({ event: event._id }, { $set: { status: 'withdrawn' } });
  await event.deleteOne();
  await syncSalesEvents(); // reverts any applied listings (event no longer live)

  const stillApplied = await SalesEventListing.countDocuments({ event: event._id, applied: true });
  if (stillApplied === 0) await SalesEventListing.deleteMany({ event: event._id });
  else logger.warn(`[SalesEvent] ${stillApplied} listing(s) of deleted event ${event._id} still applied; next sync will revert`);

  res.json({ success: true, message: 'Sales event deleted and prices restored' });
};

/** GET /admin/sales-events/:id/listings?status=&search=&page=&limit= */
export const adminListListings = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const event = await findEvent(req.params.id);
  if (!event) throw new AppError('Event not found', 404);

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const filter: any = { event: event._id };
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;

  if (req.query.search) {
    const q = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const products = await Product.find({ name: { $regex: q, $options: 'i' } }).select('_id').limit(500).lean();
    const vendors = await VendorProfile.find({ businessName: { $regex: q, $options: 'i' } }).select('user').limit(200).lean();
    filter.$or = [{ product: { $in: products.map((p) => p._id) } }, { vendor: { $in: vendors.map((v: any) => v.user) } }];
  }

  const [total, listings] = await Promise.all([
    SalesEventListing.countDocuments(filter),
    SalesEventListing.find(filter)
      .populate('product', 'name slug images price compareAtPrice status quantity')
      .populate('vendor', 'firstName lastName email')
      .sort({ status: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const names = await businessNames(listings.map((l: any) => l.vendor?._id).filter(Boolean));
  const rows = listings.map((l: any) => {
    const normalPrice = l.applied && l.originalPrice != null ? l.originalPrice : l.product?.price;
    return {
      ...l,
      businessName: l.vendor ? names.get(l.vendor._id.toString()) : undefined,
      normalPrice,
      discountPercent: normalPrice ? Math.round(((normalPrice - l.eventPrice) / normalPrice) * 100) : 0,
    };
  });

  res.json({
    success: true,
    message: 'Listings fetched',
    data: { listings: rows, total, page, limit, hasMore: page * limit < total },
  });
};

/** PATCH /admin/sales-events/listings/review  { ids: string[], action: 'approve'|'reject', reason? } */
export const adminReviewListings = async (req: AuthRequest, res: Response<ApiResponse>): Promise<void> => {
  const ids: string[] = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id]).filter((v: any) => v && isObjectId(String(v)));
  const action = req.body.action;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

  if (!ids.length) throw new AppError('No listings selected', 400);
  if (action !== 'approve' && action !== 'reject') throw new AppError('action must be approve or reject', 400);
  if (action === 'reject' && !reason) throw new AppError('A reason is required when rejecting', 400);

  const status = action === 'approve' ? 'approved' : 'rejected';
  const listings = await SalesEventListing.find({ _id: { $in: ids }, status: { $ne: 'withdrawn' } })
    .populate('product', 'name')
    .populate('event', 'name slug startsAt endsAt isPublished');

  await SalesEventListing.updateMany(
    { _id: { $in: listings.map((l) => l._id) } },
    {
      $set: {
        status,
        rejectionReason: action === 'reject' ? reason : undefined,
        reviewedBy: req.user!.id,
        reviewedAt: new Date(),
      },
    }
  );

  await syncSalesEvents();

  for (const l of listings) {
    const ev: any = l.event;
    const productName = (l.product as any)?.name || 'Your product';
    const live = ev && eventPhase(ev) === 'live';
    notificationService
      .send({
        userId: l.vendor.toString(),
        type: NotificationType.PROMOTION,
        title: action === 'approve' ? `Approved for ${ev?.name}` : `Not approved for ${ev?.name}`,
        message:
          action === 'approve'
            ? `"${productName}" will sell at your event price during ${ev?.name}.${live ? ' It is live now.' : ''}`
            : `"${productName}" was not approved for ${ev?.name}. Reason: ${reason}`,
        data: { salesEventId: ev?._id?.toString(), screen: 'VendorSalesEvents' },
        referenceId: `sales-event-review-${l._id}-${status}-${Date.now()}`,
      })
      .catch(() => {});
  }

  res.json({
    success: true,
    message: `${listings.length} listing(s) ${status}`,
    data: { updated: listings.length },
  });
};
