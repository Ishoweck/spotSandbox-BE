import { Request, Response } from 'express';
import planService from '../services/plan.service';
import { PLAN_CONFIG, PlanSlug } from '../config/plans';

// GET /admin/plans/settings
export const getPlansSettings = async (req: Request, res: Response) => {
  try {
    const settings = await planService.getSettings();
    res.json({ success: true, data: { settings, planConfig: PLAN_CONFIG } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /admin/plans/impact
// Dry-run: shows how many vendors/products would be affected if enforcement is turned on
export const getPlansImpact = async (req: Request, res: Response) => {
  try {
    const impact = await planService.getImpactPreview();
    res.json({ success: true, data: impact });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /admin/plans/activate
export const activatePlans = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).user.id;
    const result = await planService.activatePlans(adminId);
    res.json({
      success: true,
      data: result,
      message: result.alreadyActive
        ? 'Plans are already enforced'
        : `Plans activated. ${result.affectedVendors} vendors affected, ${result.totalDeactivated} products deactivated.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /admin/plans/deactivate
export const deactivatePlans = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).user.id;
    const result = await planService.deactivatePlans(adminId);
    res.json({ success: true, data: result, message: 'Plan enforcement disabled. All vendors now have unlimited access.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /admin/plans/subscriptions?page=1&limit=20&plan=free&status=active&search=
export const getSubscriptions = async (req: Request, res: Response) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 20);
    const { plan, status, search } = req.query;

    const result = await planService.getSubscriptions(
      page, limit,
      plan as string | undefined,
      status as string | undefined,
      search as string | undefined
    );

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /admin/plans/vendors/:vendorId
// Body: { plan: 'free'|'growth'|'pro', billingCycle?: 'monthly'|'yearly', reason?: string }
export const assignVendorPlan = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { plan, billingCycle, reason } = req.body;
    const adminId = (req as any).user.id;

    if (!['free', 'growth', 'pro'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Invalid plan. Must be: free, growth, or pro' });
    }

    if (plan !== 'free' && !['monthly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ success: false, message: 'billingCycle is required for paid plans (monthly or yearly)' });
    }

    const sub = await planService.assignPlanToVendor(
      vendorId,
      plan as PlanSlug,
      plan === 'free' ? null : billingCycle,
      adminId,
      reason
    );

    const config = PLAN_CONFIG[plan as PlanSlug];
    res.json({
      success: true,
      data: sub,
      message: `Vendor assigned to ${config.name} successfully`,
    });
  } catch (err: any) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ success: false, message: err.message });
  }
};

// POST /admin/plans/sync
// Ensures every VendorProfile has a VendorSubscription record (default: free)
export const syncSubscriptions = async (req: Request, res: Response) => {
  try {
    const result = await planService.syncAllSubscriptions();
    res.json({
      success: true,
      data: result,
      message: `Sync complete. ${result.created} new subscription records created out of ${result.total} vendors.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /admin/plans/vendors/:vendorId
export const getVendorSubscription = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const sub = await planService.getVendorSubscription(vendorId);
    res.json({ success: true, data: sub });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
