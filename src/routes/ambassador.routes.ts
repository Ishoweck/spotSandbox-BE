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
  addNote,
  getAmbassadorReferrals,
  getMyDashboard,
} from '../controllers/ambassador.controller';

const router = Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.post('/submit', submitApplication);
router.get('/verify-invite', verifyInvite);

// ── Authenticated routes (any role) ──────────────────────────────────────────
router.use(authenticate);

router.get('/my-dashboard', getMyDashboard);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), getAllApplications);
router.get('/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), getApplication);
router.post('/:id/approve', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), approveApplication);
router.post('/:id/reject', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), rejectApplication);
router.put('/:id/notes', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), addNote);
router.get('/:id/referrals', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MARKETING_ADMIN), getAmbassadorReferrals);

export default router;
