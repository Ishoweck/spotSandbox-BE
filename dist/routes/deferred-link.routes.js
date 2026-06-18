"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const error_1 = require("../middleware/error");
const deferred_link_controller_1 = require("../controllers/deferred-link.controller");
const router = (0, express_1.Router)();
// Both routes are intentionally public — no auth needed (app isn't logged in yet on first launch)
router.post('/store', (0, error_1.asyncHandler)(deferred_link_controller_1.store));
router.post('/resolve', (0, error_1.asyncHandler)(deferred_link_controller_1.resolve));
exports.default = router;
//# sourceMappingURL=deferred-link.routes.js.map