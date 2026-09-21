/*
 * Migration verification (Phase 3.9): confirms the migration history is
 * internally consistent and — when a disposable shadow database is provided —
 * that applying every migration from an empty database reproduces
 * prisma/schema.prisma exactly. Run via `npm run db:verify-schema`.
 *
 * Checks:
 *   1. Offline: `prisma migrate diff --from-empty --to-schema-datamodel`
 *      renders the current schema DDL cleanly (no database needed).
 *   2. Live (set SHADOW_DATABASE_URL to a scratch PostgreSQL database —
 *      NEVER a shared or production database):
 *      `prisma migrate diff --from-migrations --to-schema-datamodel
 *      --shadow-database-url <url> --exit-code` applies the full migration
 *      chain to the scratch database and diffs the result against
 *      schema.prisma; exit code 1 means drift.
 *
 * DATABASE_URL must exist in the environment for the Prisma CLI to load, but
 * this script never executes anything against it. Connection strings are
 * never printed.
 */

const { execFileSync } = require("node:child_process");

const prismaCli = require.resolve("prisma/build/index.js");

function runPrisma(args) {
  try {
    return execFileSync(process.execPath, [prismaCli, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`.trim();
    const wrapped = new Error(output || "prisma CLI failed");
    wrapped.exitCode = error.status;
    throw wrapped;
  }
}

let failures = 0;

// 1. Offline check: the schema itself renders clean DDL from empty.
try {
  const ddl = runPrisma([
    "migrate", "diff",
    "--from-empty",
    "--to-schema-datamodel", "prisma/schema.prisma",
    "--script"
  ]);
  console.log(`[ok] schema.prisma renders clean DDL from empty (${ddl.split("\n").length} lines).`);
} catch (error) {
  failures += 1;
  console.error("[fail] schema.prisma does not render cleanly:", error.message);
}

// 2. Full-chain equivalence when a shadow database is provided.
if (process.env.SHADOW_DATABASE_URL) {
  try {
    runPrisma([
      "migrate", "diff",
      "--from-migrations", "prisma/migrations",
      "--to-schema-datamodel", "prisma/schema.prisma",
      "--shadow-database-url", process.env.SHADOW_DATABASE_URL,
      "--exit-code"
    ]);
    console.log("[ok] applying every migration from empty reproduces schema.prisma exactly.");
  } catch (error) {
    failures += 1;
    if (error.exitCode === 1) {
      console.error("[fail] migration history does NOT reproduce schema.prisma. Diff:");
      console.error(error.message);
    } else {
      console.error("[fail] shadow-database verification failed:", error.message);
    }
  }
} else {
  console.log("[skip] SHADOW_DATABASE_URL not set — from-empty chain equivalence not verified in this run.");
  console.log("       To run the full check, point it at a disposable scratch database:");
  console.log("       SHADOW_DATABASE_URL=postgresql://user:pass@host:5432/scratch_db npm run db:verify-schema");
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("Migration verification passed.");
}
