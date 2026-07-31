import crypto from 'crypto';
import { Request, Response } from 'express';
import { AuthRequest, ApiResponse } from '../types';
import Ambassador from '../models/Ambassador';
import AmbassadorReferral from '../models/AmbassadorReferral';
import User from '../models/User';
import { Wallet } from '../models/Additional';
import { AppError, asyncHandler } from '../middleware/error';
import { sendAmbassadorApprovalEmail, sendAmbassadorClawbackEmail } from '../utils/email';
import { uploadToCloudinary } from '../utils/cloudinary';
import { logger } from '../utils/logger';

// ─── Tier rate lookup ──────────────────────────────────────────────────────────
// Vendors 1-50: ₦150, 51-100: ₦250, 101-200: ₦300
export function getTierRate(ordinalPosition: number): number {
  if (ordinalPosition <= 50) return 150;
  if (ordinalPosition <= 100) return 250;
  return 300;
}

// ─── Vendor referral milestones (partial-count sum → cash reward) ─────────────
const VENDOR_MILESTONES = [
  { count: 20, reward: 3000 },
  { count: 50, reward: 7500 },
  { count: 100, reward: 20000 },
  { count: 150, reward: 37500 },
  { count: 200, reward: 50000 },
];

function getVendorMilestone(vendorPartialSum: number) {
  const next = VENDOR_MILESTONES.find((m) => vendorPartialSum < m.count) || null;
  return {
    current: Math.round(vendorPartialSum * 10) / 10,
    next: next?.count ?? null,
    reward: next?.reward ?? null,
    targets: VENDOR_MILESTONES,
  };
}

async function checkAndPayMilestones(ambassadorUserId: string, newPartialSum: number): Promise<void> {
  try {
    for (const milestone of VENDOR_MILESTONES) {
      if (newPartialSum < milestone.count) continue;

      // Atomically add this milestone to milestonesPaid only if not already there.
      // findOneAndUpdate returns null when $addToSet makes no change (already in array),
      // meaning another concurrent call already claimed this milestone — skip.
      const claimed = await Ambassador.findOneAndUpdate(
        { userId: ambassadorUserId, milestonesPaid: { $ne: milestone.count } },
        { $addToSet: { milestonesPaid: milestone.count } }
      );
      if (!claimed) continue;

      await creditAmbassadorWallet(
        ambassadorUserId,
        milestone.reward,
        `Milestone bonus — ${milestone.count} vendors referred`
      );
      logger.info(`Ambassador milestone ${milestone.count}: ₦${milestone.reward} → ${ambassadorUserId}`);
    }
  } catch (err) {
    logger.error('Error paying ambassador milestones:', err);
  }
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
  const {
    name, email, phone, role, location, social, why,
    homeAddress, idType, idNumber, idImage,
    nextOfKinName, nextOfKinAddress, nextOfKinPhone,
    agreedToTerms,
  } = req.body;

  if (!name || !email || !role || !location || !why) {
    throw new AppError('Missing required fields', 400);
  }

  const validIdTypes = ['nin', 'drivers_license', 'international_passport', 'student_id'];
  if (!homeAddress?.trim() || !idType || !idNumber?.trim()) {
    throw new AppError('Home address and means of ID are required', 400);
  }
  if (!validIdTypes.includes(idType)) {
    throw new AppError('Invalid ID type', 400);
  }
  if (!idImage) {
    throw new AppError('Please upload a photo of your ID', 400);
  }
  if (!nextOfKinName?.trim() || !nextOfKinAddress?.trim() || !nextOfKinPhone?.trim()) {
    throw new AppError('Next of kin name, address, and phone are required', 400);
  }
  if (!agreedToTerms) {
    throw new AppError('You must accept the Terms and Conditions to apply', 400);
  }

  const existing = await Ambassador.findOne({ email: email.toLowerCase(), status: 'pending' });
  if (existing) {
    res.json({ success: true, message: 'Application received' });
    return;
  }

  let idImageUrl: string | undefined;
  if (idImage) {
    const uploaded = await uploadToCloudinary(idImage, 'ambassadors/id-cards');
    idImageUrl = uploaded.url;
  }

  await Ambassador.create({
    name, email, phone, role, location, social, why,
    homeAddress: homeAddress.trim(),
    idType,
    idNumber: idNumber.trim(),
    idImageUrl,
    nextOfKin: {
      name: nextOfKinName.trim(),
      address: nextOfKinAddress.trim(),
      phone: nextOfKinPhone.trim(),
    },
    termsAcceptedAt: new Date(),
  });

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

// ─── Admin: Resend invite link ────────────────────────────────────────────────
export const resendInvite = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { email } = req.body;
  if (!email) throw new AppError('Email is required', 400);

  const ambassador = await Ambassador.findOne({ email: email.toLowerCase().trim() });
  if (!ambassador) throw new AppError('No ambassador application found for that email', 404);

  if (ambassador.userId) {
    throw new AppError('This ambassador has already completed registration', 400);
  }

  // Auto-approve if still pending
  if (ambassador.status === 'pending') {
    ambassador.status = 'approved';
    ambassador.approvedBy = req.user?.id as any;
    ambassador.approvedAt = new Date();
    if (!ambassador.ambassadorCode) {
      ambassador.ambassadorCode = await generateAmbassadorCode();
    }
  }

  if (ambassador.status !== 'approved') {
    throw new AppError('Ambassador application is not approved', 400);
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000);

  ambassador.inviteToken = hashedToken;
  ambassador.inviteTokenExpires = expires;
  await ambassador.save();

  const frontendUrl = process.env.FRONTEND_URL || 'https://vendorspotng.com';
  const signupLink = `${frontendUrl}/ambassador-signup?token=${rawToken}`;

  await sendAmbassadorApprovalEmail(ambassador.email, ambassador.name, ambassador.ambassadorCode!, signupLink);

  logger.info(`Ambassador invite resent: ${ambassador.email} | Code: ${ambassador.ambassadorCode}`);

  res.json({
    success: true,
    message: `Ambassador invite link sent to ${ambassador.email}`,
    data: { ambassadorCode: ambassador.ambassadorCode },
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

  res.json({
    success: true,
    data: {
      referrals,
      summaryByType: summaryMap,
      milestone: getVendorMilestone(vendorPartialSum),
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

  const [vendors, customers, wallet, user] = await Promise.all([
    AmbassadorReferral.find({ ambassadorId: userId, referredUserType: 'vendor' })
      .populate('referredUserId', 'firstName lastName email createdAt')
      .sort({ createdAt: -1 }),
    AmbassadorReferral.find({ ambassadorId: userId, referredUserType: 'customer' })
      .populate('referredUserId', 'firstName lastName email createdAt')
      .sort({ createdAt: -1 }),
    Wallet.findOne({ user: userId }),
    User.findById(userId).select('payoutDetails'),
  ]);

  const vendorPartialSum = vendors.reduce((sum, v) => sum + (v.partialCount || 0), 0);
  const vendorEarned = vendors.reduce((sum, v) => sum + (v.totalEarned || 0), 0);
  const customerEarned = customers.reduce((sum, c) => sum + (c.totalEarned || 0), 0);

  const recentTransactions = wallet
    ? [...wallet.transactions]
        .filter((t) => t.purpose === 'commission')
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 20)
    : [];

  res.json({
    success: true,
    data: {
      ambassador,
      milestone: getVendorMilestone(vendorPartialSum),
      vendors,
      customers,
      summary: {
        totalVendors: vendors.length,
        totalCustomers: customers.length,
        vendorEarned,
        customerEarned,
        totalEarned: vendorEarned + customerEarned,
      },
      wallet: {
        balance: wallet?.balance ?? 0,
        pendingBalance: wallet?.pendingBalance ?? 0,
        totalWithdrawn: wallet?.totalWithdrawn ?? 0,
        recentTransactions,
      },
      hasBankAccount: !!(user as any)?.payoutDetails?.accountNumber,
    },
  });
});

// ─── Ambassador: Earnings + wallet history ────────────────────────────────────
export const getMyEarnings = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const userId = req.user?.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const ambassador = await Ambassador.findOne({ userId }).select('ambassadorCode name status');
  if (!ambassador) throw new AppError('Ambassador profile not found', 404);

  const [wallet, user] = await Promise.all([
    Wallet.findOne({ user: userId }),
    User.findById(userId).select('payoutDetails'),
  ]);

  const allTxns = wallet
    ? [...wallet.transactions]
        .filter((t) => t.purpose === 'commission')
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    : [];

  const pendingWithdrawals = wallet
    ? wallet.transactions.filter((t) => t.purpose === 'withdrawal' && t.status === 'pending')
    : [];

  const startIndex = (page - 1) * limit;
  const transactions = allTxns.slice(startIndex, startIndex + limit);

  res.json({
    success: true,
    data: {
      balance: wallet?.balance ?? 0,
      pendingBalance: wallet?.pendingBalance ?? 0,
      totalEarned: wallet?.totalEarned ?? 0,
      totalWithdrawn: wallet?.totalWithdrawn ?? 0,
      hasBankAccount: !!(user as any)?.payoutDetails?.accountNumber,
      bankAccount: (user as any)?.payoutDetails ?? null,
      pendingWithdrawals,
      transactions,
    },
    meta: {
      page,
      limit,
      total: allTxns.length,
      totalPages: Math.ceil(allTxns.length / limit),
    },
  });
});

// ─── Ambassador leaderboard (visible to all logged-in ambassadors) ────────────

export const getAmbassadorLeaderboard = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

  const rows = await AmbassadorReferral.aggregate([
    {
      $group: {
        _id: '$ambassadorId',
        totalEarned: { $sum: '$totalEarned' },
        vendorCount: { $sum: { $cond: [{ $eq: ['$referredUserType', 'vendor'] }, 1, 0] } },
        customerCount: { $sum: { $cond: [{ $eq: ['$referredUserType', 'customer'] }, 1, 0] } },
        totalReferrals: { $sum: 1 },
      },
    },
    { $sort: { totalEarned: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'ambassadors',
        localField: '_id',
        foreignField: 'userId',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        ambassadorId: '$_id',
        name: '$profile.name',
        location: '$profile.location',
        role: '$profile.role',
        ambassadorCode: '$profile.ambassadorCode',
        totalEarned: 1,
        vendorCount: 1,
        customerCount: 1,
        totalReferrals: 1,
      },
    },
  ]);

  // Tag the current user's position
  const userId = req.user?.id;
  const leaderboard = rows.map((row, idx) => ({
    rank: idx + 1,
    isMe: row.ambassadorId?.toString() === userId,
    ...row,
  }));

  res.json({ success: true, data: { leaderboard } });
});

// ─── Ambassador effort report (admin only) ────────────────────────────────────

export const getAmbassadorReport = asyncHandler(async (req: AuthRequest, res: Response<ApiResponse>) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    AmbassadorReferral.aggregate([
      {
        $group: {
          _id: '$ambassadorId',
          totalEarned: { $sum: '$totalEarned' },
          vendorCount: { $sum: { $cond: [{ $eq: ['$referredUserType', 'vendor'] }, 1, 0] } },
          customerCount: { $sum: { $cond: [{ $eq: ['$referredUserType', 'customer'] }, 1, 0] } },
          totalReferrals: { $sum: 1 },
          commission40Total: { $sum: '$commission40Amount' },
          commission60Total: { $sum: '$commission60Amount' },
        },
      },
      { $sort: { totalEarned: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'ambassadors',
          localField: '_id',
          foreignField: 'userId',
          as: 'profile',
        },
      },
      { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'wallets',
          localField: '_id',
          foreignField: 'user',
          as: 'wallet',
        },
      },
      { $unwind: { path: '$wallet', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          ambassadorId: '$_id',
          name: '$profile.name',
          email: '$profile.email',
          phone: '$profile.phone',
          location: '$profile.location',
          role: '$profile.role',
          ambassadorCode: '$profile.ambassadorCode',
          status: '$profile.status',
          milestonesPaid: '$profile.milestonesPaid',
          totalEarned: 1,
          vendorCount: 1,
          customerCount: 1,
          totalReferrals: 1,
          commission40Total: 1,
          commission60Total: 1,
          walletBalance: { $ifNull: ['$wallet.balance', 0] },
          walletTotalEarned: { $ifNull: ['$wallet.totalEarned', 0] },
          walletTotalWithdrawn: { $ifNull: ['$wallet.totalWithdrawn', 0] },
        },
      },
    ]),
    AmbassadorReferral.aggregate([{ $group: { _id: '$ambassadorId' } }, { $count: 'total' }]),
  ]);

  const totalAmbassadors = total[0]?.total || 0;

  res.json({
    success: true,
    data: { report: rows },
    meta: {
      page,
      limit,
      total: totalAmbassadors,
      totalPages: Math.ceil(totalAmbassadors / limit),
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
    // Verify vendor eligibility first (fast check before taking the DB lock)
    const vendor = await User.findById(vendorUserId).select('status emailVerified');
    if (!vendor || vendor.status !== 'active' || !vendor.emailVerified) return;

    // Atomically claim the 40% stage — findOneAndUpdate returns null if already claimed,
    // preventing double-credit on concurrent or retried calls
    const referral = await AmbassadorReferral.findOneAndUpdate(
      {
        referredUserId: vendorUserId,
        referredUserType: 'vendor',
        stage40Reached: { $ne: true },
      },
      { $set: { stage40Reached: true, partialCount: 0.4, commission40PaidAt: new Date() } }
    );
    if (!referral) return;

    const commissionAmount = Math.round(referral.tierRate! * 0.4 * 100) / 100;
    await AmbassadorReferral.updateOne(
      { _id: referral._id },
      { $inc: { totalEarned: commissionAmount }, $set: { commission40Amount: commissionAmount } }
    );

    await creditAmbassadorWallet(
      referral.ambassadorId.toString(),
      commissionAmount,
      `Ambassador vendor referral (40%) — vendor ${vendorUserId} approved with product`
    );

    const partialSumResult = await AmbassadorReferral.aggregate([
      { $match: { ambassadorId: referral.ambassadorId, referredUserType: 'vendor' } },
      { $group: { _id: null, sum: { $sum: '$partialCount' } } },
    ]);
    await checkAndPayMilestones(referral.ambassadorId.toString(), partialSumResult[0]?.sum || 0);

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
    // Atomically claim the 60% stage — prevents double-credit on concurrent or retried calls
    const referral = await AmbassadorReferral.findOneAndUpdate(
      {
        referredUserId: vendorUserId,
        referredUserType: 'vendor',
        stage40Reached: true,
        stage60Reached: { $ne: true },
      },
      { $set: { stage60Reached: true, partialCount: 1.0, commission60PaidAt: new Date() } }
    );
    if (!referral) return;

    const commissionAmount = Math.round(referral.tierRate! * 0.6 * 100) / 100;
    await AmbassadorReferral.updateOne(
      { _id: referral._id },
      { $inc: { totalEarned: commissionAmount }, $set: { commission60Amount: commissionAmount } }
    );

    await creditAmbassadorWallet(
      referral.ambassadorId.toString(),
      commissionAmount,
      `Ambassador vendor referral (60%) — vendor ${vendorUserId} first sale`
    );

    const partialSumResult = await AmbassadorReferral.aggregate([
      { $match: { ambassadorId: referral.ambassadorId, referredUserType: 'vendor' } },
      { $group: { _id: null, sum: { $sum: '$partialCount' } } },
    ]);
    await checkAndPayMilestones(referral.ambassadorId.toString(), partialSumResult[0]?.sum || 0);

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
    const commissionAmount = Math.round(orderAmount * 0.03 * 100) / 100;

    // Atomically push the order entry only if:
    //  - fewer than 3 orders already tracked (index [2] doesn't exist)
    //  - this orderId hasn't been tracked yet
    // Returns null if either guard fails — prevents double-credit on retries
    const referral = await AmbassadorReferral.findOneAndUpdate(
      {
        referredUserId: customerUserId,
        referredUserType: 'customer',
        'customerOrdersTracked.2': { $exists: false },
        'customerOrdersTracked.orderId': { $ne: orderId as any },
      },
      {
        $push: {
          customerOrdersTracked: {
            orderId: orderId as any,
            orderAmount,
            commissionAmount,
            paidAt: new Date(),
          },
        },
        $inc: { totalEarned: commissionAmount },
      }
    );
    if (!referral) return;

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
          purpose: 'commission',
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

// ─── Internal: Debit ambassador wallet (clawback) ─────────────────────────────
async function debitAmbassadorWallet(
  ambassadorUserId: string,
  amount: number,
  description: string
): Promise<void> {
  await Wallet.findOneAndUpdate(
    { user: ambassadorUserId },
    {
      $inc: { balance: -amount, totalEarned: -amount },
      $push: {
        transactions: {
          type: 'debit',
          amount,
          purpose: 'commission',
          reference: `amb_rev_${ambassadorUserId}_${Date.now()}`,
          description,
          status: 'completed',
          timestamp: new Date(),
        },
      },
    },
    { upsert: true }
  );
}

// ─── Internal: Reverse milestone bonuses that are now above the new partial sum ─
async function reverseExcessMilestones(
  ambassadorUserId: string,
  newPartialSum: number
): Promise<{ count: number; reward: number }[]> {
  const reversed: { count: number; reward: number }[] = [];

  // Iterate from highest milestone down so we debit in the correct order
  for (const milestone of [...VENDOR_MILESTONES].reverse()) {
    if (newPartialSum >= milestone.count) continue;

    // Atomically remove the milestone — returns null if it wasn't paid
    const updated = await Ambassador.findOneAndUpdate(
      { userId: ambassadorUserId, milestonesPaid: milestone.count },
      { $pull: { milestonesPaid: milestone.count } }
    );
    if (!updated) continue;

    await debitAmbassadorWallet(
      ambassadorUserId,
      milestone.reward,
      `Milestone reversal — vendor referral count dropped below ${milestone.count}`
    );
    reversed.push({ count: milestone.count, reward: milestone.reward });
    logger.info(`Ambassador milestone reversal ${milestone.count}: -₦${milestone.reward} from ${ambassadorUserId}`);
  }

  return reversed;
}

/**
 * Called when a referred vendor is rejected (KYC) or blocked (admin deactivation).
 * Claws back all commissions paid for that vendor and reverses any milestones
 * whose threshold is no longer met after the reduction.
 * Emails the ambassador with a full breakdown.
 */
export async function handleVendorRejectedOrBlocked(
  vendorUserId: string,
  reason: 'rejected' | 'blocked'
): Promise<void> {
  try {
    const referral = await AmbassadorReferral.findOne({
      referredUserId: vendorUserId,
      referredUserType: 'vendor',
    });
    if (!referral) return; // vendor was not ambassador-referred

    const paid40 = referral.stage40Reached ? (referral.commission40Amount || 0) : 0;
    const paid60 = referral.stage60Reached ? (referral.commission60Amount || 0) : 0;
    const totalClawback = paid40 + paid60;

    // Reset stages so a future re-approval can legitimately retrigger payment
    await AmbassadorReferral.updateOne(
      { _id: referral._id },
      {
        $set: {
          stage40Reached: false,
          stage60Reached: false,
          partialCount: 0,
          commission40Amount: 0,
          commission60Amount: 0,
          totalEarned: Math.max(0, (referral.totalEarned || 0) - totalClawback),
        },
      }
    );

    if (totalClawback > 0) {
      await debitAmbassadorWallet(
        referral.ambassadorId.toString(),
        totalClawback,
        `Commission clawback — referred vendor ${reason} (${vendorUserId})`
      );
    }

    // Recalculate partial sum across all vendor referrals after the reset
    const partialSumResult = await AmbassadorReferral.aggregate([
      { $match: { ambassadorId: referral.ambassadorId, referredUserType: 'vendor' } },
      { $group: { _id: null, sum: { $sum: '$partialCount' } } },
    ]);
    const newPartialSum = partialSumResult[0]?.sum || 0;

    const milestonesReversed = await reverseExcessMilestones(
      referral.ambassadorId.toString(),
      newPartialSum
    );

    // Notify the ambassador by email
    const ambassadorUser = await User.findById(referral.ambassadorId).select('email firstName');
    if (ambassadorUser?.email) {
      await sendAmbassadorClawbackEmail(
        ambassadorUser.email,
        ambassadorUser.firstName || 'Ambassador',
        totalClawback,
        reason,
        newPartialSum,
        milestonesReversed
      ).catch((err) => logger.error('Failed to send ambassador clawback email:', err));
    }

    logger.info(
      `Ambassador clawback: ₦${totalClawback} from ${referral.ambassadorId} — vendor ${vendorUserId} (${reason})`
    );
  } catch (err) {
    logger.error('Error processing ambassador clawback:', err);
  }
}
