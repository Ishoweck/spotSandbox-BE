import VendorProfile from '../models/VendorProfile';
import VendorReminderLog from '../models/VendorReminderLog';
import VendorSubscription from '../models/VendorSubscription';
import Product from '../models/Product';
import { enqueueEmail } from '../queues/email.queue';
import { EmailJobType } from '../queues/email.queue';
import { VendorVerificationStatus, ProductStatus } from '../types';
import { logger } from './logger';
import { Types } from 'mongoose';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vendorspotng.com';

async function sendIfNew(
  vendorId: Types.ObjectId,
  type: EmailJobType,
  to: string,
  firstName: string,
  meta?: Record<string, any>,
): Promise<boolean> {
  try {
    await VendorReminderLog.create({ vendor: vendorId, type });
  } catch (err: any) {
    if (err?.code === 11000) return false;
    throw err;
  }
  await enqueueEmail(type, to, firstName, 0, meta);
  return true;
}

async function checkKycReminder(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    verifiedAt: { $lte: cutoff },
    'kycDocuments.0': { $exists: false },
  }).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  for (const vendor of vendors) {
    try {
      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_KYC_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkKycReminder failed for vendor ${vendor._id}:`, err);
    }
  }
}

async function checkKycPendingReminder(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 3 * DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    'kycDocuments.verificationStatus': 'pending',
    updatedAt: { $lte: cutoff },
  }).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  for (const vendor of vendors) {
    try {
      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_KYC_PENDING_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkKycPendingReminder failed for vendor ${vendor._id}:`, err);
    }
  }
}

async function checkFirstProductReminder(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    verifiedAt: { $lte: cutoff },
  }).limit(500).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  await Promise.all(vendors.map(async (vendor) => {
    try {
      const productCount = await Product.countDocuments({ vendor: vendor.user._id });
      if (productCount > 0) return;
      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_FIRST_PRODUCT_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkFirstProductReminder failed for vendor ${vendor._id}:`, err);
    }
  }));
}

async function checkFirstProductFollowup(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 3 * DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    verifiedAt: { $lte: cutoff },
  }).limit(500).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  await Promise.all(vendors.map(async (vendor) => {
    try {
      const productCount = await Product.countDocuments({ vendor: vendor.user._id });
      if (productCount > 0) return;
      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_FIRST_PRODUCT_FOLLOWUP,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkFirstProductFollowup failed for vendor ${vendor._id}:`, err);
    }
  }));
}

async function checkCompleteProfileReminder(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 2 * DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    verifiedAt: { $lte: cutoff },
  }).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  for (const vendor of vendors) {
    try {
      const missing: string[] = [];
      if (!vendor.businessDescription) missing.push('Store description');
      if (!vendor.businessLogo) missing.push('Store logo');
      if (!vendor.businessBanner) missing.push('Store banner image');
      if (missing.length === 0) continue;

      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_COMPLETE_PROFILE_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName, missing },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkCompleteProfileReminder failed for vendor ${vendor._id}:`, err);
    }
  }
}

async function checkPayoutDetailsReminder(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 2 * DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    verifiedAt: { $lte: cutoff },
    'payoutDetails.accountNumber': { $exists: false },
  }).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  for (const vendor of vendors) {
    try {
      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_PAYOUT_DETAILS_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkPayoutDetailsReminder failed for vendor ${vendor._id}:`, err);
    }
  }
}

async function checkNoSalesReminder(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 7 * DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    verifiedAt: { $lte: cutoff },
    totalOrders: 0,
  }).limit(500).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  await Promise.all(vendors.map(async (vendor) => {
    try {
      const activeProducts = await Product.countDocuments({
        vendor: vendor.user._id,
        status: ProductStatus.ACTIVE,
      });
      if (activeProducts === 0) return;

      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_NO_SALES_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkNoSalesReminder failed for vendor ${vendor._id}:`, err);
    }
  }));
}

async function checkEnableAffiliateReminder(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 7 * DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    verifiedAt: { $lte: cutoff },
  }).limit(500).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  await Promise.all(vendors.map(async (vendor) => {
    try {
      const [activeProducts, hasAffiliate] = await Promise.all([
        Product.countDocuments({ vendor: vendor.user._id, status: ProductStatus.ACTIVE }),
        Product.exists({ vendor: vendor.user._id, isAffiliate: true }),
      ]);
      if (activeProducts === 0 || hasAffiliate) return;

      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_ENABLE_AFFILIATE_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkEnableAffiliateReminder failed for vendor ${vendor._id}:`, err);
    }
  }));
}

async function checkShareStoreReminder(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 2 * DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
    verifiedAt: { $lte: cutoff },
    totalOrders: 0,
  }).limit(500).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  await Promise.all(vendors.map(async (vendor) => {
    try {
      const activeProducts = await Product.countDocuments({
        vendor: vendor.user._id,
        status: ProductStatus.ACTIVE,
      });
      if (activeProducts === 0) return;

      const storeLink = `${FRONTEND_URL}/shops/${vendor._id}`;
      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_SHARE_STORE_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName, storeLink },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkShareStoreReminder failed for vendor ${vendor._id}:`, err);
    }
  }));
}

async function checkInactiveReminder(now: Date): Promise<void> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);
  const vendors = await VendorProfile.find({
    verificationStatus: VendorVerificationStatus.VERIFIED,
  }).limit(500).populate<{ user: { _id: Types.ObjectId; email: string; firstName: string } }>(
    'user',
    'email firstName _id',
  );

  await Promise.all(vendors.map(async (vendor) => {
    try {
      const [totalProducts, recentProduct] = await Promise.all([
        Product.countDocuments({ vendor: vendor.user._id }),
        Product.exists({ vendor: vendor.user._id, createdAt: { $gte: thirtyDaysAgo } }),
      ]);
      if (totalProducts === 0 || recentProduct) return;

      await sendIfNew(
        vendor._id as Types.ObjectId,
        EmailJobType.VENDOR_INACTIVE_REMINDER,
        vendor.user.email,
        vendor.user.firstName,
        { businessName: vendor.businessName },
      );
    } catch (err) {
      logger.error(`[VendorReminders] checkInactiveReminder failed for vendor ${vendor._id}:`, err);
    }
  }));
}

async function checkSubscriptionExpiry(now: Date): Promise<void> {
  const expiryDays = [7, 3, 1] as const;
  const jobTypeMap: Record<number, EmailJobType> = {
    7: EmailJobType.VENDOR_SUBSCRIPTION_EXPIRY_7D,
    3: EmailJobType.VENDOR_SUBSCRIPTION_EXPIRY_3D,
    1: EmailJobType.VENDOR_SUBSCRIPTION_EXPIRY_1D,
  };

  for (const daysLeft of expiryDays) {
    const windowStart = new Date(now.getTime() + (daysLeft - 1) * DAY);
    const windowEnd   = new Date(now.getTime() + daysLeft * DAY);

    const subscriptions = await VendorSubscription.find({
      plan: { $in: ['growth', 'pro'] },
      status: 'active',
      currentPeriodEnd: { $gte: windowStart, $lt: windowEnd },
    }).populate<{ vendor: { _id: Types.ObjectId; businessName: string; user: { _id: Types.ObjectId; email: string; firstName: string } } }>(
      { path: 'vendor', populate: { path: 'user', select: 'email firstName _id' } },
    );

    for (const sub of subscriptions) {
      try {
        const vendor = sub.vendor;
        if (!vendor || !vendor.user) continue;

        const planLabel = sub.plan === 'pro' ? 'Pro Plan' : 'Growth Plan';
        const expiryDate = sub.currentPeriodEnd
          ? sub.currentPeriodEnd.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
          : '';

        await sendIfNew(
          vendor._id as Types.ObjectId,
          jobTypeMap[daysLeft],
          vendor.user.email,
          vendor.user.firstName,
          { planName: planLabel, daysLeft, expiryDate },
        );
      } catch (err) {
        logger.error(`[VendorReminders] checkSubscriptionExpiry (${daysLeft}d) failed for sub ${sub._id}:`, err);
      }
    }
  }
}

async function runVendorReminders(): Promise<void> {
  const now = new Date();

  await checkKycReminder(now);
  await checkKycPendingReminder(now);
  await checkFirstProductReminder(now);
  await checkFirstProductFollowup(now);
  await checkCompleteProfileReminder(now);
  await checkPayoutDetailsReminder(now);
  await checkNoSalesReminder(now);
  await checkEnableAffiliateReminder(now);
  await checkShareStoreReminder(now);
  await checkInactiveReminder(now);
  await checkSubscriptionExpiry(now);
}

export function setupVendorReminders(): void {
  logger.info('[VendorReminders] Vendor reminder scheduler started (daily)');
  runVendorReminders().catch(err =>
    logger.error('[VendorReminders] Startup run failed:', err.message),
  );
  setInterval(() => {
    runVendorReminders().catch(err =>
      logger.error('[VendorReminders] Interval run failed:', err.message),
    );
  }, CHECK_INTERVAL_MS);
}
