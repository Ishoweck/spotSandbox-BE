import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../types';
import {
  submitApplication,
  verifyInvite,
  getAllApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  resendInvite,
  addNote,
  getAmbassadorReferrals,
  getMyDashboard,
  getMyEarnings,
  updateApplication,
  deleteApplication,
  getAmbassadorLeaderboard,
  getAmbassadorReport,
} from '../controllers/ambassador.controller';

const router = Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.post('/submit', submitApplication);
router.get('/verify-invite', verifyInvite);

// ── Authenticated routes (any role) ──────────────────────────────────────────
router.use(authenticate);

router.get('/my-dashboard', getMyDashboard);
router.get('/my-earnings', getMyEarnings);
router.get('/leaderboard', getAmbassadorLeaderboard);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/report', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), getAmbassadorReport);
router.get('/', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), getAllApplications);
router.get('/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), getApplication);
router.post('/resend-invite', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), resendInvite);
router.post('/:id/approve', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), approveApplication);
router.post('/:id/reject', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), rejectApplication);
router.put('/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), updateApplication);
router.delete('/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), deleteApplication);
router.put('/:id/notes', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), addNote);
router.get('/:id/referrals', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), getAmbassadorReferrals);

export default router;
