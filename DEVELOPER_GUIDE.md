# VendorSpot Developer Working Guide

> Nigerian multi-vendor e-commerce marketplace — Backend + Mobile monorepo.
> Production: https://vapp-be.onrender.com

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Local Environment Setup](#2-local-environment-setup)
3. [Project Architecture](#3-project-architecture)
4. [Code Conventions](#4-code-conventions)
5. [Adding a New Feature (End-to-End)](#5-adding-a-new-feature-end-to-end)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Error Handling](#7-error-handling)
8. [Database & Models](#8-database--models)
9. [Real-time & Queues](#9-real-time--queues)
10. [External Services](#10-external-services)
11. [Mobile App Coordination](#11-mobile-app-coordination)
12. [Git Workflow](#12-git-workflow)
13. [Testing & Debugging Scripts](#13-testing--debugging-scripts)
14. [Deployment](#14-deployment)
15. [Environment Variables Reference](#15-environment-variables-reference)

---

## 1. Project Overview

VendorSpot is a production-grade Nigerian e-commerce marketplace (similar to Jumia/Shopify). It has two codebases:

| Part | Path | Tech |
|---|---|---|
| Backend API | `C:\Users\YungFlash\Downloads\vendorspot-backend` | Node.js + TypeScript + Express + MongoDB |
| Mobile App | `C:\Users\YungFlash\Desktop\vspotApp\vspotApp` | Expo 54 + React Native 0.81.5 + TypeScript |

**Key numbers to know:**
- 9 user roles: `CUSTOMER`, `VENDOR`, `ADMIN`, `SUPER_ADMIN`, `FINANCIAL_ADMIN`, `SUPPORT_ADMIN`, `CONTENT_ADMIN`, `KYC_ADMIN`, `MARKETING_ADMIN`, `AFFILIATE`
- 36 API route groups at `/api/v1/`
- 24 Mongoose models
- 38 controllers
- 80+ mobile screens

---

## 2. Local Environment Setup

### Prerequisites

- Node.js 18+
- MongoDB (local) or MongoDB Atlas URI
- Redis (for BullMQ queues)
- Git

### Backend Setup

```bash
cd vendorspot-backend
npm install

# Copy the environment template
cp .env.example .env
# Then fill in your secrets (see Section 15)

# Start dev server with hot reload
npm run dev
```

Server starts on `http://localhost:5000`. Health check: `GET /api/v1/health`.

### Mobile App Setup

```bash
cd vspotApp/vspotApp
npm install

# Update the dev IP in src/services/api.config.ts
# Change DEV_URL to your machine's local IP:
# http://<YOUR_LAN_IP>:5000/api/v1

npx expo start
```

> **Important:** The mobile app must point to your machine's LAN IP, not `localhost`, because the simulator/device is a separate network node. Find your IP with `ipconfig` (Windows) or `ifconfig` (Mac/Linux).

### Seed Initial Data

```bash
npm run seed            # General seed
npm run seed:admins     # Create admin accounts
npm run seed:vendors    # Create test vendor accounts
```

---

## 3. Project Architecture

### Backend Directory Layout

```
src/
├── config/         # DB, Redis, Firebase, Socket.IO, Cloudinary init
├── controllers/    # Request handlers — one class per entity
├── models/         # Mongoose schemas + TypeScript interfaces
├── routes/         # Express routers — one file per entity
├── middleware/     # auth, error, audit, validation
├── services/       # External API wrappers (Paystack, Shipbubble, etc.)
├── workers/        # BullMQ job processors
├── queues/         # BullMQ queue definitions
├── types/          # Shared TypeScript types & enums
├── utils/          # JWT, email templates, helpers, logger, cloudinary
└── server.ts       # App entry point
```

### Request Lifecycle

```
Request
  → Rate Limiter (1000 req/15min per IP)
  → Body Parser + mongoSanitize
  → Router (/api/v1/...)
  → authenticate middleware (JWT verification)
  → authorize middleware (role check)
  → validate middleware (express-validator rules)
  → asyncHandler(controller.method)
  → Controller logic
  → Response { success, message, data }
  → Error middleware (catches AppError + Mongoose errors)
```

### Standard API Response Shape

Every endpoint returns this envelope:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": { }
}
```

On error:
```json
{
  "success": false,
  "message": "Descriptive error message",
  "error": "Detail (dev only)"
}
```

---

## 4. Code Conventions

### File Naming

| Layer | Pattern | Example |
|---|---|---|
| Controller | `{entity}.controller.ts` | `product.controller.ts` |
| Model | `PascalCase.ts` | `VendorProfile.ts` |
| Routes | `{entity}.routes.ts` | `product.routes.ts` |
| Service | `{name}.service.ts` | `paystack.service.ts` |
| Middleware | descriptive | `auth.ts`, `error.ts` |

### Controller Pattern

All controllers are **class-based singletons**. Always export an instance, not the class.

```typescript
export class ProductController {
  async createProduct(req: AuthRequest, res: Response<ApiResponse>): Promise<void> {
    const { name, price } = req.body;
    // business logic
    res.status(201).json({ success: true, message: 'Product created', data: { product } });
  }
}

export const productController = new ProductController();
```

### Route Pattern

Always bind controller methods and wrap with `asyncHandler`. Apply middleware left to right.

```typescript
const router = Router();

// Public
router.get('/', asyncHandler(productController.getProducts.bind(productController)));

// Protected
router.post(
  '/',
  authenticate,
  authorize(UserRole.VENDOR, UserRole.ADMIN),
  validate(createProductValidation),
  asyncHandler(productController.createProduct.bind(productController))
);

export default router;
```

### Model Pattern

Always define an interface extending `Document`, then export a typed model.

```typescript
export interface IProduct extends Document {
  name: string;
  price: number;
  vendor: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    vendor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const Product = mongoose.model<IProduct>('Product', productSchema);
```

### TypeScript Conventions

- `AuthRequest` — use instead of plain `Request` when the route is authenticated (gives you `req.user`)
- `ApiResponse` — the standard response type for `res`
- `AppError` — throw this for business logic errors, not plain `Error`
- Enums live in `src/types/index.ts` — import `UserRole`, `OrderStatus`, etc. from there

### Naming Rules

- Classes: `PascalCase`
- Functions/methods: `camelCase`, verb-first (`createProduct`, `getOrders`, `deleteCategory`)
- Constants/enums values: `SCREAMING_SNAKE_CASE`
- Files: `kebab-case.ts` for multi-word, plain name for models

---

## 5. Adding a New Feature (End-to-End)

Follow this order when adding a new resource or feature:

### Step 1 — Define the Model

Create `src/models/MyEntity.ts`:
- Add the TypeScript interface
- Define the Mongoose schema
- Add indexes for fields you'll query on
- Enable `{ timestamps: true }`

### Step 2 — Add Types/Enums (if needed)

Add new enums or shared types to `src/types/index.ts`.

### Step 3 — Write the Controller

Create `src/controllers/myEntity.controller.ts`:
- Class-based, one method per endpoint
- Use `AppError` for error cases
- Return consistent `ApiResponse` shape
- Export singleton: `export const myEntityController = new MyEntityController()`

### Step 4 — Define Routes

Create `src/routes/myEntity.routes.ts`:
- Wire up middleware chain: `authenticate → authorize → validate → asyncHandler`
- Export the router as default

### Step 5 — Register the Route

In `src/routes/index.ts`, add:
```typescript
import myEntityRoutes from './myEntity.routes';
router.use('/my-entity', myEntityRoutes);
```

### Step 6 — Add Service (if external API needed)

Create `src/services/myService.service.ts` for any third-party API calls. Keep HTTP logic in the service, business logic in the controller.

### Step 7 — Update Mobile (if needed)

In the mobile app (`src/services/`), create or update the corresponding service file to call the new endpoint. See [Section 11](#11-mobile-app-coordination).

### Step 8 — Test

Use the Postman collection (`vendorspot-postman-collection.json`) or write a debug script in `src/scripts/`.

---

## 6. Authentication & Authorization

### How Auth Works

1. Client sends `Authorization: Bearer <token>` header
2. `authenticate` middleware (`src/middleware/auth.ts`) verifies the JWT and re-fetches the user from DB on every request (checks account status)
3. `req.user` is now available in the controller

### Using Auth Middleware

```typescript
// Require any logged-in user
router.get('/me', authenticate, asyncHandler(controller.getMe.bind(controller)));

// Require specific roles
router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  asyncHandler(controller.delete.bind(controller))
);
```

### Token Flow

- Access token: 7 days (`JWT_EXPIRES_IN`)
- Refresh token: 30 days (`JWT_REFRESH_EXPIRES_IN`)
- Refresh endpoint: `POST /api/v1/auth/refresh-token`
- 401 response from any endpoint triggers logout in the mobile app (Axios interceptor)

### OAuth

Google and Apple OAuth are handled in `src/controllers/oauthController.ts`. Users created via OAuth have no password (conditional schema validation on `User.ts`).

---

## 7. Error Handling

### Throwing Errors in Controllers

```typescript
// Business logic error
throw new AppError('Product not found', 404);

// Auth error
throw new AppError('You do not have permission to do this', 403);
```

Never `throw new Error(...)` — always use `AppError` so the error middleware returns the right status code.

### The asyncHandler Wrapper

All controller methods in routes must be wrapped:

```typescript
asyncHandler(controller.method.bind(controller))
```

This catches any unhandled promise rejections and forwards them to the error middleware — you don't need try/catch in every controller method.

### Error Middleware (src/middleware/error.ts)

Automatically handles:
- `AppError` → uses its `statusCode`
- Mongoose `ValidationError` → 400
- Mongoose duplicate key (`MongoServerError 11000`) → 409
- Mongoose `CastError` → 400 (bad ObjectId)
- JWT errors → 401

---

## 8. Database & Models

### MongoDB Connection

Connection is established in `src/config/database.ts` and called at server startup. The URI comes from `MONGODB_URI` in `.env`.

### Querying Best Practices

- Use `.lean()` for read-only queries (returns plain objects, much faster)
- Use `.select('-password -resetPasswordToken')` to exclude sensitive fields
- Always paginate large collections — default page size is 20 (`DEFAULT_PAGE_SIZE` env var), max 100

```typescript
const page = parseInt(req.query.page as string) || 1;
const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
const skip = (page - 1) * limit;

const products = await Product.find(filter).skip(skip).limit(limit).lean();
const total = await Product.countDocuments(filter);
```

### Relationships

- Use `Schema.Types.ObjectId` with `ref` for all relations
- Populate only what you need: `.populate('vendor', 'firstName lastName email')`
- Avoid deep nested populations in list endpoints (performance)

---

## 9. Real-time & Queues

### Socket.IO

The Socket.IO instance is attached to the Express app: `app.get('io')`. Access it in controllers:

```typescript
const io = req.app.get('io');
io.to(userId.toString()).emit('order:updated', { orderId, status });
```

Socket events handled in `src/config/socket.ts`: order updates, messages, notifications, stock alerts.

### BullMQ Queues

Notifications and emails are sent async via BullMQ (backed by Redis):

```typescript
import { enqueueEmail } from '../utils/email-queue';

await enqueueEmail({
  to: user.email,
  subject: 'Order Confirmed',
  template: 'order-confirmation',
  data: { orderId }
});
```

If Redis is unavailable, the system falls back to synchronous sending. Workers are in `src/workers/`.

---

## 10. External Services

All third-party API logic is encapsulated in `src/services/`. Never call external APIs directly from controllers.

| Service | File | Purpose |
|---|---|---|
| Paystack | `paystack.service.ts` | Primary payments (NGN) |
| Flutterwave | `flutterwave.service.ts` | Alternative payments |
| ShipBubble | `shipbubble.service.ts` | Nigerian logistics & shipping |
| Cloudinary | `utils/cloudinary.ts` | Image upload/delete |
| Firebase FCM | `config/firebase.ts` | Push notifications |
| Email | `services/email.service.ts` | Transactional email |
| Notification | `services/notification.service.ts` | In-app + push notifications |

### Webhook Security

Paystack webhooks are verified using `PAYSTACK_WEBHOOK_SECRET`. Flutterwave uses `FLW_SECRET_HASH`. Always verify signatures before processing webhook payloads.

---

## 11. Mobile App Coordination

The mobile app and backend are tightly coupled. When you change or add a backend endpoint:

### API Config (Mobile)

`src/services/api.config.ts` in the mobile app controls the base URL:
- `DEV_URL`: your local machine IP (e.g., `http://10.134.x.x:5000/api/v1`)
- `PROD_URL`: `https://vapp-be.onrender.com/api/v1`

The current production IP shown in the file (`10.134...`) is a dev LAN address — update it to match your network when developing.

### Adding a New Endpoint — Mobile Checklist

1. Add or update the service file in `src/services/` (mobile)
2. Call the Axios instance imported from `api.config.ts` — never create a new Axios instance
3. Token injection is automatic via the request interceptor
4. 401 responses automatically trigger logout (response interceptor)
5. Use `useFocusEffect` if the screen should refresh data when navigated back to

### Navigation Structure

```
RootNavigator
  ├── AuthNavigator       (unauthenticated users)
  ├── AppNavigator        (authenticated — customer/vendor mode)
  │   ├── CustomerTabs: Home, Orders, Wishlist, Messages, Profile
  │   └── VendorTabs: Home, Dashboard, VendorOrders, Messages, Profile
  └── GuestAppNavigator   (guest mode — limited access)
```

Imperative navigation (outside of components) uses `navigationRef.ts`.

---

## 12. Git Workflow

### Branch Naming

```
feature/short-description       # new feature
fix/short-description           # bug fix
hotfix/short-description        # urgent production fix
chore/short-description         # dependency updates, tooling
```

### Commit Message Format

```
type: short description (max 72 chars)

Optional body explaining WHY (not what).
```

Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`

Examples:
```
feat: add affiliate commission withdrawal endpoint
fix: correct order status not updating on shipbubble webhook
chore: bump paystack sdk to v3
```

### Workflow

1. Branch off `main`
2. Make changes, commit frequently
3. Test locally with Postman or debug scripts
4. Open PR → describe what changed and why
5. Merge to `main` after review
6. Production auto-deploys from `main` (Render)

---

## 13. Testing & Debugging Scripts

There is no automated test suite beyond `npm test` (Jest). Use the scripts in `src/scripts/` for manual integration testing.

### Useful NPM Scripts

```bash
npm run dev                   # Start dev server
npm run build                 # Compile TypeScript to dist/
npm run start                 # Run compiled production server

npm run seed                  # Seed DB with base data
npm run seed:admins           # Seed admin users
npm run seed:vendors          # Seed test vendors

npm run ship                  # Test ShipBubble API
npm run ship:debug            # Debug ShipBubble requests
npm run cat                   # Test categories

npm run backfill:ratings      # Recalculate all vendor ratings
npm run fix-products          # Fix product type data
```

### Postman Collection

Import `vendorspot-postman-collection.json` from the project root into Postman. It has pre-built requests for all major endpoints.

### Manual Debug Scripts

Add one-off debug scripts to `src/scripts/` — name them `debug-<thing>.ts` or `test-<thing>.ts`. Run with:
```bash
npx ts-node src/scripts/my-script.ts
```

---

## 14. Deployment

Production runs on **Render** (auto-deploy from `main` branch).

### Build & Start Commands (Render)

```
Build: npm install && npm run build
Start: npm run start
```

### Pre-deploy Checklist

- [ ] `npm run build` passes locally with no TypeScript errors
- [ ] All new `.env` variables added to Render environment settings
- [ ] New routes registered in `src/routes/index.ts`
- [ ] DB indexes added for any new query patterns
- [ ] Webhook endpoints updated in Paystack/Flutterwave dashboards if URLs changed
- [ ] Mobile app `PROD_URL` still points to correct production URL

### Logs

Render streams stdout logs. Locally, Winston logs go to the `logs/` directory.

### Scheduled Tasks (run on server startup)

These auto-start with the server — no cron setup needed:
- `setupDailyBackup()` — daily MongoDB backup
- `setupOrderAutoComplete()` — auto-complete stale orders
- `setupPointsExpiryReminders()` — notify users of expiring points
- `setupVCreditsExpiry()` — expire VCredits on schedule

---

## 15. Environment Variables Reference

Copy `.env.example` to `.env` and fill in the values below.

### Required (app won't start without these)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
| `PORT` | Server port (default: 5000) |

### Payments

| Variable | Description |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack secret (sk_live_... or sk_test_...) |
| `PAYSTACK_PUBLIC_KEY` | Paystack public key |
| `PAYSTACK_WEBHOOK_SECRET` | For verifying webhook signatures |
| `FLW_SECRET_KEY` | Flutterwave secret |
| `FLW_PUBLIC_KEY` | Flutterwave public key |
| `FLW_SECRET_HASH` | Flutterwave webhook hash |

### External Services

| Variable | Description |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `FIREBASE_PROJECT_ID` | Firebase project ID (push notifications) |
| `FIREBASE_PRIVATE_KEY` | Firebase private key |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |
| `SHIPBUBBLE_API_KEY` | ShipBubble logistics API key |
| `REDIS_URL` | Redis connection URL (BullMQ) |
| `EMAIL_HOST` / `EMAIL_USER` / `EMAIL_PASSWORD` | SMTP email credentials |
| `RESEND_WEBHOOK_SECRET` | Resend email webhook secret |

### Security & Config

| Variable | Default | Description |
|---|---|---|
| `JWT_EXPIRES_IN` | `7d` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Refresh token lifetime |
| `ALLOWED_ORIGINS` | — | Comma-separated CORS whitelist |
| `RATE_LIMIT_MAX_REQUESTS` | `1000` | Requests per window per IP |
| `DEFAULT_PAGE_SIZE` | `20` | Default pagination size |
| `PLATFORM_FEE_PERCENTAGE` | `5` | Platform commission % |
| `DEFAULT_AFFILIATE_COMMISSION` | `10` | Affiliate commission % |
| `SUPER_ADMIN_EMAIL` | — | Initial super admin credentials |

---

## Quick Reference Card

```
Start dev server:          npm run dev
Compile TypeScript:        npm run build
Run seeder:                npm run seed
Test ShipBubble:           npm run ship
Debug with ts-node:        npx ts-node src/scripts/<file>.ts

Health check:              GET http://localhost:5000/api/v1/health
Auth:                      POST /api/v1/auth/login
Refresh token:             POST /api/v1/auth/refresh-token

Controller pattern:        class → singleton export → bind in routes
Error pattern:             throw new AppError('message', statusCode)
Async pattern:             asyncHandler(controller.method.bind(controller))
Response pattern:          res.status(code).json({ success, message, data })
```
