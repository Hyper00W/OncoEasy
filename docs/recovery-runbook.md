# Production Recovery Runbook (OncoEasy)

Operational, copy-pasteable procedures for the most likely production
incidents. Companion documents: `deployment.md` (targets, commands, order),
`database-operations.md` (migration/backup detail),
`production-configuration.md` (environment variables).

Scope: this runbook describes what the **code** does and the safe operator
response. It contains **no provider-specific CLI/API commands** that this
repository cannot verify, and **no real credentials**. Anything requiring a
provider dashboard is marked **MANUAL**.

## 0. Global rules

- **Never improvise destructive rollback.** No `prisma migrate reset`,
  `prisma db push`, `prisma migrate dev`, or `prisma db seed` — ever. They
  destroy data or drift the schema from migration history.
- **Never print secrets** (`DATABASE_URL`, JWT secrets, storage/provider keys).
  Copy them between platforms through your secret manager, not a shell history
  or a ticket.
- **Prefer forward-fix** for additive changes; **restore from backup/PITR** only
  for destructive ones (see Scenario D).
- **One change at a time**, then verify with §9 (verification checklist).
- Log lines referenced below are the structured JSON events the backend emits
  (`server_started`, `database_ready`, `database_unreachable_at_startup`,
  `server_shutdown_started`, `http_server_closed`, `database_connections_closed`,
  `server_shutdown_failed`).

---

## Scenario A — Application deployment fails

**Symptoms**
- Build step fails, or the platform reports a failed deploy/health check.
- `server_started` never appears in logs.
- The process exits non-zero immediately (env validation failure).

**Safe first action**
1. Read the deploy log. Distinguish three cases by the message:
   - `Invalid backend environment configuration:` + itemized lines → a missing
     or invalid environment variable (no secret values are printed). Fix the
     variable, redeploy.
   - `database_unreachable_at_startup` → see Scenario C.
   - A TypeScript/Prisma build error → the release artifact is bad; do not retry
     the same commit (Scenario H).
2. If the failure is config-only, fix the variable and redeploy the **same
   commit**; no migration or data action is needed.

**What NOT to do**
- Do not disable validation or "temporarily" set `NODE_ENV=development` to get
  the process up; that silently removes every production guard.
- Do not point `DATABASE_URL` at a different (dev) database to make the deploy
  green.
- Do not assume a failed deploy applied migrations — env validation and the
  startup probe run **before** `server.listen()`, and migrations are run by a
  separate command.

**Recovery procedure**
1. Correct the environment variable (or the build error via a new commit).
2. Redeploy.
3. If the deploy is unrecoverable, roll back the release (Scenario H).

**Verification**
- `server_started` logged with the expected `port` and `nodeEnv: "production"`.
- `GET /health` → `200 {"status":"ok"}`.
- `GET /health/ready` → `200` with `"database":"ok"`.

---

## Scenario B — Database migration fails

**Symptoms**
- `npm run db:migrate:deploy` exits non-zero.
- `npm run db:migrate:status` reports a **failed** migration (the row is marked
  failed in `_prisma_migrations`).
- The deploy pipeline stops before starting new application servers.

**Safe first action**
1. **Stop the release.** Do not start the new application version.
2. Run `npm run db:migrate:status` and record exactly **which** migration failed
   and whether earlier migrations in the same run already applied.
3. Determine whether the migration is **additive** (safe to forward-fix) or
   **destructive** (needs restore). The migration SQL is in
   `backend/prisma/migrations/<migration>/migration.sql`.

**What NOT to do**
- Do not run `migrate reset`, `db push`, or hand-edit/delete the failed row in
  `_prisma_migrations` without understanding the state.
- Do not re-run `migrate deploy` blindly hoping it passes — a partial
  application can leave a half-changed schema.
- Do not edit an already-applied migration file; historical migrations are
  immutable.
- Do not start the application against the half-migrated schema if the release
  depends on the missing change.

**Recovery procedure**
1. **Forward-fix (preferred):** author a **new** migration that completes or
   corrects the intended change, review its SQL, and apply it with
   `npm run db:migrate:deploy`.
2. **If the failed migration must be abandoned:** it has to be marked resolved
   per Prisma's documented procedure (operator decision, recorded in the
   incident log) before `migrate deploy` will proceed. Treat this as a
   controlled, reviewed action, not a routine fix.
3. **If data was damaged:** restore from backup/PITR (Scenario D), then re-apply
   the corrected migration chain.
4. If the release depended on the failed migration, deploy the previous
   application version instead (Scenario H) until the migration is corrected.

**Verification**
- `npm run db:migrate:status` reports "Database schema is up to date!".
- For pre-release confidence, `npm run db:verify-schema` against a disposable
  scratch database reports no drift vs `prisma/schema.prisma`.
- Smoke-check health (Scenario A verification) before resuming traffic.

---

## Scenario C — Database becomes unavailable

**Symptoms**
- `GET /health` still returns `200` (liveness is dependency-free), but
  `GET /health/ready` returns `503 {"status":"unavailable","checks":{"process":"ok","database":"unreachable"}}`.
- API requests fail with connection/timeout errors surfaced as sanitized 5xx.
- At cold start: `database_unreachable_at_startup` is logged and the process
  **exits 1** after the 60-second startup grace window (production only).
- The platform reports the instance unhealthy/restarting.

**Safe first action**
1. Confirm scope: `GET /health/ready`. A `503` with `database: "unreachable"` is
   the app's safe, non-leaking signal for "database not reachable".
2. Check the managed-database provider's status and connection limits **from the
   provider dashboard** (MANUAL). Common causes: provider outage, exhausted
   connection limit, expired credentials, network/TLS change.
3. If credentials rotated, update `DATABASE_URL` in the backend environment and
   restart — do not edit code.

**What NOT to do**
- Do not point the service at a different/dev database to "restore" health.
- Do not remove the startup probe or relax `/health/ready` so it always returns
  200 — that hides the outage from monitoring and from the orchestrator.
- Do not run migrations while the database is unavailable.
- Do not paste the connection string into logs, tickets, or screenshots.

**Recovery procedure**
1. Restore database availability (provider side), or correct `DATABASE_URL`.
2. Restart the backend so the startup probe runs cleanly.
3. Production startup intentionally **fails fast** rather than listening while
   the database is unreachable — a restart after the database is back is the
   correct recovery, not a workaround.

**Verification**
- `database_ready` logged at startup.
- `GET /health/ready` → `200` with `"database":"ok"`.
- One read-only API request (e.g. a GET with auth) succeeds.

---

## Scenario D — Database needs restoration

**Symptoms**
- Confirmed data loss/corruption (bad migration, accidental destructive write,
  provider incident) — not merely an outage.
- `migrate status` is consistent but the data is wrong.

**Safe first action**
1. **Freeze writes.** Put the application in maintenance/paused state so no new
   writes race the restore.
2. Identify the target recovery point (a timestamp before the damaging event)
   and confirm the provider's **PITR window** covers it (MANUAL — provider
   dashboard). If the window does not cover it, use the most recent backup.
3. Decide the restore type: PITR to a point in time, or restore a snapshot into a
   new instance.

**What NOT to do**
- Do not restore over the live database without first confirming the recovery
  point and taking a fresh snapshot of the current state for forensics.
- Do not run `prisma migrate reset` as a "clean reset".
- Do not assume the schema and the data restore together — confirm the restored
  database's migration state afterwards.
- Do not assume uploaded files are restored with the database (Scenario E and
  §14 of `production-configuration.md`).

**Recovery procedure** (standard managed-Postgres pattern; provider-specific
steps are MANUAL)
1. Take a snapshot of the current (damaged) database for analysis.
2. Restore to a point in time, or restore a snapshot into a new instance.
3. Point `DATABASE_URL` at the restored instance only after verifying it.
4. Run `npm run db:migrate:status`; if the application release expects schema
   newer than the restored state, apply only the additive migrations with
   `npm run db:migrate:deploy`.
5. Reconcile private uploaded files against restored storage keys (Scenario E).
6. Reopen traffic gradually.

**Verification**
- `migrate status` reports up to date for the running release.
- Targeted row counts / spot-check the affected records.
- `GET /health/ready` → `200 "database":"ok"`.
- Post-restore smoke (`npm run smoke:production` against a non-production
  database, or the platform's own health checks against production).

---

## Scenario E — Object storage becomes unavailable

**Symptoms**
- Uploads fail (`STORAGE_PROVIDER` calls error) — new prescriptions, PAP
  documents, lab reports, story/testimonial media, delivery proofs.
- Downloads that resolve through a **signed URL** fail, or the testimonial
  delivery path errors.
- With `STORAGE_PROVIDER=in-memory` (development only) objects are per-process
  and vanish on restart — production must never use it.

**Safe first action**
1. Confirm storage configuration is intact: `STORAGE_PROVIDER`, `STORAGE_BUCKET`,
   `STORAGE_REGION`, credentials, and (for `s3-compatible`) `STORAGE_ENDPOINT`.
2. Check the storage provider's status and credential validity (MANUAL).
3. If only a single object is affected, expect a deliberate safe failure: reading
   a missing object yields `404 STORAGE_OBJECT_NOT_FOUND` (never a raw provider
   error or key).

**What NOT to do**
- Do not switch `STORAGE_PROVIDER` to `in-memory` to unblock writes — production
  startup rejects it, and objects would be lost on restart.
- Do not make the bucket public or disable presigning to "make downloads work".
- Do not log or return storage keys/credentials to the frontend.
- Do not assume database rows referencing objects are restored when storage is
  (see below).

**Recovery procedure**
1. Restore provider availability or correct the configured credentials; restart
   the backend so the corrected configuration is loaded.
2. Retry the failed upload/download — the application does not persist a queue of
   failed uploads, so the user operation itself must be retried.
3. If objects were lost, restore them **separately** from the database backup
   (storage provider's own versioning/backup), then reconcile the keys recorded
   in the database.

**Verification**
- One upload succeeds end-to-end and the row's storage key resolves.
- A signed-URL download succeeds and expires as configured
  (`STORAGE_SIGNED_URL_EXPIRY_SECONDS`, default 300s).
- A missing key still returns the sanitized `404`, not a provider stack trace.

---

## Scenario F — WhatsApp/SMS/email provider becomes unavailable

**Symptoms**
- Notification sends fail; the channel raises a constant safe error
  (`NOTIFICATION_FAILED`, or the channel-specific disabled error) with **no**
  recipient, body, or credential content.
- No retry/fallback loop: each channel is attempted **at most once**.

**Safe first action**
1. Confirm which channel is enabled (`WHATSAPP_ENABLED`, `SMS_ENABLED`,
   `EMAIL_ENABLED`) — a channel that is `false` is *intentionally* off, not
   broken. In that state the deterministic in-memory mock is selected **by
   configuration**, never as a silent failure fallback.
2. Check the provider status and credential validity (MANUAL).
3. Note the current wiring: the notification layer is infrastructure built in
   Phase 3.3–3.6 and is exercised by tests; it is **not yet invoked by the
   production business workflows**, so a provider outage today does not block
   ordering, payments, or care flows. Re-check this when a workflow starts
   calling it.

**What NOT to do**
- Do not "fix" a provider outage by leaving a channel enabled with wrong
  credentials — startup validation requires credentials whenever a channel is
  enabled.
- Do not add retry storms or silent mock fallback in production.
- Do not put clinical details, OTP codes, or recipients into logs while
  debugging.

**Recovery procedure**
1. Restore the provider or rotate credentials, update the environment
   (`WHATSAPP_*`, `SMS_*`, `EMAIL_*`), and restart the backend.
2. If the channel must be paused deliberately, set its `*_ENABLED=false` — this
   is an explicit operator decision and is validated at startup.
3. Re-trigger the failed notification from the originating workflow once the
   channel is healthy.

**Verification**
- A test send to a controlled destination succeeds (MANUAL, when a workflow
  uses the channel).
- Logs contain only channel/outcome categories — no recipients, bodies, or keys.
- Startup validation still passes with the final configuration.

---

## Scenario G — Razorpay becomes unavailable

**Symptoms**
- Prepaid checkout creation or verification fails and surfaces a constant safe
  error (e.g. `PAYMENT_GATEWAY_ERROR`); never a gateway payload or key.
- With `PAYMENT_GATEWAY_ENABLED=false` the verify endpoint returns
  `503 PAYMENT_GATEWAY_DISABLED` (intentional legacy state, not an outage).
- Razorpay webhooks are not delivered / return non-2xx.

**Safe first action**
1. Confirm `PAYMENT_GATEWAY_ENABLED` and that `PAYMENT_GATEWAY_KEY_ID` /
   `PAYMENT_GATEWAY_KEY_SECRET` are present (validation requires both when the
   gateway is enabled).
2. Check Razorpay status and key validity in the dashboard (MANUAL).
3. Note the safety property: payment verification is **server-authoritative**
   (signature + re-fetch + amount/currency match), so a gateway outage cannot
   mark anything paid. Keep it that way.

**What NOT to do**
- Do not mark orders paid based on a frontend "success", a webhook without a
  verified signature, or a manual DB edit.
- Do not disable signature verification or the webhook secret check to "unblock"
  payments.
- Do not enable the **mock** gateway in production — it is reachable only through
  the explicit test seam, never via configuration or failure.
- Do not log the key secret or webhook secret.

**Recovery procedure**
1. Restore Razorpay availability or rotate keys; update
   `PAYMENT_GATEWAY_KEY_ID` / `PAYMENT_GATEWAY_KEY_SECRET` and restart.
2. If webhooks were missed, reconcile payments using the existing server-side
   verification path (re-fetch + verify) rather than by hand-editing statuses.
3. If `PAYMENT_GATEWAY_WEBHOOK_SECRET` is unset, the webhook endpoint is
   inactive by design; set it and re-register the webhook (MANUAL,
   `deployment.md` §6) if webhooks are required.

**Verification**
- A controlled verification for a known-good payment succeeds; a tampered
  signature is rejected with `PAYMENT_SIGNATURE_INVALID`.
- COD flows are unaffected; no payment status changed by gateway outage alone.
- Logs contain only outcome categories, never keys or payloads.

---

## Scenario H — Bad application release must be rolled back

**Symptoms**
- A newly deployed release produces errors, wrong behavior, or fails health
  checks despite a healthy database.
- The release did **not** include a schema migration, or included only additive
  migrations.

**Safe first action**
1. Determine whether the release included migrations:
   `git log --oneline -- backend/prisma/migrations` (or your release manifest).
2. If **no migration** (or additive-only), roll back the application code to the
   previous build — this is safe because the previous release is compatible with
   the current, superset schema.
3. If the release is still failing and you cannot roll back safely, see below.

**What NOT to do**
- Do not assume application rollback undoes a database migration. **They are not
  equivalent.** `migrate deploy` is forward-only; applied migrations are
  immutable.
- Do not write "down" migrations or run `migrate reset` to force the old code to
  work.
- Do not roll back a release that *depends* on a schema change and then point it
  at a database that has that change in a breaking form (dropped/renamed
  columns) — it will fail.
- Do not delete migration files that have already been applied in production.

**Recovery procedure**
1. **Application-only rollback** (preferred, when schema changes were additive
   and the old code ignores the new columns/tables): redeploy the previous build;
   leave the database as-is.
2. **Database-encumbered rollback** (the new migration is destructive and the old
   code cannot run against the new schema): do not improvise. Either
   (a) forward-fix the application with a new patch release, or
   (b) restore from backup/PITR to the pre-release state (Scenario D), then
   deploy the previous build.
3. Record the incident and, if the migration was destructive, adjust the
   release process so future schema changes stay additive for at least one
   release.

**Verification**
- `GET /health` → `200`; `GET /health/ready` → `200 "database":"ok"`.
- The previously failing behavior is gone in the rolled-back build.
- `npm run db:migrate:status` is consistent with the running release.
- No data was lost: spot-check records written by the bad release.

---

## 9. Verification checklist (after any recovery)

1. `GET /health` → `200 {"status":"ok"}`.
2. `GET /health/ready` → `200` with `"database":"ok"`.
3. `server_started` logged; no `database_unreachable_at_startup`.
4. `npm run db:migrate:status` → up to date (no failed/pending migrations).
5. One authenticated read-only API request succeeds.
6. Private storage upload/download round-trip works (if storage was involved).
7. No secrets or `DATABASE_URL` appear in logs.
8. `npm run smoke:production` passes (non-production database only).
