import { Types } from 'mongoose';
import Product from '../models/Product';
import { SalesEvent, SalesEventListing, ISalesEvent, ISalesEventListing } from '../models/SalesEvent';
import { notificationService } from './notification.service';
import { NotificationType } from '../types';
import { logger } from '../utils/logger';

/**
 * Event pricing works by swapping the product's real price while the event is
 * live: price <- eventPrice, compareAtPrice <- original price. Every existing
 * surface (cards, detail, cart resync, checkout) already reads product.price,
 * so nothing downstream needs to know about events. The originals live on the
 * listing and are restored when the event ends, is unpublished, or the listing
 * is withdrawn/rejected.
 *
 * All product writes are conditional (filter on current state) so a re-run, a
 * second server instance or a concurrent vendor edit cannot double-apply.
 */

export type SalesEventPhase = 'draft' | 'upcoming' | 'live' | 'ended';

export function eventPhase(event: Pick<ISalesEvent, 'isPublished' | 'startsAt' | 'endsAt'>, now = new Date()): SalesEventPhase {
  if (!event.isPublished) return 'draft';
  if (now < new Date(event.startsAt)) return 'upcoming';
  if (now >= new Date(event.endsAt)) return 'ended';
  return 'live';
}

/** Vendors can submit while the event is published and has not ended (and before the deadline, if set). */
export function acceptingSubmissions(event: ISalesEvent, now = new Date()): boolean {
  const phase = eventPhase(event, now);
  if (phase !== 'upcoming' && phase !== 'live') return false;
  if (event.submissionDeadline && now > new Date(event.submissionDeadline)) return false;
  return true;
}

export function minAllowedEventPrice(basePrice: number, minDiscountPercent: number): number {
  // Highest price that still satisfies the minimum discount
  return Math.floor(basePrice * (1 - (minDiscountPercent || 0) / 100));
}

async function applyListing(listing: ISalesEventListing, event: ISalesEvent): Promise<void> {
  const product = await Product.findById(listing.product).select('price compareAtPrice salesEvent vendor name').lean();
  if (!product) {
    await SalesEventListing.updateOne({ _id: listing._id }, { $set: { status: 'withdrawn', applied: false } });
    return;
  }

  const current: any = (product as any).salesEvent;
  if (current?.event) {
    // Already carrying this event's price (a previous run died before marking the listing): just record it.
    if (current.event.toString() === event._id.toString()) {
      await SalesEventListing.updateOne({ _id: listing._id }, { $set: { applied: true, appliedAt: listing.appliedAt || new Date() } });
    }
    // Carrying another event's price: wait until that one is reverted.
    return;
  }

  if (listing.eventPrice >= product.price) {
    await SalesEventListing.updateOne(
      { _id: listing._id },
      {
        $set: {
          status: 'rejected',
          rejectionReason: `Event price (${listing.eventPrice}) is no longer below the product price (${product.price}).`,
          reviewedAt: new Date(),
        },
      }
    );
    notificationService
      .send({
        userId: listing.vendor.toString(),
        type: NotificationType.PROMOTION,
        title: `${event.name}: listing removed`,
        message: `"${product.name}" was taken out of ${event.name} because its event price is no longer lower than its normal price. You can resubmit it with a new event price.`,
        data: { salesEventId: event._id.toString(), screen: 'VendorSalesEvents' },
      })
      .catch(() => {});
    return;
  }

  // Record the originals first so a crash after the product write can still be reverted.
  await SalesEventListing.updateOne(
    { _id: listing._id },
    { $set: { originalPrice: product.price, originalCompareAtPrice: product.compareAtPrice ?? null } }
  );

  const res = await Product.updateOne(
    { _id: product._id, price: product.price, $or: [{ salesEvent: null }, { salesEvent: { $exists: false } }] },
    {
      $set: {
        price: listing.eventPrice,
        compareAtPrice: product.price,
        isFlashSale: true,
        flashSaleEndsAt: event.endsAt,
        salesEvent: {
          event: event._id,
          name: event.name,
          slug: event.slug,
          badgeText: event.badgeText,
          themeColor: event.themeColor,
          textColor: event.textColor,
          endsAt: event.endsAt,
        },
      },
    }
  );

  if (res.modifiedCount === 1) {
    await SalesEventListing.updateOne({ _id: listing._id }, { $set: { applied: true, appliedAt: new Date() } });
    logger.info(`[SalesEvent] Applied ${event.slug} price to product ${product._id}`);
  }
  // modifiedCount 0 => product changed under us; next sync retries with fresh values.
}

export async function revertListing(listing: ISalesEventListing): Promise<void> {
  if (!listing.applied) return;
  if (listing.originalPrice != null) {
    await Product.updateOne(
      { _id: listing.product, 'salesEvent.event': listing.event },
      {
        $set: {
          price: listing.originalPrice,
          compareAtPrice: listing.originalCompareAtPrice ?? null,
          isFlashSale: false,
          flashSaleEndsAt: null,
          salesEvent: null,
        },
      }
    );
  }
  await SalesEventListing.updateOne({ _id: listing._id }, { $set: { applied: false } });
  logger.info(`[SalesEvent] Reverted product ${listing.product} for event ${listing.event}`);
}

/** Refresh the badge snapshot on products after admin edits the event's name/colours/dates. */
export async function refreshProductSnapshots(event: ISalesEvent): Promise<void> {
  await Product.updateMany(
    { 'salesEvent.event': event._id },
    {
      $set: {
        'salesEvent.name': event.name,
        'salesEvent.slug': event.slug,
        'salesEvent.badgeText': event.badgeText,
        'salesEvent.themeColor': event.themeColor,
        'salesEvent.textColor': event.textColor,
        'salesEvent.endsAt': event.endsAt,
        flashSaleEndsAt: event.endsAt,
      },
    }
  );
}

let running = false;

/** Bring every product's price in line with event state. Safe to call any time. */
export async function syncSalesEvents(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const liveEvents = await SalesEvent.find({ isPublished: true, startsAt: { $lte: now }, endsAt: { $gt: now } });
    const liveIds = liveEvents.map((e) => e._id as Types.ObjectId);

    // 1. Revert anything applied that should not be (event over/unpublished/deleted, or listing no longer approved)
    const toRevert = await SalesEventListing.find({
      applied: true,
      $or: [{ event: { $nin: liveIds } }, { status: { $ne: 'approved' } }],
    });
    for (const l of toRevert) {
      await revertListing(l).catch((err) => logger.error('[SalesEvent] revert failed', { error: err.message, listing: l._id }));
    }

    // 2. Apply approved listings of live events
    for (const event of liveEvents) {
      const pending = await SalesEventListing.find({ event: event._id, status: 'approved', applied: false });
      for (const l of pending) {
        await applyListing(l, event).catch((err) => logger.error('[SalesEvent] apply failed', { error: err.message, listing: l._id }));
      }
    }
  } finally {
    running = false;
  }
}

const CHECK_INTERVAL_MS = 60 * 1000;

export function setupSalesEventScheduler(): void {
  logger.info('[SalesEvent] scheduler started');
  syncSalesEvents().catch((err) => logger.error('[SalesEvent] startup sync failed', { error: err.message }));
  setInterval(() => {
    syncSalesEvents().catch((err) => logger.error('[SalesEvent] sync failed', { error: err.message }));
  }, CHECK_INTERVAL_MS);
}
