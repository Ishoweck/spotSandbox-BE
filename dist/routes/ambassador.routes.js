"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const types_1 = require("../types");
const ambassador_controller_1 = require("../controllers/ambassador.controller");
const router = (0, express_1.Router)();
// ── Public routes ─────────────────────────────────────────────────────────────
router.post('/submit', ambassador_controller_1.submitApplication);
router.get('/verify-invite', ambassador_controller_1.verifyInvite);
// ── Authenticated routes (any role) ──────────────────────────────────────────
router.use(auth_1.authenticate);
router.get('/my-dashboard', ambassador_controller_1.getMyDashboard);
// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN, types_1.UserRole.MARKETING_ADMIN), ambassador_controller_1.getAllApplications);
router.get('/:id', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN, types_1.UserRole.MARKETING_ADMIN), ambassador_controller_1.getApplication);
router.post('/:id/approve', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN), ambassador_controller_1.approveApplication);
router.post('/:id/reject', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN), ambassador_controller_1.rejectApplication);
router.put('/:id/notes', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN, types_1.UserRole.MARKETING_ADMIN), ambassador_controller_1.addNote);
router.get('/:id/referrals', (0, auth_1.authorize)(types_1.UserRole.SUPER_ADMIN, types_1.UserRole.ADMIN, types_1.UserRole.MARKETING_ADMIN), ambassador_controller_1.getAmbassadorReferrals);
exports.default = router;
//# sourceMappingURL=ambassador.routes.js.map