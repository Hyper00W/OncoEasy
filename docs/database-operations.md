# Database Operations (Production)

Operational guide for the OncoEasy PostgreSQL/Prisma database: safe migration
practice, verification, backups, and recovery. Application configuration lives
in `production-configuration.md`.

## 1. Database requirement

- PostgreSQL via a managed provider (Neon in development). The production
  connection string **must** carry TLS parameters (`sslmode=require`; on Neon
  also `channel_binding=require`).
- `DATABASE_URL` is the single source of truth. In production it must point at
  the production database — startup fails fast on a localhost URL
  (see `backend/src/config/env.ts`). Never reuse the development URL.

## 2. Connection management

- One shared `PrismaClient` instance (`backend/src/database/prisma.ts`); do not
  create ad-hoc clients in feature code.
- Graceful shutdown: `SIGTERM`/`SIGINT` close the HTTP server and call
  `prisma.$disconnect()` (`backend/src/server.ts`).
- When connecting through a pooled endpoint (e.g. Neon's pooler / PgBouncer in
  transaction mode), the direct (unpooled) endpoint is required for
  migrations and DDL — transaction-pooling connections cannot run
  `CREATE DATABASE` or advisory locks reliably.

## 3. Production migration workflow

The only production migration command:

```bash
npm run db:migrate:deploy   # prisma migrate deploy
```

Before deploying an application release that depends on schema changes:

1. Back up / verify PITR coverage (see §5).
2. Run `npm run db:migrate:status` and confirm it reports
   "Database schema is up to date!" after the deploy.
3. Deploy, then smoke-check the health endpoint.

**The startup probe checks reachability, not schema version.** A live database
that has not yet received a release's migration is still "reachable", so a new
server started against an **older** schema will listen and then fail at request
time on the missing columns/tables. Always run `db:migrate:deploy` **before**
starting the new application version (see `deployment.md` §3), and never start a
release whose migration has not been applied.

**Forbidden in production** (they can prompt interactively, reset data, or
drift the schema from migration history):

| Command | Why it is forbidden |
| --- | --- |
| `prisma migrate dev` | development workflow; may reset/prompt |
| `prisma db push` | bypasses migration history; causes drift |
| `prisma migrate reset` | **destroys all data** |
| `prisma db seed` | development/demo fixture data (see §7) |

## 4. Migration verification

```bash
# Offline: schema renders clean DDL from empty (no DB writes).
npm run db:verify-schema

# Full check: applies the entire migration chain to a DISPOSABLE scratch
# database and diffs the result against schema.prisma. Exit code 1 = drift.
SHADOW_DATABASE_URL=postgresql://...scratch_db... npm run db:verify-schema
```

Verification performed for Phase 3.9: all migrations applied from an empty
scratch database reproduce `prisma/schema.prisma` exactly; `migrate status`
reports up to date.

Re-verified for Phase 4.9: `prisma validate` reports the schema valid and
`migrate status` reports **29 migrations found** and "Database schema is up to
date!" against the development database. The offline render check passes
(`schema.prisma` renders clean DDL from empty, 1177 lines); the full
from-empty chain equivalence check is **skipped unless `SHADOW_DATABASE_URL`
points at a disposable scratch database**, so run it with that variable before
any high-risk release rather than assuming it ran.

Detecting a failed migration: `npm run db:migrate:status` will report a failed
migration and mark it in the `_prisma_migrations` table. A failed migration
must be resolved manually (fix forward with a new migration, or in extreme
cases resolve the failed row per Prisma docs) — never by resetting.

## 5. Backups and recovery

> **Status marker.** Backup/PITR **automation is not implemented in this
> repository** and no backup is claimed to exist. What the code contributes is
> *readiness*: a documented strategy, restart-safe startup, and verification
> commands. Enabling and monitoring backups is **MANUAL PRODUCTION SETUP
> REQUIRED** (provider dashboard + operator process).

### 5.1 Two backup scopes (they are separate)

| Scope | What it covers | Who provides it | Status |
| --- | --- | --- | --- |
| **Database** | All relational data — users, orders, payments, appointments, prescription *metadata*, lab bookings, PAP applications, referrals, journey state, knowledge/trials, stories, testimonials, refresh sessions, audit events, analytics events | Managed PostgreSQL provider (PITR/snapshots) | **MANUAL PRODUCTION SETUP REQUIRED** |
| **Private uploaded files** | The **bytes** in the private S3-compatible bucket (prescriptions, PAP documents, lab reports, story/testimonial media, delivery/payment proofs) | Storage provider versioning/replication **plus** an operator-run export | **MANUAL PRODUCTION SETUP REQUIRED** |

**Do not assume uploaded files are backed up because the database is.** The two
systems are independent: a database restore brings back the *rows and storage
keys*, but the object bytes live only in the bucket. A restore is incomplete
until both scopes are recovered and reconciled (see §5.4).

### 5.2 Database strategy (MANUAL, provider-configurable)

- **Automated backups / PITR:** enable continuous backups or PITR on the managed
  instance and **confirm the retention window before go-live**. The application
  performs no exports and no scheduled dumps.
- **Retention:** choose a window that covers your worst plausible
  detection-to-response delay (e.g. ≥7 days; longer for regulated data). Verify
  that the window actually covers the point you would need — an untested window
  is not a backup guarantee.
- **Verification:** take/confirm a recovery point **immediately before** any
  release that contains a new migration, and periodically test a restore into a
  disposable instance (an untested backup is not a backup).
- **Access control:** backup/PITR restore is a privileged operator action; do not
  hand restore credentials to application runtimes.

### 5.3 Who performs a restore

Restore operations are performed by the **operator/platform owner** through the
managed provider's console/API — never by the application and never from a
running backend process. The application's only recovery-related behavior is
failing fast at startup when its database is unreachable (`server.ts`).

### 5.4 Restore procedure and post-restore verification

Full step-by-step procedures (including freeze-writes, choosing a recovery
point, and reconciliation) live in `recovery-runbook.md` → Scenario D. In short:

1. Freeze application writes; snapshot the current (damaged) state for forensics.
2. Restore to a point in time (or restore a snapshot into a new instance).
3. Point `DATABASE_URL` at the verified restored instance.
4. `npm run db:migrate:status` — apply only additive migrations if the restored
   schema predates the running release (`npm run db:migrate:deploy`).
5. Restore the **private file bytes separately** and reconcile storage keys
   (`recovery-runbook.md` → Scenario E).
6. Verify: `migrate status` up to date, targeted row spot-checks,
   `GET /health/ready` → `200 "database":"ok"`.

### 5.5 Rollback strategy

The application does **not** provide schema rollback. `migrate deploy` only
moves forward; historical migrations are immutable once applied. There is
deliberately no automatic/improvized destructive rollback.

- **Application rollback**: redeploy the previous application version. It must
  remain compatible with the current schema — therefore schema changes should
  be additive for at least one release before any column/table is removed.
- **Migration-encumbered rollback**: if a release introduced a *destructive*
  migration, application rollback alone is unsafe (the old code cannot run
  against the new schema). Forward-fix with a new patch release, or restore from
  backup/PITR if data damage occurred.
- **Schema-breaking changes**: do not write "down" migrations. Choose deliberately
  per change: **forward-fix** for additive changes, **restore** for destructive
  ones.

The full decision tree, including what *not* to do, is in
`recovery-runbook.md` → Scenario H.

## 6. Migration safety review (Phase 3.9)

The migration chain was reviewed for:

- destructive `DROP`s of columns/tables — none outside the init baseline;
- `NOT NULL` additions — none without defaults;
- unique constraints on possibly-duplicated data — the two Phase 3
  constraints (`payments.provider_order_id`, `lab_bookings.external_order_id`)
  are nullable and were checked for duplicates before creation;
- FKs that could fail on existing rows — all new FKs are nullable additions;
- long table locks — the only index migration (`deliveries_status_mode_created_at_idx`)
  is a non-concurrent `CREATE INDEX` on an append-mostly, currently small
  table; revisit `CREATE INDEX CONCURRENTLY` if deliveries grow large.

## 7. Seed restrictions

- `prisma/seed.ts` **refuses to run unless `NODE_ENV=development`** and only
  inserts fictional demo fixtures via upserts.
- Production startup never seeds; `migrate deploy` never seeds.
- Never run `prisma db seed` against staging/production.

## 8. Environment separation

- `.env` files are git-ignored (`backend/.gitignore`); only `.env.example`
  (placeholders, no secrets) is committed.
- Use distinct databases (and ideally distinct providers/projects) for
  development, CI, staging, and production. Never copy a production
  `DATABASE_URL` into a development `.env` or vice versa.
- Never print or log connection strings; error sanitization is covered in
  `production-configuration.md`.
