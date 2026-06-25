import mongoose from 'mongoose';
import AppSettings from '../models/AppSettings';
import VendorSubscription from '../models/VendorSubscription';
import VendorProfile from '../models/VendorProfile';
import Product from '../models/Product';
import User from '../models/User';
import { PLAN_CONFIG, PlanSlug, getProductLimit } from '../config/plans';
import { ProductStatus } from '../types';
import { sendPlanActivationEmail, sendPlanAssignedEmail } from '../utils/email';
import { logger } from '../utils/logger';

class PlanService {
  // ─── Settings ─────────────────────────────────────────────────────────────

  async getSettings() {
    let settings = await AppSettings.findOne({ key: 'global' });
    if (!settings) {
      settings = await AppSettings.create({
        key: 'global',
        plansEnforced: false,
        freeProductLimit: 6,
      });
    }
    return settings;
  }

  // ─── Impact Preview (dry run, no changes) ─────────────────────────────────

  async getImpactPreview() {
    const settings = await this.getSettings();
    const limit = settings.freeProductLimit;

    // All vendor profiles
    const allVendors = await VendorProfile.find({}).select('_id user').lean();

    // All existing subscriptions
    const allSubs = await VendorSubscription.find({}).select('vendor user plan status').lean();
    const subByVendorId = new Map(allSubs.map(s => [s.vendor.toString(), s]));

    let affectedVendors = 0;
    let productsToDeactivate = 0;
    const affectedList: Array<{ vendorId: string; businessName?: string; activeProducts: number; toDeactivate: number }> = [];

    for (const vendor of allVendors) {
      const sub = subByVendorId.get(vendor._id.toString());
      // Treat as free if no subscription or subscription is free
      if (sub && sub.plan !== 'free') continue;

      const activeCount = await Product.countDocuments({
        vendor: vendor.user,
        status: ProductStatus.ACTIVE,
      });

      if (activeCount > limit) {
        const excess = activeCount - limit;
        affectedVendors++;
        productsToDeactivate += excess;
        affectedList.push({ vendorId: vendor._id.toString(), activeProducts: activeCount, toDeactivate: excess });
      }
    }

    // Enrich with business names
    if (affectedList.length > 0) {
      const profiles = await VendorProfile.find(
        { _id: { $in: affectedList.map(a => a.vendorId) } }
      ).select('_id businessName').lean();
      const nameMap = new Map(profiles.map(p => [p._id.toString(), (p as any).businessName]));
      affectedList.forEach(a => { a.businessName = nameMap.get(a.vendorId); });
    }

    // Subscription count breakdown
    const subCounts = await VendorSubscription.aggregate([
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]);
    const planCounts: Record<string, number> = { free: 0, growth: 0, pro: 0 };
    subCounts.forEach(s => { planCounts[s._id] = s.count; });
    // Vendors without a subscription record are free
    const noSubCount = allVendors.length - allSubs.length;
    planCounts.free += noSubCount;

    return {
      plansEnforced: settings.plansEnforced,
      totalVendors: allVendors.length,
      freeProductLimit: limit,
      planCounts,
      affectedVendors,
      productsToDeactivate,
      affectedList: affectedList.slice(0, 50), // cap preview list
    };
  }

  // ─── Activate ─────────────────────────────────────────────────────────────

  async activatePlans(adminId: string) {
    const settings = await this.getSettings();

    if (settings.plansEnforced) {
      return { alreadyActive: true, message: 'Plans are already enforced' };
    }

    settings.plansEnforced = true;
    settings.plansActivatedAt = new Date();
    settings.plansActivatedBy = new mongoose.Types.ObjectId(adminId);
    await settings.save();

    // Ensure every vendor has a subscription record
    const syncResult = await this.syncAllSubscriptions();

    // Deactivate excess products for free-plan vendors and send emails
    const enforceResult = await this._enforceProductLimits(settings.freeProductLimit);

    logger.info(`Plans activated by admin ${adminId}`, { syncResult, enforceResult });

    return {
      activated: true,
      subscriptionsSynced: syncResult.created,
      affectedVendors: enforceResult.affectedVendors,
      totalDeactivated: enforceResult.totalDeactivated,
      emailsSent: enforceResult.emailsSent,
      emailErrors: enforceResult.emailErrors,
    };
  }

  // ─── Deactivate ───────────────────────────────────────────────────────────

  async deactivatePlans(adminId: string) {
    const settings = await this.getSettings();
    settings.plansEnforced = false;
    settings.plansDeactivatedAt = new Date();
    settings.plansDeactivatedBy = new mongoose.Types.ObjectId(adminId);
    await settings.save();
    logger.info(`Plans deactivated by admin ${adminId}`);
    return { deactivated: true };
  }

  // ─── Sync ─────────────────────────────────────────────────────────────────

  async syncAllSubscriptions() {
    const allVendors = await VendorProfile.find({}).select('_id user').lean();
    let created = 0;

    for (const vendor of allVendors) {
      const existing = await VendorSubscription.findOne({ vendor: vendor._id });
      if (!existing) {
        await VendorSubscription.create({
          vendor: vendor._id,
          user: vendor.user,
          plan: 'free',
          billingCycle: null,
          status: 'active',
          amount: 0,
          assignedByAdmin: false,
        });
        created++;
      }
    }

    return { total: allVendors.length, created };
  }

  // ─── Enforce product limits (called on activation) ────────────────────────

  private async _enforceProductLimits(limit: number) {
    // Get all free subscriptions
    const freeSubs = await VendorSubscription.find({ plan: 'free', status: 'active' })
      .select('vendor user')
      .lean();

    let affectedVendors = 0;
    let totalDeactivated = 0;
    let emailsSent = 0;
    const emailErrors: string[] = [];

    for (const sub of freeSubs) {
      // Products are keyed by User._id (sub.user), not VendorProfile._id
      const activeProducts = await Product.find({
        vendor: sub.user,
        status: ProductStatus.ACTIVE,
      })
        .sort({ totalSales: -1, views: -1, createdAt: -1 })
        .select('_id name totalSales')
        .lean();

      if (activeProducts.length <= limit) continue;

      // Keep top N by sales; deactivate the rest
      const toDeactivate = activeProducts.slice(limit);
      const deactivateIds = toDeactivate.map(p => p._id);

      await Product.updateMany(
        { _id: { $in: deactivateIds } },
        { $set: { status: ProductStatus.INACTIVE } }
      );

      affectedVendors++;
      totalDeactivated += toDeactivate.length;

      // Look up vendor profile for business name
      const profile = await VendorProfile.findOne({ user: sub.user })
        .select('businessName')
        .lean();

      // Send email
      const user = await User.findById(sub.user).select('email firstName lastName').lean();
      if (user?.email) {
        try {
          await sendPlanActivationEmail(
            user.email,
            (user as any).firstName || 'Vendor',
            (profile as any)?.businessName || 'Your Store',
            toDeactivate.map(p => ({ name: (p as any).name, id: p._id.toString() })),
            limit
          );
          emailsSent++;
        } catch (err) {
          emailErrors.push(user.email);
          logger.error(`Failed to send plan activation email to ${user.email}`, err);
        }
      }
    }

    return { affectedVendors, totalDeactivated, emailsSent, emailErrors };
  }

  // ─── Assign plan manually ─────────────────────────────────────────────────

  async assignPlanToVendor(
    vendorProfileId: string,
    plan: PlanSlug,
    billingCycle: 'monthly' | 'yearly' | null,
    adminId: string,
    reason?: string
  ) {
    const planConfig = PLAN_CONFIG[plan];

    const vendorProfile = await VendorProfile.findById(vendorProfileId)
      .populate('user', 'email firstName lastName')
      .lean();
    if (!vendorProfile) throw new Error('Vendor profile not found');

    let sub = await VendorSubscription.findOne({ vendor: vendorProfileId });
    const previousPlan = sub?.plan || 'free';
    const now = new Date();

    let periodEnd: Date | undefined;
    if (plan !== 'free' && billingCycle) {
      periodEnd = new Date(now);
      if (billingCycle === 'monthly') periodEnd.setMonth(periodEnd.getMonth() + 1);
      else periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    const amount = plan === 'free' ? 0 : (billingCycle ? planConfig.price[billingCycle] : 0);

    if (sub) {
      // Archive current plan in history
      sub.history.push({
        plan: sub.plan,
        billingCycle: sub.billingCycle,
        startDate: sub.currentPeriodStart || sub.createdAt,
        endDate: now,
        amount: sub.amount,
        reason: `Superseded — admin assigned ${plan}`,
      });

      sub.plan = plan;
      sub.billingCycle = billingCycle;
      sub.status = 'active';
      sub.currentPeriodStart = now;
      sub.currentPeriodEnd = periodEnd;
      sub.amount = amount;
      sub.assignedByAdmin = true;
      sub.assignedBy = new mongoose.Types.ObjectId(adminId);
      sub.cancelAtPeriodEnd = false;
      sub.cancelledAt = undefined;
      await sub.save();
    } else {
      const userId = (vendorProfile as any).user?._id || (vendorProfile as any).user;
      sub = await VendorSubscription.create({
        vendor: vendorProfileId,
        user: userId,
        plan,
        billingCycle,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        amount,
        assignedByAdmin: true,
        assignedBy: new mongoose.Types.ObjectId(adminId),
      });
    }

    // Update commission rate on VendorProfile
    await VendorProfile.findByIdAndUpdate(vendorProfileId, {
      commissionRate: planConfig.commissionRate,
    });

    // If upgrading from free and plans are enforced, re-activate any inactive products (up to plan limit)
    const settings = await this.getSettings();
    if (settings.plansEnforced && previousPlan === 'free' && plan !== 'free') {
      const userId = (vendorProfile as any).user?._id || (vendorProfile as any).user;
      await Product.updateMany(
        { vendor: userId, status: ProductStatus.INACTIVE },
        { $set: { status: ProductStatus.ACTIVE } }
      );
    }

    // Email the vendor about their new plan
    const user = (vendorProfile as any).user as any;
    if (user?.email) {
      try {
        await sendPlanAssignedEmail(
          user.email,
          user.firstName || 'Vendor',
          (vendorProfile as any).businessName || 'Your Store',
          plan,
          previousPlan,
          reason
        );
      } catch (err) {
        logger.error(`Failed to send plan assigned email to ${user.email}`, err);
      }
    }

    return sub;
  }

  // ─── Get subscriptions (paginated) ────────────────────────────────────────

  async getSubscriptions(
    page: number,
    limit: number,
    plan?: string,
    status?: string,
    search?: string
  ) {
    const filter: Record<string, any> = {};
    if (plan && ['free', 'growth', 'pro'].includes(plan)) filter.plan = plan;
    if (status) filter.status = status;

    const total = await VendorSubscription.countDocuments(filter);
    const skip = (page - 1) * limit;

    const subs = await VendorSubscription.find(filter)
      .populate({
        path: 'vendor',
        select: 'businessName businessEmail businessLogo averageRating totalSales totalOrders commissionRate',
      })
      .populate({ path: 'user', select: 'email firstName lastName' })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Apply search filter post-populate
    const results = search
      ? subs.filter(s => {
          const v = s.vendor as any;
          const u = s.user as any;
          const q = search.toLowerCase();
          return (
            v?.businessName?.toLowerCase().includes(q) ||
            u?.email?.toLowerCase().includes(q) ||
            u?.firstName?.toLowerCase().includes(q) ||
            u?.lastName?.toLowerCase().includes(q)
          );
        })
      : subs;

    return {
      subscriptions: results,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  // ─── Check if vendor can add a product ────────────────────────────────────
  // Pass the User._id (same as Product.vendor field)

  async canVendorAddProduct(userId: string): Promise<{
    allowed: boolean;
    reason?: string;
    limit?: number;
    current?: number;
    plan?: string;
  }> {
    const settings = await this.getSettings();
    if (!settings.plansEnforced) return { allowed: true };

    // Find subscription via user (fast path)
    const sub = await VendorSubscription.findOne({
      user: new mongoose.Types.ObjectId(userId),
    }).select('plan status');

    const plan = (sub?.plan || 'free') as PlanSlug;
    const limit = getProductLimit(plan);

    if (limit === null) return { allowed: true, plan }; // unlimited

    const current = await Product.countDocuments({
      vendor: new mongoose.Types.ObjectId(userId),
      status: ProductStatus.ACTIVE,
    });

    if (current >= limit) {
      return {
        allowed: false,
        reason: `Your ${PLAN_CONFIG[plan].name} allows up to ${limit} active products. Upgrade to list more.`,
        limit,
        current,
        plan,
      };
    }

    return { allowed: true, limit, current, plan };
  }

  // ─── Get plan info for authenticated vendor (mobile app) ─────────────────

  async getVendorPlanForUser(userId: string) {
    const profile = await VendorProfile.findOne({ user: userId }).select('_id').lean();
    const sub = profile
      ? await VendorSubscription.findOne({ vendor: profile._id })
          .select('plan billingCycle status currentPeriodEnd amount')
          .lean()
      : null;

    const plan = ((sub?.plan as PlanSlug) || 'free');
    const settings = await this.getSettings();
    const productLimit = getProductLimit(plan);

    const currentActiveProducts = await Product.countDocuments({
      vendor: new mongoose.Types.ObjectId(userId),
      status: ProductStatus.ACTIVE,
    });

    return {
      plan,
      plansEnforced: settings.plansEnforced,
      productLimit,
      currentActiveProducts,
      subscription: sub
        ? { billingCycle: sub.billingCycle, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, amount: sub.amount }
        : null,
      planConfig: PLAN_CONFIG[plan],
      allPlans: PLAN_CONFIG,
    };
  }

  // ─── Get a single vendor's subscription ───────────────────────────────────

  async getVendorSubscription(vendorProfileId: string) {
    const sub = await VendorSubscription.findOne({ vendor: vendorProfileId })
      .populate({ path: 'vendor', select: 'businessName businessEmail commissionRate' })
      .populate({ path: 'user', select: 'email firstName lastName' })
      .lean();

    if (!sub) {
      // Return a virtual free subscription
      return { plan: 'free', status: 'active', billingCycle: null, amount: 0, synced: false };
    }

    return { ...sub, synced: true };
  }
}

export default new PlanService();
