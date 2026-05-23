"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.authorize = exports.authenticate = void 0;
const jwt_1 = require("../utils/jwt");
const User_1 = __importDefault(require("../models/User"));
const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            res.status(401).json({
                success: false,
                message: 'Please log in to continue',
                error: 'No token provided',
            });
            return;
        }
        const decoded = (0, jwt_1.verifyAccessToken)(token);
        // Check the user is still active in the DB — catches deleted/suspended accounts
        const user = await User_1.default.findById(decoded.id).select('status role').lean();
        if (!user) {
            res.status(401).json({
                success: false,
                message: 'Account no longer exists',
                error: 'account_deleted',
            });
            return;
        }
        const { status, role } = user;
        if (status === 'inactive' || status === 'deleted') {
            res.status(401).json({
                success: false,
                message: 'Your account has been deleted. Thank you for using VendorSpot.',
                error: 'account_deleted',
            });
            return;
        }
        if (status === 'suspended') {
            res.status(403).json({
                success: false,
                message: 'Your account has been suspended. Please contact support.',
                error: 'account_suspended',
            });
            return;
        }
        if (status === 'pending_verification') {
            res.status(403).json({
                success: false,
                message: 'Please verify your email before continuing.',
                error: 'email_not_verified',
            });
            return;
        }
        req.user = {
            id: decoded.id,
            email: decoded.email,
            role, // always from DB, not the JWT
        };
        next();
    }
    catch (error) {
        res.status(401).json({
            success: false,
            message: 'Invalid or expired token',
            error: error instanceof Error ? error.message : 'Authentication failed',
        });
    }
};
exports.authenticate = authenticate;
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({
                success: false,
                message: 'Please log in to continue',
            });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).json({
                success: false,
                message: 'Insufficient permissions',
                error: `Required role: ${roles.join(' or ')}`,
            });
            return;
        }
        next();
    };
};
exports.authorize = authorize;
const optionalAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
            const decoded = (0, jwt_1.verifyAccessToken)(token);
            const dbUser = await User_1.default.findById(decoded.id).select('status role').lean();
            const status = dbUser?.status;
            // Only attach user if account is in good standing
            if (dbUser && status === 'active') {
                req.user = {
                    id: decoded.id,
                    email: decoded.email,
                    role: dbUser.role,
                };
            }
        }
        next();
    }
    catch (error) {
        // If token is invalid, just continue without user
        next();
    }
};
exports.optionalAuth = optionalAuth;
//# sourceMappingURL=auth.js.map