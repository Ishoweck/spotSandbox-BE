import express, { Application } from 'express';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import connectDB from './config/database';
import routes from './routes';
import { errorHandler, notFound } from './middleware/error';
import { mongoSanitize } from './middleware/validation';
import { logger } from './utils/logger';
import { initializeSocket } from './config/socket';
import { setSocketInstance, setQueueReady } from './services/notification.service';
import { connectRedis } from './config/redis';
import { startNotificationWorkers } from './workers/notification.worker';
import { startEmailWorker } from './workers/email.worker';
import { startSlackWorker } from './workers/slack.worker';
import { setupDailyBackup } from './utils/backup';
import { setupOrderAutoComplete } from './utils/order-autocomplete';
import { setupPointsExpiryReminders } from './utils/points-expiry-reminder';
import { setupVCreditsExpiry } from './utils/vcredits-expiry';
import { setupVendorReminders } from './utils/vendor-reminders';
import { setupQuestionReminders } from './utils/question-reminders';
import { setupAutomatedEmails } from './utils/automated-emails';
import { backfillVendorSlugs } from './utils/vendor-slug-backfill';

// Load environment variables
dotenv.config();

// Create Express app
const app: Application = express();

// Trust reverse proxy (Nginx, Railway, Render, Heroku, etc.)
// Without this, req.ip is always the proxy's IP — all users share one rate-limit bucket
app.set('trust proxy', 1);

// Create HTTP server (needed for Socket.io)
const server = http.createServer(app);

// Connect to database
connectDB();

// Connect Redis and start BullMQ workers
connectRedis().then(() => {
  setQueueReady(true);
  startNotificationWorkers();
  startEmailWorker();
  startSlackWorker();
}).catch((err) => {
  logger.warn('[Redis] Workers not started — notifications will use direct fallback:', err?.message);
});

// Initialize Socket.io
const io = initializeSocket(server);

// Make io accessible to controllers via req.app
app.set('io', io);

// Make io accessible to notification service for real-time events
setSocketInstance(io);

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
app.use((req: any, res, next) => {
  const isUploadRoute =
    req.path.startsWith('/api/v1/upload') ||
    req.path.startsWith('/api/v1/products') ||
    req.path.startsWith('/api/v1/ambassadors') ||
    req.path === '/api/v1/vendor/kyc/verify-nin'; // base64 selfie payload
  express.json({
    limit: isUploadRoute ? '50mb' : '1mb',
    // Capture raw body for webhook signature verification (Paystack, Resend)
    verify: (_req: any, _res, buf) => { _req.rawBody = buf; },
  })(req, res, next);
});
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Security middleware
app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    // Fail-closed: if ALLOWED_ORIGINS is not configured, deny all browser cross-origin requests
    if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ============================================================
// RELAXED RATE LIMITING FOR UPLOADS
// ============================================================
const limiter = rateLimit({
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
app.use(mongoSanitize);

// Compression
app.use(compression());

// Static assets — logo and other public files (logo.png served at /logo.png)
app.use(express.static(path.join(__dirname, '../public')));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
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
app.use(`/api/${API_VERSION}`, routes);

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
app.use(notFound);

// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/${API_VERSION}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);

  // One-time migration: generate slugs for existing vendors that don't have one
  backfillVendorSlugs();
  // Start daily database backup scheduler
  setupDailyBackup();
  // Auto-release vendor funds 7 days after delivery if customer hasn't confirmed
  setupOrderAutoComplete();
  // Send points expiry reminders at 14, 7, 3, and 1 day before expiry
  setupPointsExpiryReminders();
  // VCredits expiry — reminders + zero-out after 60 days of inactivity
  setupVCreditsExpiry();
  // Vendor lifecycle reminder emails (KYC, products, profile, payouts, sales, subscriptions)
  setupVendorReminders();
  // Remind vendors of unanswered product questions at 24h, 72h, and 7-day intervals
  setupQuestionReminders();
  // Customer abandoned-cart (24h/72h), come-back (30d silent), weekly admin + ambassador digests
  setupAutomatedEmails();
});

// SET SERVER TIMEOUT
server.timeout = 180000; // 3 minutes

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  logger.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

export { io };
export default app;
