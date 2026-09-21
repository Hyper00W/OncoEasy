# OncoEasy Production Configuration

This document covers environment configuration for running OncoEasy. It is configuration-only: no business logic, providers, or deployments are described here.

## 1. Required backend environment variables

Set these in the backend process environment (or a `backend/.env` file locally). Validation is centralized in `backend/src/config/env.ts`; the server refuses to start and prints each invalid variable.

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | Yes | `development`, `test`, or `production`. |
| `PORT` | No | Defaults to `3000`. |
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. Neon). Must start with `postgresql://` or `postgres://`. Backend-only secret. |
| `CORS_ORIGIN` | Yes in production | Comma-separated list of allowed browser origins (e.g. `https://app.example.com,https://admin.example.com`). Wildcard `*` is forbidden in production. In development it defaults to `http://localhost:5173`. |
| `JWT_ACCESS_SECRET` | Yes | Random, unique, at least 32 characters in production. Backend-only. |
| `JWT_REFRESH_SECRET` | Yes | Random, unique, at least 32 characters in production. Must differ from the access secret. Backend-only. |
| `JWT_ACCESS_EXPIRES_IN` | Yes | e.g. `15m`. |
| `JWT_REFRESH_EXPIRES_IN` | Yes | e.g. `7d`. |
| `PRESCRIPTION_MAX_FILE_SIZE_BYTES` | No | Defaults to `10485760` (10 MB). |
| `DELIVERY_PROOF_MAX_FILE_SIZE_BYTES` | No | Defaults to `10485760` (10 MB). |
| `STORAGE_PROVIDER` | Yes in production | `in-memory` (development/test only; **forbidden in production**), `s3` (AWS S3), or `s3-compatible` (MinIO, Cloudflare R2, …). Defaults to `in-memory` locally. |
| `STORAGE_BUCKET` | When storage ≠ in-memory | Private bucket name. Backend-only. |
| `STORAGE_REGION` | When storage ≠ in-memory | Bucket region (e.g. `ap-south-1`). |
| `STORAGE_ACCESS_KEY_ID` | When storage ≠ in-memory | Storage credential. Backend-only secret. |
| `STORAGE_SECRET_ACCESS_KEY` | When storage ≠ in-memory | Storage credential. Backend-only secret. |
| `STORAGE_ENDPOINT` | Required for `s3-compatible` | Endpoint URL of the S3 API (e.g. MinIO/R2). Leave unset for AWS S3. |
| `STORAGE_FORCE_PATH_STYLE` | No | `true` only for endpoint-based providers requiring path-style addressing. Defaults to `false`. |
| `STORAGE_SIGNED_URL_EXPIRY_SECONDS` | No | Lifetime of temporary private-access references (default `300` s), used by prescription/PAP/lab-report/story-photo access workflows. |
| `WHATSAPP_ENABLED` | No | `false` by default. `true` selects the Meta WhatsApp Cloud API provider (production use); `false` selects the deterministic in-memory mock. |
| `WHATSAPP_API_BASE_URL` | When WhatsApp enabled | Meta Graph API base (normally `https://graph.facebook.com`). No implicit default — must be set when enabled. |
| `WHATSAPP_API_VERSION` | When WhatsApp enabled | Graph API version (e.g. `v21.0`). No implicit default — must be set when enabled. |
| `WHATSAPP_PHONE_NUMBER_ID` | When WhatsApp enabled | Meta WhatsApp Business phone number ID. Backend-only. |
| `WHATSAPP_ACCESS_TOKEN` | When WhatsApp enabled | Meta system-user token with `whatsapp_business_messaging`. Backend-only secret. |
| `SMS_ENABLED` | No | `false` by default. `true` enables the SMS fallback channel (generic HTTP gateway). |
| `SMS_API_BASE_URL` | When SMS enabled | Full gateway send URL (any gateway path included). No implicit default. |
| `SMS_API_KEY` | When SMS enabled | Gateway API key, sent as `Authorization: Bearer`. Backend-only secret. |
| `SMS_SENDER_ID` | No | Optional transactional sender ID, included as the `from` field when set. |
| `PAYMENT_GATEWAY_ENABLED` | No | `false` by default. `true` selects the Razorpay server-side gateway for `PREPAID` payments; `false` keeps the legacy pending-integration marker (no checkout data). |
| `PAYMENT_GATEWAY_KEY_ID` | When gateway enabled | Razorpay key ID (`rzp_test_…` / `rzp_live_…`). The only gateway value returned to the frontend. |
| `PAYMENT_GATEWAY_KEY_SECRET` | When gateway enabled | Razorpay key secret. Backend-only secret; used for API auth and signature verification. |
| `PAYMENT_GATEWAY_WEBHOOK_SECRET` | No | Optional. Required for the `POST /api/v1/payments/webhook` endpoint to be active. Backend-only secret. |
| `EMAIL_ENABLED` | No | `false` by default. `true` enables the transactional email channel (generic HTTP vendor). |
| `EMAIL_API_BASE_URL` | When email enabled | Full vendor send URL (any vendor path included). No implicit default. |
| `EMAIL_API_KEY` | When email enabled | Vendor API key, sent as `Authorization: Bearer`. Backend-only secret. |
| `EMAIL_FROM_ADDRESS` | When email enabled | Verified sender address. |
| `EMAIL_FROM_NAME` | No | Optional friendly sender name shown in mail clients. |

## 2. Required frontend environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Yes | Base URL of the backend API without a trailing slash. Locally `http://localhost:3000`; in production the deployed backend URL. This variable is public by design (Vite inlines it into the client bundle), so it must never contain secrets. |

The frontend has no other required configuration. It uses the single shared API client (`frontend/src/api/client.ts`); do not hardcode localhost URLs into production builds.

## 3. Local development configuration

1. Copy `backend/.env.example` to `backend/.env` and fill in local values (a local or cloud PostgreSQL database and any long dev secrets).
2. Copy `frontend/.env.example` to `frontend/.env.development` (or `.env.local`) and point `VITE_API_BASE_URL` at the local backend.
3. `CORS_ORIGIN` defaults to `http://localhost:5173` in development, so the Vite dev server works out of the box.

## 4. Production configuration

- `NODE_ENV=production` enables stricter validation:
  - `CORS_ORIGIN` becomes required and must be an explicit list of URL origins (`*` is rejected at startup).
  - JWT secrets must be at least 32 characters.
- Use a managed PostgreSQL instance and keep `DATABASE_URL` only in the backend environment.
- Build the frontend with the production `VITE_API_BASE_URL` (see `frontend/.env.production.example`).
- Never commit `.env` files; provide them through the hosting platform's secret/environment mechanism. `.gitignore` rules exclude them from version control.

## 5. Private object storage (Phase 3.2)

All private files (prescriptions, PAP documents, lab reports, patient story photos, delivery/payment proofs) are stored through one provider-agnostic abstraction (`backend/src/storage/private-storage.ts`) used by every feature module. Nothing is public; access is only via short-lived signed URLs (default 300 s) returned by backend APIs.

- **Development/test:** the default `STORAGE_PROVIDER=in-memory` requires no cloud credentials. Temporary references are opaque `private://` identifiers (not browser-loadable) — a known dev-mode limitation.
- **Production:** configure `STORAGE_PROVIDER=s3` (AWS) or `s3-compatible` (MinIO/R2 via `STORAGE_ENDPOINT`) with bucket/region/credentials. The adapter uses AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`); uploads are private (no public ACL), object keys are server-generated UUIDs (client filenames are never used in keys), and temporary access is a GetObject presigned URL.
- Production startup fails clearly if `STORAGE_PROVIDER=in-memory` or required S3 variables are missing.

## 6. Provider variables intentionally deferred

The following integrations are **not configured yet** and are intentionally deferred to later Phase 3 modules. Placeholder names are documented in `backend/.env.example` (commented out). Do not set them until the corresponding integration phase:

- **Payment** gateway (`PAYMENT_*` — **no longer deferred, see below**)

WhatsApp (Phase 3.3) and SMS (Phase 3.4) are **no longer deferred**: their variables are validated in `backend/src/config/env.ts` and consumed by `backend/src/notifications/`. Required variables are listed in section 1; credentials are required only when the channel is enabled.

### SMS fallback behavior (Phase 3.4)

- WhatsApp is the primary notification channel; SMS is a secondary fallback channel and is **never** used for a message WhatsApp already delivered (no duplicates).
- Only notifications that explicitly opt in (`allowSmsFallback`) may fall back to SMS; nothing is auto-classified and existing workflows are unchanged.
- At most one attempt per channel — no retry or fallback loops. If both channels fail, a constant safe `NOTIFICATION_FAILED` error is thrown; if no fallback is possible, the original WhatsApp error propagates.
- Generic HTTP gateway wire convention: `POST <SMS_API_BASE_URL>` (exact URL, gateway path included) with `Authorization: Bearer <SMS_API_KEY>` and JSON body `{ "to": "<e164>", "text": "<body>", "from": "<SMS_SENDER_ID>" (only when set) }`. A 2xx response is success; an optional reference is read from `messageId`/`message_id`/`id`/`sid`. Single attempt, 10 s timeout, non-2xx/malformed/network failures map to constant safe errors that never include the API key or message body.
- With `SMS_ENABLED=false` (development/test default) SMS sends fail fast with `SMS_DISABLED`; the deterministic in-memory mock is used only through the test seams. Production never silently falls back to a mock.

### Payment gateway / Razorpay (Phase 3.5)

- Provider-agnostic abstraction in `backend/src/payments/payment-gateway.ts` with the Razorpay adapter in `backend/src/payments/razorpay-gateway.ts`; the pharmacy payment service consumes the interface only.
- Flow (official server-side integration): `POST /api/v1/pharmacy/orders/:orderId/payment` with `PREPAID` creates the gateway order from the **server-side** `Order.totalAmount` (integer paise, never a client amount) and returns safe public checkout data (`keyId`, `gatewayOrderId`, `amountMinor`, `currency`, internal `orderId`); the frontend opens Razorpay Checkout; the frontend then posts the checkout result to `POST /api/v1/pharmacy/orders/:orderId/payment/verify`.
- Verification is server-authoritative: HMAC-SHA256 signature check (`orderId|paymentId` with the key secret, constant-time), then the gateway payment is re-fetched and its order/currency/amount must match the internal payment before idempotent transitions (`PENDING/AUTHORIZED/FAILED → PAID` + `PENDING_PAYMENT → PAID`). A frontend "success" alone never marks anything paid.
- `POST /api/v1/payments/webhook` (mounted before the JSON parser for the raw body) verifies `x-razorpay-signature` with `PAYMENT_GATEWAY_WEBHOOK_SECRET`, handles `payment.captured`/`payment.failed` idempotently, and safely ignores unsupported events and amount-mismatched payloads.
- COD, cold-chain, pincode eligibility, and prescription-approval rules are untouched; COD never produces a checkout payload; delivery/order transitions are not triggered by payment initiation.
- With `PAYMENT_GATEWAY_ENABLED=false` the legacy behavior is byte-identical to Phase 1.7.11 (provider `PENDING_PROVIDER_INTEGRATION`, `PENDING` status, no checkout data, verify → 503 `PAYMENT_GATEWAY_DISABLED`). Production never silently falls back to a mock.
- Local validation uses the deterministic mock gateway only; **no real Razorpay credentials or transactions are used**. Test/live modes are distinguished by the key ID prefix (`rzp_test_` vs `rzp_live_`) in the configured credentials.

### Transactional email (Phase 3.6)

- Provider-agnostic surface in `backend/src/notifications/email.ts` with the generic HTTP adapter in `backend/src/notifications/generic-http-email.ts`; feature modules never import vendor details.
- Wire convention: `POST <EMAIL_API_BASE_URL>` (exact URL, vendor path included) with `Authorization: Bearer <EMAIL_API_KEY>` and JSON body `{ "from": "\"<EMAIL_FROM_NAME>\" <<EMAIL_FROM_ADDRESS>>" (address alone when no name), "to", "subject", "text", "html" (only when provided) }`. A 2xx response is success; an optional reference is read from `messageId`/`message_id`/`id`. Single attempt, 10 s timeout, non-2xx/malformed/network failures map to constant safe errors that never include the API key, recipient, or message content.
- Orchestration (`backend/src/notifications/notification-service.ts`): `sendTransactionalNotification` keeps the exact Phase 3.3/3.4 WhatsApp-primary → opt-in SMS fallback chain; `sendEmailNotification` sends email exactly once with no side channels; `sendMultiChannelNotification` attempts each explicitly requested channel at most once (WhatsApp success never duplicates over SMS; email is independent and opt-in) and returns a structured `{ delivered, failed }` result — no loops, no silent swallowing.
- Privacy: recipients are validated and lowercased; subjects must stay neutral (e.g. "Your OncoEasy order update") — clinical details never belong in subjects, bodies logged, or errors. No notification history is persisted.
- With `EMAIL_ENABLED=false` (development/test default) email sends fail fast with `EMAIL_DISABLED`; the deterministic in-memory mock is used only through the test seams. Production never silently falls back to a mock.
- Local validation uses the mock + a local fake HTTP server only; **no real emails are sent**.

### Thyrocare DSA — manual operational workflow (Phase 3.7)

- External lab booking is a **MANUAL DSA workflow**, not an API integration: a patient books, the booking enters `PENDING_OPS`, an Ops operator places the collection manually in the Thyrocare DSA portal and records the resulting order/reference ID via `PATCH /api/v1/admin/labs/bookings/:id/dsa` (queue: `GET /api/v1/admin/labs/bookings?dsaQueue=true`, detail: `GET .../:id/dsa`), then continues the existing status lifecycle (`BOOKED → SAMPLE_COLLECTED → REPORT_READY → ...`).
- There is **no official Thyrocare API contract or credentials in this repository**, so there are deliberately **no `THYROCARE_*` environment variables and no outbound calls** to Thyrocare. Do not add fake credential variables.
- The provider seam lives in `backend/src/modules/labs/thyrocare-dsa.ts` (`LabBookingProvider`, `ThyrocareDsaAdapter` with `mode: "MANUAL_DSA"`, mock for tests, selected via `lab-provider.ts`). A future official-API adapter implements the same interface without touching patient-facing booking logic and would add its real env variables at that time.
- External references are unique across bookings (`lab_bookings.external_order_id @unique`); Ops-only operational notes (`POST .../:id/ops-notes`) are stored in `lab_bookings.ops_notes` and are never returned to patients.

### Delivery — MANUAL_LOCAL mode (Phase 3.8)

- Delivery fulfilment is a **MANUAL_LOCAL workflow**, not a courier API integration: Ops assigns an active local delivery agent via `POST /api/v1/pharmacy/deliveries/:deliveryId/assign`, the agent moves the delivery through `ASSIGNED → OUT_FOR_DELIVERY → DELIVERED` (or `FAILED`) and uploads proof images (delivery photo always required; `CASH_OVER_BILL`/`ONLINE_PAYMENT` proof additionally required for COD) through private storage. There is deliberately **no `COURIER_*` environment variable, SDK, or outbound call** — do not add fake courier credentials.
- The provider seam lives in `backend/src/modules/pharmacy/delivery/delivery-provider.ts` (`DeliveryProvider` with `createShipment`, `ManualLocalDeliveryProvider` with `provider: "MANUAL_LOCAL"`, `mode: "MANUAL_LOCAL"`, plus a test mock selected via `delivery-provider-selector.ts`). Shipment creation is invoked at assignment; the reference is persisted in the existing `deliveries.tracking_number` with `courier_name` recording the provider, both idempotent (an already-referenced delivery keeps its original reference). A future official courier adapter implements the same interface without touching the order lifecycle, patient/agent/admin UI, or payment logic, and would add its real env variables at that time.
- Guards preserved: unpaid prepaid orders cannot be marked delivered (`PAYMENT_NOT_COMPLETE`); COD proof gates completion; courier-mode deliveries cannot be assigned to local agents; payment status is never changed by shipment creation or assignment.

## 7. Deployment

Deployment targets, commands, order, health checks, and the manual-credentials
gap list live in `deployment.md`.

## 8. Never commit `.env` or secrets

- `.gitignore` rules ignore `.env` and `.env.*` in both `backend/` and `frontend/`; only `.env.example` files are tracked.
- Example files contain placeholders only.
- JWT secrets, database credentials, and provider secrets stay backend-only. Only `VITE_*` variables reach the frontend bundle.

## 8. Database (production readiness — Phase 3.9)

- Production requires a managed-PostgreSQL `DATABASE_URL` (TLS required, e.g. Neon's `sslmode=require&channel_binding=require`). Startup **fails fast** if a production process is handed a localhost database URL.
- The **only** production migration command is `npm run db:migrate:deploy` (`prisma migrate deploy`). Run it **before** deploying a release whose code depends on schema changes. `prisma migrate dev`, `prisma db push`, `migrate reset`, and `db seed` are forbidden in production (reset destroys data; push/dev cause drift; seed only runs in `NODE_ENV=development`).
- Verify with `npm run db:migrate:status` (must report up to date) and, for pre-release confidence, the from-empty chain equivalence check in `docs/database-operations.md` (`npm run db:verify-schema` against a disposable scratch database).
- One shared `PrismaClient`; SIGTERM/SIGINT gracefully close the HTTP server and disconnect Prisma.
- Backups/PITR are a managed-provider + operator responsibility (the application performs none). The application provides no schema rollback: roll back by redeploying the previous release and keep schema changes additive for one release, or forward-fix with a new migration; restore from PITR for destructive incidents.
- Full operational detail: `docs/database-operations.md`.

## Related behavior (verified, unchanged)

- The dev/test OTP echo (`testOtp`) is returned only when `NODE_ENV=test`; production never exposes OTP codes.
- The API error handler returns sanitized messages; unexpected errors always return a generic `INTERNAL_SERVER_ERROR` with no stack traces to clients.
- Startup fails fast with a clear, itemized error list when required configuration is missing or invalid.
- Runtime abuse brakes (added in the security-validation pass): `POST /api/v1/auth/login` allows 30 requests per IP per 15 minutes and `POST /api/v1/auth/patient/request-otp` allows 10 per IP per 10 minutes (429 `RATE_LIMITED` beyond that). These are per-process, in-memory limits; a shared store would be required only if the backend is horizontally scaled.
