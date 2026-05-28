"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const database_1 = __importDefault(require("./config/database"));
const routes_1 = __importDefault(require("./routes"));
const error_1 = require("./middleware/error");
const validation_1 = require("./middleware/validation");
const logger_1 = require("./utils/logger");
const socket_1 = require("./config/socket");
const notification_service_1 = require("./services/notification.service");
const backup_1 = require("./utils/backup");
const order_autocomplete_1 = require("./utils/order-autocomplete");
const points_expiry_reminder_1 = require("./utils/points-expiry-reminder");
const vcredits_expiry_1 = require("./utils/vcredits-expiry");
// Load environment variables
dotenv_1.default.config();
// Create Express app
const app = (0, express_1.default)();
// Trust reverse proxy (Nginx, Railway, Render, Heroku, etc.)
// Without this, req.ip is always the proxy's IP — all users share one rate-limit bucket
app.set('trust proxy', 1);
// Create HTTP server (needed for Socket.io)
const server = http_1.default.createServer(app);
// Connect to database
(0, database_1.default)();
// Initialize Socket.io
const io = (0, socket_1.initializeSocket)(server);
exports.io = io;
// Make io accessible to controllers via req.app
app.set('io', io);
// Make io accessible to notification service for real-time events
(0, notification_service_1.setSocketInstance)(io);
// ============================================================
// INCREASED TIMEOUT FOR LARGE UPLOADS
// ============================================================
app.use((req, res, next) => {
    // Set timeout to 3 minutes for all requests
    req.setTimeout(180000); // 3 minutes
    res.setTimeout(180000); // 3 minutes
    next();
});
// ============================================================
// BODY PARSER - ONLY ONCE with 50MB limit
// ============================================================
// Upload routes handle their own large payloads (base64 images) — everything else is capped at 1MB
app.use((req, res, next) => {
    const isUploadRoute = req.path.startsWith('/api/v1/upload') ||
        req.path.startsWith('/api/v1/products');
    express_1.default.json({ limit: isUploadRoute ? '50mb' : '1mb' })(req, res, next);
});
app.use(express_1.default.urlencoded({ limit: '1mb', extended: true }));
// Security middleware
app.use((0, helmet_1.default)());
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, server-to-server)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
}));
// ============================================================
// RELAXED RATE LIMITING FOR UPLOADS
// ============================================================
const limiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
    // Mobile carriers (MTN, Airtel) use CGNAT — thousands of users share one IP.
    // 1000 req/15min per IP is still safe while not locking out shared-IP mobile users.
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000'),
    message: 'Too many requests from this IP, please try again later.',
    skipSuccessfulRequests: true,
    // Use the real client IP (requires trust proxy above)
    keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
});
app.use('/api', limiter);
// Strip MongoDB operator keys ($gt, $where, etc.) from all request inputs
app.use(validation_1.mongoSanitize);
// Compression
app.use((0, compression_1.default)());
// Logging
if (process.env.NODE_ENV === 'development') {
    app.use((0, morgan_1.default)('dev'));
}
else {
    app.use((0, morgan_1.default)('combined'));
}
// ============================================================
// WELL-KNOWN FILES — Required for iOS Universal Links and Android App Links
// ============================================================
app.get('/.well-known/apple-app-site-association', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
        applinks: {
            apps: [],
            details: [
                {
                    appID: `${process.env.APPLE_TEAM_ID || 'TEAMID'}.${process.env.APPLE_BUNDLE_ID || 'com.vendorspot.app'}`,
                    paths: ['/affiliate/*', '/products/*', '/shops/*', '/vendor/*'],
                },
            ],
        },
    });
});
app.get('/.well-known/assetlinks.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json([
        {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
                namespace: 'android_app',
                package_name: process.env.ANDROID_PACKAGE_NAME || 'com.vendorspot.app',
                sha256_cert_fingerprints: (process.env.ANDROID_SHA256_FINGERPRINTS || '').split(',').filter(Boolean),
            },
        },
    ]);
});
// API routes
const API_VERSION = process.env.API_VERSION || 'v1';
app.use(`/api/${API_VERSION}`, routes_1.default);
// Root route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to VendorSpot API',
        version: API_VERSION,
        documentation: '/api/docs',
    });
});
// 404 handler
app.use(error_1.notFound);
// Error handler
app.use(error_1.errorHandler);
// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    logger_1.logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    console.log(`Server started on http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/${API_VERSION}`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
    // Start daily database backup scheduler
    (0, backup_1.setupDailyBackup)();
    // Auto-release vendor funds 7 days after delivery if customer hasn't confirmed
    (0, order_autocomplete_1.setupOrderAutoComplete)();
    // Send points expiry reminders at 14, 7, 3, and 1 day before expiry
    (0, points_expiry_reminder_1.setupPointsExpiryReminders)();
    // VCredits expiry — reminders + zero-out after 60 days of inactivity
    (0, vcredits_expiry_1.setupVCreditsExpiry)();
});
// SET SERVER TIMEOUT
server.timeout = 180000; // 3 minutes
// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    logger_1.logger.error('Unhandled Promise Rejection:', err);
    process.exit(1);
});
exports.default = app;
//# sourceMappingURL=server.js.map