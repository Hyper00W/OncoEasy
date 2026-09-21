# Production Deployment (OncoEasy)

Deploying the existing modular monolith: React + Vite frontend, Node/Express
backend (long-running server or Vercel Functions), PostgreSQL/Neon database,
private S3-compatible storage. Configuration details live in
`production-configuration.md`; database operations in `database-operations.md`.
This document covers deployment targets, commands, order, and verification.

## 1. Targets

| Component | Target | Notes |
|---|---|---|
| Frontend | Vercel (static, SPA rewrites) | `frontend/vercel.json` rewrites all non-`assets/` paths to `index.html` for the History-API router |
| Backend | Vercel Functions **or** any Node host (Render/Railway/Fly/VM) | `backend/api/index.ts` wraps the same Express app for serverless; `npm start` runs the long-running server elsewhere |
| Database | Managed PostgreSQL / Neon | connection string in backend env only |
| Storage | S3-compatible private bucket | configured via `STORAGE_*` vars; nothing public |

Do not migrate to different providers without updating these files; the app
itself is provider-agnostic and hardcodes nothing.

## 2. Commands

Frontend:
- Build: `npm run build` (in `frontend/`) — type-checks then emits `frontend/dist`
- Never serves or needs a runtime; static only

Backend:
- Build: `npm run build` (in `backend/`) — `tsc` + `prisma generate`
- Install generates the Prisma Client automatically (`postinstall`)
- Start (long-running): `npm start` → `node dist/server.js`
- Serverless: hosted automatically from `backend/api/index.ts` (no local start)

Database (production-safe only):
- Migrate: `npm run db:migrate:deploy` (in `backend/`)
- Check status: `npm run db:migrate:status`
- Verify schema matches history: `npm run db:verify-schema`

**Forbidden in production:** `prisma migrate dev`, `prisma db push`,
`prisma migrate reset`, `prisma db seed`. The seed throws unless
`NODE_ENV=development`, and no deploy/start path invokes it.

## 3. Deployment order

1. Provision/configure the database (Neon or equivalent) → note `DATABASE_URL`
2. `DATABASE_URL` + backend secrets into the backend host's env (see
   `production-configuration.md`; frontend gets only `VITE_API_BASE_URL`)
3. Build backend, run `npm run db:migrate:deploy` against the production URL
4. Deploy the backend; verify `GET /health` → HTTP 200
5. Build and deploy the frontend with `VITE_API_BASE_URL` set to the backend URL
6. Verify frontend → backend connectivity (see §5)

Never deploy the frontend before the backend URL exists, and never migrate
after starting new servers in a way that races schema changes.

## 4. Health check

`GET /health` → `200 {"status":"ok"}`. Configure the hosting platform's
health-check/monitoring against this endpoint. It intentionally returns no
database or version detail; a deeper check is `GET /api/v1/...` of any public
route. Startup failures (missing/invalid env) exit non-zero with a clear error
before listening.

## 5. Frontend → backend verification

After both are deployed:

1. Frontend loads over HTTPS at its production origin
2. A login/auth request from the browser reaches the backend (network tab shows
   the production API URL — **no** `localhost` requests)
3. CORS succeeds: the backend `CORS_ORIGIN` must list the exact frontend
   origin (scheme + host + port). Until the real domain is known, production
   startup is intentionally blocked: `CORS_ORIGIN` is required (no default) in
   `NODE_ENV=production` and wildcards are rejected when credentials are used.
4. Refresh a deep route (e.g. `/patient/dashboard`) — SPA rewrite must return
   `index.html`, not 404

Do not run destructive business flows just to verify; auth + one read-only
route is sufficient smoke.

## 6. Webhook / callback URLs to register manually

Only after credentials exist (do not register otherwise):

| Service | URL to register | Where |
|---|---|---|
| Razorpay | `https://<backend>/api/v1/payments/webhook` | Razorpay dashboard → Webhooks; also set `PAYMENT_GATEWAY_WEBHOOK_SECRET` |
| WhatsApp | none — outbound-only (Cloud API send) | n/a |

## 7. Environment separation

- Frontend vars: **only** `VITE_*`, public by design; the sole one is
  `VITE_API_BASE_URL`. Never place backend secrets in any `VITE_` var.
- Backend vars: all secrets (`DATABASE_URL`, JWT, storage, WhatsApp, SMS,
  email, Razorpay, webhook secret) — server-side only, never in the bundle.
- Each environment (dev/staging/prod) gets its own `DATABASE_URL`; never share.
- `.env` files are gitignored; commit only `.env.example` placeholders.
  Never copy real values into examples or docs.

## 8. What requires manual provider access

The following cannot be completed without real accounts/credentials, and the
repository intentionally contains none (nothing is invented):

- Backend hosting account + env var setup (and Vercel project creation)
- Production `DATABASE_URL` (Neon or other) — migrations then run via
  `db:migrate:deploy`
- S3-compatible bucket + keys
- WhatsApp Business Cloud API token/phone ID
- SMS gateway credentials (generic HTTP adapter)
- Email provider credentials (generic HTTP adapter)
- Razorpay key ID/secret (+ webhook registration per §6)
- Real production domain(s) → then set `CORS_ORIGIN` and `VITE_API_BASE_URL`

Until these exist the app is DEPLOYMENT READY but not DEPLOYED; no step above
fakes or pre-registers any provider.
