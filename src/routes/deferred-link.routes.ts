import { Router } from 'express';
import { asyncHandler } from '../middleware/error';
import { store, resolve } from '../controllers/deferred-link.controller';

const router = Router();

// Both routes are intentionally public — no auth needed (app isn't logged in yet on first launch)
router.post('/store',   asyncHandler(store));
router.post('/resolve', asyncHandler(resolve));

export default router;
