/*
 * Production build-artifact gate (Phase 4.9).
 *
 * Read-only: it never builds, deploys, or calls a network provider. It asserts
 * that the artifacts a release would ship are the *right* ones:
 *
 *   1. backend built output exists (dist/server.js) — the long-running entry
 *   2. frontend built output exists (frontend/dist/index.html)
 *   3. the frontend bundle contains no "localhost" reference
 *   4. when EXPECTED_API_HOST is set, that host is embedded in the bundle
 *
 * Run it after `npm run build` (backend) and `npm run build` (frontend) with the
 * real production VITE_API_BASE_URL, before promoting a release:
 *
 *   EXPECTED_API_HOST=api.example.com node scripts/verify-production-build.mjs
 *
 * The frontend checks are skipped (and reported) when frontend/dist is absent,
 * so this is safe to run in a backend-only pipeline.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const backendDist = fileURLToPath(new URL("../dist", import.meta.url));
const frontendDist = fileURLToPath(new URL("../../frontend/dist", import.meta.url));

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// 1. backend built output
const serverEntry = join(backendDist, "server.js");
check("backend built output exists (dist/server.js)", existsSync(serverEntry));

// 2 & 3. frontend built output + no localhost in the bundle
const frontendIndex = join(frontendDist, "index.html");
const assetsDir = join(frontendDist, "assets");

if (!existsSync(frontendIndex)) {
  results.push("SKIP  frontend/dist not found — build the frontend first for the bundle checks");
} else {
  check("frontend built output exists (frontend/dist/index.html)", true);

  let bundleText = "";
  let bundleFiles = 0;
  if (existsSync(assetsDir)) {
    for (const file of readdirSync(assetsDir)) {
      if (!file.endsWith(".js")) continue;
      bundleFiles += 1;
      bundleText += readFileSync(join(assetsDir, file), "utf8");
    }
  }

  check("frontend bundle found (dist/assets/*.js)", bundleFiles > 0, `${bundleFiles} file(s)`);

  const localhostHits = (bundleText.match(/localhost/g) ?? []).length;
  check("frontend bundle contains no localhost reference", localhostHits === 0, `${localhostHits} hit(s)`);

  // 4. expected production API host is actually baked in, when provided
  const expectedHost = (process.env.EXPECTED_API_HOST ?? "").trim();
  if (!expectedHost) {
    results.push("SKIP  EXPECTED_API_HOST not set — production API host embedding not verified");
  } else {
    check(
      `frontend bundle embeds EXPECTED_API_HOST (${expectedHost})`,
      bundleText.includes(expectedHost)
    );
  }

  // Freshness hint only: not a failure, but a stale artifact is a common cause
  // of "we fixed it and production still shows the old bug".
  const indexAgeMs = Date.now() - statSync(frontendIndex).mtimeMs;
  results.push(`INFO  frontend/dist/index.html age: ${Math.round(indexAgeMs / 60000)} minute(s)`);
}

console.log(results.join("\n"));
if (failures > 0) {
  console.error(`\nverify:build — ${failures} check(s) failed. Rebuild with the production VITE_API_BASE_URL set.`);
  process.exit(1);
}
console.log("\nverify:build — all build checks passed");
