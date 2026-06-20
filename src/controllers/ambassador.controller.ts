import crypto from 'crypto';
import { Request, Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import Ambassador from '../models/Ambassador';
import AmbassadorReferral from '../models/AmbassadorReferral';
import User from '../models/User';
import { Wallet } from '../models/Additional';
import { AppError, asyncHandler } from '../middleware/error';
import { sendAmbassadorApprovalEmail } from '../utils/email';
import { logger } from '../utils/logger';

// ─── Tier rate lookup ──────────────────────────────────────────────────────────
// Vendors 1-50: ₦150, 51-100: ₦250, 101-200: ₦300
export function getTierRate(ordinalPosition: number): number {
  if (ordinalPosition <= 50) return 150;
  if (ordinalPosition <= 100) return 250;
  return 300;
}

// ─── Generate unique ambassador code (AMB-XXXX) ───────────────────────────────
async function generateAmbassadorCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const code = `AMB-${suffix}`;
  const exists = await Ambassador.findOne({ ambassadorCode: code });
  if (exists) return generateAmbassadorCode();
  return code;
}

// ─── Public: Submit application from website ──────────────────────────────────
export const submitApplication = asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
  const { name, email, phone, role, location, social, why } = req.body;

  if (!name || !email || !role || !location || !why) {
    throw new AppError('Missing required fields', 400);
  }

  const existing = await Ambassador.findOne({ email: email.toLowerCase(), status: 'pending' });
  if (existing) {
    res.json({ success: true, message: 'Application received' });
    return;
  }

  await Ambassador.create({ name, email, phone, role, location, social, why });

  logger.info(`Ambassador application received: ${email}`);
  res.status(201).json({ success: true, message: 'Application received successfully' });
});

// ─── Public: Verify invite token before signup ────────────────────────────────
export const verifyInvite = asyncHandler(async (req: Request, res: Response<ApiResponse>) => {
  const { token } = req.query as { token: string };
  if (!token) throw new AppError('Token is required', 400);

  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const ambassador = await Ambassador
    .findOne({ inviteToken: hashed, inviteTokenExpires: { $gt: new Date() }, status: 'approved' })
    .select('name email ambassadorCode role');

  if (!ambassador) throw new AppError('Invalid or expired invite link', 400);

  if (ambassador.userId) throw new AppError('This invite has already been used', 400);

  res.json({
    success: true,
    data: {
      name: ambassador.name,
      email: ambassador.email,
      ambassadorCode: ambassador.ambassadorCode,
      role: ambassador.role,
    },
  });
});

// ─── Admin: Get all applications ──────────────────────────────────────────────
export const getAllApplications = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;
  const { search, status } = req.query as { search?: string; status?: string };

  const filter: any = {};
  if (status && ['pending', 'approved', 'rejected'].includes(status)) filter.status = status;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { location: { $regex: search, $options: 'i' } },
    ];
  }

  const [applications, total, stats] = await Promise.all([
    Ambassador.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-inviteToken'),
    Ambassador.countDocuments(filter),
    Ambassador.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const statsMap = { pending: 0, approved: 0, rejected: 0 };
  stats.forEach((s: any) => { statsMap[s._id as keyof typeof statsMap] = s.count; });

  res.json({
    success: true,
    data: { applications, stats: statsMap },
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ─── Admin: Get single application ───────────────────────────────────────────
export const getApplication = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const ambassador = await Ambassador.findById(req.params.id).select('-inviteToken');
  if (!ambassador) throw new AppError('Application not found', 404);

  let referralData = null;
  if (ambassador.userId) {
    const [referredVendors, referredCustomers, referralEarnings] = await Promise.all([
      AmbassadorReferral.find({ ambassadorId: ambassador.userId, referredUserType: 'vendor' })
        .populate('referredUserId', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .limit(10),
      AmbassadorReferral.find({ ambassadorId: ambassador.userId, referredUserType: 'customer' })
        .populate('referredUserId', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .limit(10),
      AmbassadorReferral.aggregate([
        { $match: { ambassadorId: ambassador.userId } },
        { $group: { _id: null, total: { $sum: '$totalEarned' } } },
      ]),
    ]);
    referralData = {
      referredVendors,
      referredCustomers,
      totalEarned: referralEarnings[0]?.total || 0,
    };
  }

  res.json({ success: true, data: { ambassador, referralData } });
});

// ─── Admin: Approve application ───────────────────────────────────────────────
export const approveApplication = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const ambassador = await Ambassador.findById(req.params.id);
  if (!ambassador) throw new AppError('Application not found', 404);
  if (ambassador.status === 'approved') throw new AppError('Already approved', 400);

  const ambassadorCode = await generateAmbassadorCode();

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const signupLink = `${frontendUrl}/ambassador-signup?token=${rawToken}`;

  ambassador.status = 'approved';
  ambassador.ambassadorCode = ambassadorCode;
  ambassador.inviteToken = hashedToken;
  ambassador.inviteTokenExpires = expires;
  ambassador.approvedBy = req.user?.id as any;
  ambassador.approvedAt = new Date();
  await ambassador.save();

  await sendAmbassadorApprovalEmail(ambassador.email, ambassador.name, ambassadorCode, signupLink);

  if (process.env.NODE_ENV !== 'production') {
    logger.info(`[DEV] Ambassador signup link: ${signupLink}`);
  }
  logger.info(`Ambassador approved: ${ambassador.email} | Code: ${ambassadorCode}`);

  res.json({
    success: true,
    message: 'Ambassador approved and invitation email sent',
    data: { ambassadorCode },
  });
});

// ─── Admin: Reject application ────────────────────────────────────────────────
export const rejectApplication = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { reason } = req.body;
  const ambassador = await Ambassador.findById(req.params.id);
  if (!ambassador) throw new AppError('Application not found', 404);
  if (ambassador.status === 'rejected') throw new AppError('Already rejected', 400);

  ambassador.status = 'rejected';
  ambassador.rejectedAt = new Date();
  ambassador.rejectionReason = reason;
  await ambassador.save();

  res.json({ success: true, message: 'Application rejected' });
});

// ─── Admin: Add note ──────────────────────────────────────────────────────────
export const addNote = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { text } = req.body;
  if (!text) throw new AppError('Note text is required', 400);

  const ambassador = await Ambassador.findById(req.params.id);
  if (!ambassador) throw new AppError('Application not found', 404);

  const adminUser = await User.findById(req.user?.id).select('firstName lastName').lean();
  const adminName = adminUser ? `${(adminUser as any).firstName} ${(adminUser as any).lastName}` : req.user?.email || 'Admin';

  ambassador.adminNotes.push({
    text,
    createdBy: req.user?.id as any,
    createdByName: adminName,
    createdAt: new Date(),
  });
  await ambassador.save();

  res.json({ success: true, message: 'Note added' });
});

// ─── Admin: Get referral dashboard for one ambassador ─────────────────────────
export const getAmbassadorReferrals = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;
  const { type } = req.query as { type?: string };

  const ambassador = await Ambassador.findById(req.params.id).select('userId ambassadorCode name');
  if (!ambassador || !ambassador.userId) {
    res.json({ success: true, data: { referrals: [], summary: {} } });
    return;
  }

  const filter: any = { ambassadorId: ambassador.userId };
  if (type === 'vendor' || type === 'customer') filter.referredUserType = type;

  const [referrals, total, summary] = await Promise.all([
    AmbassadorReferral.find(filter)
      .populate('referredUserId', 'firstName lastName email role createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AmbassadorReferral.countDocuments(filter),
    AmbassadorReferral.aggregate([
      { $match: { ambassadorId: ambassador.userId } },
      {
        $group: {
          _id: '$referredUserType',
          count: { $sum: 1 },
          totalEarned: { $sum: '$totalEarned' },
          qualifiedCount: {
            $sum: { $cond: [{ $gte: ['$partialCount', 1] }, 1, 0] },
          },
          partialSum: { $sum: '$partialCount' },
        },
      },
    ]),
  ]);

  const summaryMap: Record<string, any> = {};
  summary.forEach((s: any) => { summaryMap[s._id] = s; });

  const vendorPartialSum = summaryMap.vendor?.partialSum || 0;
  const nextMilestone = vendorPartialSum < 20 ? 20
    : vendorPartialSum < 50 ? 50
    : vendorPartialSum < 100 ? 100
    : vendorPartialSum < 200 ? 200
    : null;
  const milestoneTarget = nextMilestone === 20 ? 3000
    : nextMilestone === 50 ? 7500
    : nextMilestone === 100 ? 20000
    : nextMilestone === 200 ? 50000
    : null;

  res.json({
    success: true,
    data: {
      referrals,
      summaryByType: summaryMap,
      milestone: {
        current: Math.round(vendorPartialSum * 10) / 10,
        next: nextMilestone,
        reward: milestoneTarget,
      },
    },
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ─── Admin: Edit application ──────────────────────────────────────────────────
export const updateApplication = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { name, email, phone, location, social, role, status } = req.body;

  const ambassador = await Ambassador.findById(req.params.id);
  if (!ambassador) throw new AppError('Application not found', 404);

  if (name !== undefined) ambassador.name = name.trim();
  if (email !== undefined) ambassador.email = email.toLowerCase().trim();
  if (phone !== undefined) ambassador.phone = phone;
  if (location !== undefined) ambassador.location = location.trim();
  if (social !== undefined) ambassador.social = social;
  if (role && ['student', 'state'].includes(role)) ambassador.role = role as 'student' | 'state';
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    ambassador.status = status as 'pending' | 'approved' | 'rejected';
  }

  await ambassador.save();
  logger.info(`Ambassador updated: ${ambassador.email} by admin ${req.user?.id}`);
  res.json({ success: true, message: 'Ambassador updated', data: { ambassador } });
});

// ─── Admin: Delete application ────────────────────────────────────────────────
export const deleteApplication = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const ambassador = await Ambassador.findById(req.params.id);
  if (!ambassador) throw new AppError('Application not found', 404);

  if (ambassador.userId) {
    await AmbassadorReferral.deleteMany({ ambassadorId: ambassador.userId });
  }

  await ambassador.deleteOne();
  logger.info(`Ambassador deleted: ${ambassador.email} by admin ${req.user?.id}`);
  res.json({ success: true, message: 'Ambassador deleted' });
});

// ─── Ambassador: Own dashboard ────────────────────────────────────────────────
export const getMyDashboard = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const userId = req.user?.id;

  const ambassador = await Ambassador.findOne({ userId }).select('ambassadorCode role name status approvedAt');
  if (!ambassador) throw new AppError('Ambassador profile not found', 404);

  const [vendors, customers] = await Promise.all([
    AmbassadorReferral.find({ ambassadorId: userId, referredUserType: 'vendor' })
      .populate('referredUserId', 'firstName lastName email createdAt')
      .sort({ createdAt: -1 }),
    AmbassadorReferral.find({ ambassadorId: userId, referredUserType: 'customer' })
      .populate('referredUserId', 'firstName lastName email createdAt')
      .sort({ createdAt: -1 }),
  ]);

  const vendorPartialSum = vendors.reduce((sum, v) => sum + (v.partialCount || 0), 0);
  const vendorEarned = vendors.reduce((sum, v) => sum + (v.totalEarned || 0), 0);
  const customerEarned = customers.reduce((sum, c) => sum + (c.totalEarned || 0), 0);

  const nextMilestone = vendorPartialSum < 20 ? 20
    : vendorPartialSum < 50 ? 50
    : vendorPartialSum < 100 ? 100
    : vendorPartialSum < 200 ? 200
    : null;
  const milestoneReward = nextMilestone === 20 ? 3000
    : nextMilestone === 50 ? 7500
    : nextMilestone === 100 ? 20000
    : nextMilestone === 200 ? 50000
    : null;

  res.json({
    success: true,
    data: {
      ambassador,
      milestone: {
        current: Math.round(vendorPartialSum * 10) / 10,
        next: nextMilestone,
        reward: milestoneReward,
        targets: [
          { count: 20, reward: 3000 },
          { count: 50, reward: 7500 },
          { count: 100, reward: 20000 },
          { count: 200, reward: 50000 },
        ],
      },
      vendors,
      customers,
      summary: {
        totalVendors: vendors.length,
        totalCustomers: customers.length,
        vendorEarned,
        customerEarned,
        totalEarned: vendorEarned + customerEarned,
      },
    },
  });
});

// ─── Ambassador commission service (called by other controllers) ───────────────

/**
 * Called when a vendor's product is approved AND vendor account is verified.
 * Checks if this vendor was referred by an ambassador. If so, credits 40% commission.
 */
export async function handleVendorProductApproved(vendorUserId: string): Promise<void> {
  try {
    const referral = await AmbassadorReferral.findOne({
      referredUserId: vendorUserId,
      referredUserType: 'vendor',
      stage40Reached: false,
    });
    if (!referral) return;

    // Verify vendor account is also active/verified
    const vendor = await User.findById(vendorUserId).select('status emailVerified');
    if (!vendor || vendor.status !== 'active' || !vendor.emailVerified) return;

    const commissionAmount = Math.round(referral.tierRate! * 0.4 * 100) / 100;

    referral.stage40Reached = true;
    referral.partialCount = 0.4;
    referral.commission40Amount = commissionAmount;
    referral.commission40PaidAt = new Date();
    referral.totalEarned += commissionAmount;
    await referral.save();

    await creditAmbassadorWallet(
      referral.ambassadorId.toString(),
      commissionAmount,
      `Ambassador vendor referral (40%) — vendor ${vendorUserId} approved with product`
    );

    logger.info(`Ambassador 40% commission: ₦${commissionAmount} → ${referral.ambassadorId}`);
  } catch (err) {
    logger.error('Error processing ambassador 40% commission:', err);
  }
}

/**
 * Called when a vendor makes their first completed sale.
 * Releases the remaining 60% commission to their referring ambassador.
 */
export async function handleVendorFirstSale(vendorUserId: string): Promise<void> {
  try {
    const referral = await AmbassadorReferral.findOne({
      referredUserId: vendorUserId,
      referredUserType: 'vendor',
      stage40Reached: true,
      stage60Reached: false,
    });
    if (!referral) return;

    const commissionAmount = Math.round(referral.tierRate! * 0.6 * 100) / 100;

    referral.stage60Reached = true;
    referral.partialCount = 1.0;
    referral.commission60Amount = commissionAmount;
    referral.commission60PaidAt = new Date();
    referral.totalEarned += commissionAmount;
    await referral.save();

    await creditAmbassadorWallet(
      referral.ambassadorId.toString(),
      commissionAmount,
      `Ambassador vendor referral (60%) — vendor ${vendorUserId} first sale`
    );

    logger.info(`Ambassador 60% commission: ₦${commissionAmount} → ${referral.ambassadorId}`);
  } catch (err) {
    logger.error('Error processing ambassador 60% commission:', err);
  }
}

/**
 * Called when a customer's order is completed.
 * Awards 3% commission on the customer's first 3 completed orders if they were referred by an ambassador.
 */
export async function handleCustomerOrderCompleted(
  customerUserId: string,
  orderId: string,
  orderAmount: number
): Promise<void> {
  try {
    const referral = await AmbassadorReferral.findOne({
      referredUserId: customerUserId,
      referredUserType: 'customer',
    });
    if (!referral) return;

    if (referral.customerOrdersTracked.length >= 3) return;

    const alreadyTracked = referral.customerOrdersTracked.some(
      (r) => r.orderId.toString() === orderId
    );
    if (alreadyTracked) return;

    const commissionAmount = Math.round(orderAmount * 0.03 * 100) / 100;

    referral.customerOrdersTracked.push({
      orderId: orderId as any,
      orderAmount,
      commissionAmount,
      paidAt: new Date(),
    });
    referral.totalEarned += commissionAmount;
    await referral.save();

    await creditAmbassadorWallet(
      referral.ambassadorId.toString(),
      commissionAmount,
      `Ambassador customer referral commission (3%) — order ${orderId}`
    );

    logger.info(`Ambassador customer commission: ₦${commissionAmount} → ${referral.ambassadorId}`);
  } catch (err) {
    logger.error('Error processing ambassador customer commission:', err);
  }
}

/**
 * Creates an AmbassadorReferral record when a referred user registers.
 * Determines ordinalPosition and tierRate for vendor referrals.
 */
export async function createReferralRecord(
  ambassadorUserId: string,
  referredUserId: string,
  referredUserType: 'vendor' | 'customer'
): Promise<void> {
  try {
    const existing = await AmbassadorReferral.findOne({
      ambassadorId: ambassadorUserId,
      referredUserId,
    });
    if (existing) return;

    let ordinalPosition: number | undefined;
    let tierRate: number | undefined;

    if (referredUserType === 'vendor') {
      const existingCount = await AmbassadorReferral.countDocuments({
        ambassadorId: ambassadorUserId,
        referredUserType: 'vendor',
      });
      ordinalPosition = existingCount + 1;
      tierRate = getTierRate(ordinalPosition);
    }

    await AmbassadorReferral.create({
      ambassadorId: ambassadorUserId,
      referredUserId,
      referredUserType,
      ordinalPosition,
      tierRate,
    });

    logger.info(`Ambassador referral recorded: ${ambassadorUserId} → ${referredUserId} (${referredUserType})`);
  } catch (err) {
    logger.error('Error creating ambassador referral record:', err);
  }
}

// ─── Internal: Credit ambassador wallet ──────────────────────────────────────
async function creditAmbassadorWallet(
  ambassadorUserId: string,
  amount: number,
  description: string
): Promise<void> {
  await Wallet.findOneAndUpdate(
    { user: ambassadorUserId },
    {
      $inc: { balance: amount, totalEarned: amount },
      $push: {
        transactions: {
          type: 'credit',
          amount,
          purpose: 'ambassador_commission',
          reference: `amb_${ambassadorUserId}_${Date.now()}`,
          description,
          status: 'completed',
          timestamp: new Date(),
        },
      },
    },
    { upsert: true }
  );
}
