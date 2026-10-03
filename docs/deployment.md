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
- Smoke test: `npm run smoke:production` — starts the **built** server in
  `NODE_ENV=production` against a non-production database and asserts startup,
  liveness, readiness, an auth response, and a sanitized 401 (see §4.4). Never
  point it at the production database.
- Build-artifact gate: `npm run verify:build` — read-only; asserts the backend
  and frontend build outputs exist, that the frontend bundle contains **no**
  `localhost` reference, and (with `EXPECTED_API_HOST=<host>`) that the expected
  production API host is actually baked into the bundle. Run it after both
  builds, before promoting a release (see §4.5).

Note for CI/images: `prisma generate` writes the query engine into
`node_modules/.prisma/client` and fails on Windows with `EPERM` if another
running Node process holds that file. `tsc` output is still valid; re-run
`npx prisma generate` with other processes stopped.

Database (production-safe only):
- Migrate: `npm run db:migrate:deploy` (in `backend/`)
- Check status: `npm run db:migrate:status`
- Verify schema matches history: `npm run db:verify-schema`
  (full chain check needs `SHADOW_DATABASE_URL` pointed at a disposable DB)

**Forbidden in production:** `prisma migrate dev`, `prisma db push`,
`prisma migrate reset`, `prisma db seed`. The seed throws unless
`NODE_ENV=development`, and no deploy/start path invokes it.

## 3. Deployment order

1. Provision/configure the database (Neon or equivalent) → note `DATABASE_URL`
2. `DATABASE_URL` + backend secrets into the backend host's env (see
   `production-configuration.md`; frontend gets only `VITE_API_BASE_URL`)
3. Build backend, run `npm run db:migrate:deploy` against the production URL
4. Deploy the backend; verify `GET /health` → HTTP 200 (and, where the platform
   supports a distinct readiness probe, `GET /health/ready` → HTTP 200)
5. Build and deploy the frontend with `VITE_API_BASE_URL` set to the backend URL
6. Verify frontend → backend connectivity (see §5)

Never deploy the frontend before the backend URL exists, and never migrate
after starting new servers in a way that races schema changes.

## 4. Health, readiness, and startup safety

### 4.1 Liveness — `GET /health`

`200 {"status":"ok"}`. Dependency-free: it never touches the database, so it
answers as soon as the process is listening. Point the platform's
**liveness/restart** probe here. It intentionally returns no database, version,
or configuration detail.

### 4.2 Readiness — `GET /health/ready`

Runs a cheap `SELECT 1` (1.5 s timeout) and reports **categories only**:

- database reachable → `200 {"status":"ok","checks":{"process":"ok","database":"ok"}}`
- database unreachable → `503 {"status":"unavailable","checks":{"process":"ok","database":"unreachable"}}`

Point a **readiness/traffic** probe here. It never returns URLs, credentials, or
provider payloads. A `503` here means "do not send traffic", not "restart the
process" — `/health` is still `200`.

### 4.3 Startup safety

In production the process validates the environment and then probes the
database **before** `server.listen()`:

1. environment validation (`config/env.ts`) — invalid config prints an itemized
   list (no secret values) and exits `1`;
2. application initialization (routes/Prisma client creation);
3. database readiness — `SELECT 1` with a bounded 60 s grace window (2 s retries)
   for normal orchestrator/managed-database startup races;
4. on success, log `database_ready` and `server_started`, then listen;
5. on expiry, log `database_unreachable_at_startup`, disconnect Prisma, and exit
   `1`.

So a production server **never listens while it cannot reach its database** —
monitoring cannot report a healthy process whose every request fails. In
dev/test the probe is skipped and the server starts immediately.

### 4.4 Production smoke test

`npm run smoke:production` (in `backend/`, after `npm run build`) starts
`dist/server.js` with `NODE_ENV=production` on a local port against a
**non-production** database and asserts: process starts, `/health` 200,
`/health/ready` 200 with `database: "ok"`, the auth endpoint returns a normal
4xx (not a connection failure), a protected endpoint returns a sanitized 401,
and no secret/`DATABASE_URL` appears in the logs. It calls no external provider.
Run it before promoting a build; never point it at production.

### 4.5 Build-artifact gate

```bash
cd frontend && VITE_API_BASE_URL=https://api.example.com npm run build
cd ../backend && npm run build && EXPECTED_API_HOST=api.example.com npm run verify:build
```

`verify:build` is read-only and asserts: `dist/server.js` exists; the frontend
build output exists; the frontend bundle contains **zero** `localhost`
references; and the expected production API host is embedded. A frontend built
against the local development URL (`frontend/.env.development`) **fails** this
gate — which is the point. The frontend checks are skipped with a `SKIP` line if
`frontend/dist` is absent, so a backend-only pipeline can still run it.

Remember the fail-fast client: with `VITE_API_BASE_URL` unset the frontend
throws `VITE_API_BASE_URL is not configured` at startup rather than silently
defaulting to localhost, so a missing variable surfaces immediately rather than
as a mysterious production connection failure.

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

## 7.1 Rollback and backward compatibility

Application rollback and database rollback are **not equivalent** —
`migrate deploy` is forward-only and applied migrations are immutable.

- **Backward-compatible deployment expectation:** schema changes should be
  **additive for at least one release** (add nullable columns/tables/indexes
  first; drop or rename only in a later release, after the old code is gone).
  Under that rule the previous application build runs correctly against the
  newer schema.
- **Application-only rollback is safe** when the release's migrations were
  additive (the old code simply ignores the new columns/tables). Redeploy the
  previous build and leave the database untouched.
- **A database migration prevents rollback** when it was destructive (dropped or
  narrowed a column/table the previous build still needs). In that case
  application-only rollback will fail; choose deliberately:
  forward-fix with a new patch release, or restore from backup/PITR (see
  `recovery-runbook.md` → Scenario H).
- **Destructive migration rollback must not be improvised.** There are no "down"
  migrations and `migrate reset`/`db push` are forbidden — they destroy data or
  drift the schema from migration history.
- **Rollout practice:** migrate first, then start new servers (see §3), and
  verify `migrate status` before and after the release.

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
- Real production domain(s) + DNS → then set `CORS_ORIGIN` and `VITE_API_BASE_URL`
- **Database backups / PITR:** enable and confirm the retention window on the
  managed instance (MANUAL — nothing in this repository schedules or exports
  backups; see `database-operations.md` §5)
- **Private bucket backup/versioning:** enable versioning/replication and an
  operator export for uploaded-file bytes — a database backup does **not**
  include them (`recovery-runbook.md` → Scenario E)
- **Monitoring/alerting:** wire the platform to `GET /health` (liveness) and
  `GET /health/ready` (readiness) and alert on the `database_unreachable_at_startup`
  event

Until these exist the app is DEPLOYMENT READY but not DEPLOYED; no step above
fakes or pre-registers any provider.
