import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { UserRole } from '../types';
import {
  listPublicEvents,
  getPublicEvent,
  vendorListEvents,
  vendorSubmitListing,
  vendorWithdrawListing,
} from '../controllers/sales-event.controller';

const router = Router();

// Vendor (declared before /:slug so "vendor" is not read as a slug)
router.get('/vendor/events', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorListEvents));
router.post('/vendor/events/:eventId/listings', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorSubmitListing));
router.delete('/vendor/listings/:listingId', authenticate, authorize(UserRole.VENDOR), asyncHandler(vendorWithdrawListing));

// Public
router.get('/', asyncHandler(listPublicEvents));
router.get('/:slug', asyncHandler(getPublicEvent));

export default router;
