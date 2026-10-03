/*
 * Production-style smoke test (Phase 4.9).
 *
 * Starts the BUILT backend (dist/server.js) with NODE_ENV=production against a
 * real (dev/test) database, then asserts the deployment-critical behaviors:
 *
 *   1. process starts and stays up (env validation + startup DB probe passed)
 *   2. GET /health            -> 200 liveness, no dependency detail
 *   3. GET /health/ready      -> 200 readiness with database connectivity
 *   4. auth endpoint answers  -> validation error, never a connection failure
 *   5. protected endpoint     -> 401 with a sanitized error shape
 *
 * No real external providers are called (WhatsApp/SMS/email/payments stay
 * disabled; storage may be in-memory only because the production in-memory
 * guard is intentionally bypassed for this local smoke run via STORAGE_IN_MEMORY_SMOKE=1).
 *
 * Usage: node scripts/smoke-production.js   (build first: npm run build)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Configuration from the committed development .env (never real secrets).
// ---------------------------------------------------------------------------
let databaseUrl = process.env.DATABASE_URL ?? "";
try {
  const envFile = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+)\s*$/.exec(line);
    if (match) {
      databaseUrl = match[1].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env missing — rely on ambient DATABASE_URL.
}
if (!databaseUrl) {
  console.error("smoke: DATABASE_URL is required (set it or provide backend/.env)");
  process.exit(1);
}

// The smoke run borrows the development database but exercises production-mode
// validation. The in-memory storage guard is valid for production generally;
// this flag exists only so the smoke run can use dev defaults.
process.env.STORAGE_IN_MEMORY_SMOKE = "1";

const childEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: "3577",
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET: "smoke-access-secret-0123456789abcdef0123456789abcdef",
  JWT_REFRESH_SECRET: "smoke-refresh-secret-0123456789abcdef0123456789abcdef",
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_EXPIRES_IN: "7d",
  CORS_ORIGIN: "http://localhost:3577",
  STORAGE_IN_MEMORY_SMOKE: "1"
};

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const tmpDir = mkdtempSync(join(tmpdir(), "onco-smoke-"));
const logPath = join(tmpDir, "server.log");
const logStream = [];
const child = spawn(process.execPath, [join(process.cwd(), "dist", "server.js")], {
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => logStream.push(String(chunk)));
child.stderr.on("data", (chunk) => logStream.push(String(chunk)));

const logs = () => logStream.join("");

function waitFor(predicate, { timeoutMs = 30_000, intervalMs = 300 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

async function main() {
  // 1. process starts and stays up
  try {
    await waitFor(() => logs().includes("server_started"), { timeoutMs: 30_000 });
    check("production process starts (env validation + startup DB probe)", true);
  } catch {
    check("production process starts (env validation + startup DB probe)", false, "server_started never logged");
  }
  await new Promise((r) => setTimeout(r, 300));

  const base = "http://127.0.0.1:3577";

  // 2. liveness
  try {
    const health = await fetch(`${base}/health`);
    const body = await health.json().catch(() => ({}));
    check("GET /health -> 200 liveness", health.status === 200 && body.status === "ok", `status=${health.status}`);
  } catch (error) {
    check("GET /health -> 200 liveness", false, String(error));
  }

  // 3. readiness (real database connectivity)
  try {
    const ready = await fetch(`${base}/health/ready`);
    const body = await ready.json().catch(() => ({}));
    check(
      "GET /health/ready -> 200 readiness with database connectivity",
      ready.status === 200 && body?.checks?.database === "ok",
      `status=${ready.status} checks=${JSON.stringify(body?.checks ?? null)}`
    );
  } catch (error) {
    check("GET /health/ready -> 200 readiness", false, String(error));
  }

  // 4. auth endpoint answers (validation error, not connection failure)
  try {
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.com", password: "wrong-password" })
    });
    const body = await login.json().catch(() => ({}));
    check(
      "POST /api/v1/auth/login answers with a normal error response",
      login.status >= 400 && login.status < 500 && typeof body?.error?.code === "string",
      `status=${login.status} code=${body?.error?.code ?? "none"}`
    );
  } catch (error) {
    check("POST /api/v1/auth/login answers", false, String(error));
  }

  // 5. protected endpoint returns sanitized unauthorized
  try {
    const guarded = await fetch(`${base}/api/v1/pharmacy/cart`, {
      headers: { Authorization: "Bearer not-a-real-token" }
    });
    const body = await guarded.json().catch(() => ({}));
    check(
      "GET /api/v1/pharmacy/cart with a bogus token -> sanitized 401",
      guarded.status === 401 && body?.success === false && typeof body?.error?.code === "string" && !("stack" in (body?.error ?? {})),
      `status=${guarded.status} code=${body?.error?.code ?? "none"}`
    );
  } catch (error) {
    check("GET /api/v1/pharmacy/cart -> sanitized 401", false, String(error));
  }

  // 6. secrets never in logs
  const logText = logs();
  const secretLeak = [childEnv.JWT_ACCESS_SECRET, childEnv.JWT_REFRESH_SECRET, databaseUrl].filter((secret) =>
    logText.includes(secret)
  );
  check("no secrets or DATABASE_URL in server logs", secretLeak.length === 0, secretLeak.length ? "leak found" : "");

  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));

  console.log(results.join("\n"));
  if (failures > 0) {
    console.error(`\nsmoke: ${failures} check(s) failed. server log:\n${logText.slice(-2000)}`);
    process.exit(1);
  }
  console.log("\nsmoke: all production smoke checks passed");
}

main()
  .catch(async (error) => {
    console.error(`smoke: unexpected failure — ${error.message}`);
    console.error(logs().slice(-2000));
    child.kill("SIGTERM");
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
