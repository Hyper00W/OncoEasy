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

Verification performed for Phase 3.9: all 26 migrations applied from an empty
scratch database reproduce `prisma/schema.prisma` exactly; `migrate status`
reports up to date.

Detecting a failed migration: `npm run db:migrate:status` will report a failed
migration and mark it in the `_prisma_migrations` table. A failed migration
must be resolved manually (fix forward with a new migration, or in extreme
cases resolve the failed row per Prisma docs) — never by resetting.

## 5. Backups and recovery

- **Backup responsibility sits with the managed PostgreSQL provider and the
  operator, not the application.** The application performs no exports.
- On Neon (and comparable providers), enable Point-in-Time Recovery / history
  retention and confirm the retention window before go-live.
- Snapshot/verify a backup immediately before any release that contains a new
  migration.
- The application does **not** provide schema rollback. `migrate deploy` only
  moves forward; historical migrations are immutable once applied.

### Rollback strategy

- **Application rollback**: redeploy the previous application version. It must
  remain compatible with the current schema — therefore schema changes should
  be additive for at least one release before any column/table is removed.
- **Schema-breaking changes**: do not write "down" migrations. Restore from
  backup/PITR if data damage occurred, or **forward-fix** with a new
  corrective migration. Choose based on whether the change is destructive
  (restore) or additive (forward-fix).

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
