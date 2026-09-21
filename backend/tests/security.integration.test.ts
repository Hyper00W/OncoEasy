import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { AddressInfo, Server } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { UserRole } from "@prisma/client";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";

let server: Server;
let baseUrl: string;
const testKey = `phase3_11-${Date.now()}`;
const createdUserIds: string[] = [];
const createdSessionIds: string[] = [];
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

before(async () => {
  const { default: app } = await import("../src/app");
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { address: host, port } = address as AddressInfo;
  baseUrl = `http://${host}:${port}`;
});

after(async () => {
  const { prisma } = await import("../src/database/prisma");
  // OTP-request rate-limit test creates challenges for synthetic numbers.
  await prisma.patientOtpChallenge.deleteMany({ where: { phone: { startsWith: "+1555000" } } });
  await prisma.chatSession.deleteMany({ where: { id: { in: createdSessionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

// ---------------------------------------------------------------------------
// Production configuration validation (spawned child processes)
// ---------------------------------------------------------------------------

function runEnvProcess(childEnv: Record<string, string | undefined>): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...childEnv, PORT: childEnv.PORT ?? "3000" };
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/config/env.ts"], {
      cwd: backendRoot,
      env: mergedEnv
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

const baseProductionEnv: Record<string, string> = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.prod.example.com:5432/db?sslmode=require",
  CORS_ORIGIN: "https://app.example.com",
  JWT_ACCESS_SECRET: "a".repeat(40),
  JWT_REFRESH_SECRET: "b".repeat(40)
};

test("production config rejects a localhost database", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, DATABASE_URL: "postgresql://u:p@localhost:5432/db" });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("DATABASE_URL must not point at localhost in production"));
});

test("production config rejects wildcard CORS", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, CORS_ORIGIN: "*" });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("CORS"));
});

test("production config rejects weak JWT secrets", async () => {
  const result = await runEnvProcess({ ...baseProductionEnv, JWT_ACCESS_SECRET: "short" });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("JWT secrets must be at least 32 characters in production"));
});

test("production config rejects missing required variables with per-variable errors", async () => {
  const result = await runEnvProcess({ NODE_ENV: "production" });
  assert.equal(result.code, 1);
  assert.ok(result.output.includes("Invalid backend environment configuration"));
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test("invalid, expired and malformed tokens are rejected with sanitized 401s", async () => {
  const garbage = await request("GET", "/api/v1/chat/sessions", "not-a-jwt");
  assert.equal(garbage.status, 401);
  assert.equal(garbage.body.error.code, "UNAUTHORIZED");
  assert.equal(garbage.body.error.message, "Invalid or expired access token");

  const signedWithWrongSecret = jwt.sign({ userId: "00000000-0000-0000-0000-000000000000", role: "PATIENT" }, "totally-wrong-secret");
  const wrongSecret = await request("GET", "/api/v1/chat/sessions", signedWithWrongSecret);
  assert.equal(wrongSecret.status, 401);

  const expired = jwt.sign({ userId: "00000000-0000-0000-0000-000000000000", role: "PATIENT" }, process.env.JWT_ACCESS_SECRET as string, { expiresIn: "-10s" });
  const expiredResponse = await request("GET", "/api/v1/chat/sessions", expired);
  assert.equal(expiredResponse.status, 401);
  assert.ok(!JSON.stringify(expiredResponse.body).includes("secret"));

  const noToken = await request("GET", "/api/v1/chat/sessions");
  assert.equal(noToken.status, 401);
});

test("refresh tokens cannot be used as access tokens", async () => {
  const { generateRefreshToken } = await import("../src/services/jwt");
  const patient = await createUser("refresh", UserRole.PATIENT);
  const refreshToken = generateRefreshToken({ userId: patient.id, role: UserRole.PATIENT });
  const response = await request("GET", "/api/v1/chat/sessions", refreshToken);
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// RBAC boundaries (server-side, frontend-independent)
// ---------------------------------------------------------------------------

test("non-patient roles are blocked from patient chat and unauthenticated users from admin analytics", async () => {
  const doctor = await createUser("doctor-rbac", UserRole.DOCTOR);
  const pharmacist = await createUser("pharmacist-rbac", UserRole.PHARMACIST);
  const doctorToken = await tokenFor(doctor.id, UserRole.DOCTOR);
  const pharmacistToken = await tokenFor(pharmacist.id, UserRole.PHARMACIST);
  const asDoctor = await request("GET", "/api/v1/chat/sessions", doctorToken);
  const asPharmacist = await request("POST", "/api/v1/chat/sessions", pharmacistToken);
  const anonymousAnalytics = await request("GET", "/api/v1/admin/analytics/overview");
  const anonymousAdmin = await request("GET", "/api/v1/admin/overview");
  assert.equal(asDoctor.status, 403);
  assert.equal(asPharmacist.status, 403);
  assert.equal(anonymousAnalytics.status, 401);
  assert.equal(anonymousAdmin.status, 401);
});

test("patient cannot reach OPS_ADMIN-only surfaces", async () => {
  const patient = await createUser("patient-admin", UserRole.PATIENT);
  const patientToken = await tokenFor(patient.id, UserRole.PATIENT);
  const overview = await request("GET", "/api/v1/admin/overview", patientToken);
  const stories = await request("GET", "/api/v1/admin/stories", patientToken);
  const labsDsa = await request("GET", "/api/v1/admin/labs/dsa-queue", patientToken);
  const referrals = await request("GET", "/api/v1/admin/referrals", patientToken);
  assert.equal(overview.status, 403);
  assert.equal(stories.status, 403);
  assert.equal(labsDsa.status, 403);
  assert.equal(referrals.status, 403);
});

// ---------------------------------------------------------------------------
// Cross-tenant / ownership isolation
// ---------------------------------------------------------------------------

test("a patient cannot read or post into another patient's chat session", async () => {
  const owner = await createUser("owner-iso", UserRole.PATIENT);
  const attacker = await createUser("attacker-iso", UserRole.PATIENT);
  const ownerToken = await tokenFor(owner.id, UserRole.PATIENT);
  const attackerToken = await tokenFor(attacker.id, UserRole.PATIENT);
  const created = await request("POST", "/api/v1/chat/sessions", ownerToken);
  assert.equal(created.status, 201);
  const sessionId = created.body.data.sessionId as string;
  createdSessionIds.push(sessionId);

  const read = await request("GET", `/api/v1/chat/sessions/${sessionId}`, attackerToken);
  assert.equal(read.status, 404);
  const post = await request("POST", `/api/v1/chat/sessions/${sessionId}/messages`, attackerToken, { content: "hello" });
  assert.equal(post.status, 404);
  const ownRead = await request("GET", `/api/v1/chat/sessions/${sessionId}`, ownerToken);
  assert.equal(ownRead.status, 200);
});

// ---------------------------------------------------------------------------
// Error sanitization
// ---------------------------------------------------------------------------

test("malformed JSON and unexpected failures return sanitized errors without stack traces", async () => {
  const malformed = await fetch(`${baseUrl}/api/v1/auth/patient/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not valid json"
  });
  assert.equal(malformed.status, 400);
  const malformedBody = (await malformed.json()) as Record<string, any>;
  assert.equal(malformedBody.error.code, "MALFORMED_JSON");
  assert.ok(!JSON.stringify(malformedBody).includes("at "));

  const admin = await createUser("admin-500", UserRole.OPS_ADMIN);
  const adminToken = await tokenFor(admin.id, UserRole.OPS_ADMIN);
  const broken = await request("GET", "/api/v1/admin/overview?days=not-a-number", adminToken);
  if (broken.status >= 500) {
    const serialized = JSON.stringify(broken.body);
    assert.ok(!serialized.includes("at ") && !serialized.includes("node_modules"));
  }
});

// ---------------------------------------------------------------------------
// Rate limiting (new in this phase)
// ---------------------------------------------------------------------------

test("auth login endpoint returns 429 after the configured burst", async () => {
  const emails: string[] = [];
  for (let index = 0; index < 35; index += 1) {
    emails.push(`${testKey}-rl-${index}@example.com`);
  }
  const responses: number[] = [];
  for (const email of emails) {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "wrong-password" })
    });
    responses.push(response.status);
  }
  assert.equal(responses.filter((status) => status === 429).length > 0, true);
  const limited = responses[responses.length - 1];
  assert.equal(limited, 429);
});

test("patient OTP request endpoint returns 429 after the configured burst", async () => {
  const responses: number[] = [];
  for (let index = 0; index < 15; index += 1) {
    const response = await fetch(`${baseUrl}/api/v1/auth/patient/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: `+1555000${String(1000 + index)}` })
    });
    responses.push(response.status);
  }
  assert.equal(responses[responses.length - 1], 429);
  assert.equal(responses.some((status) => status === 429), true);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(name: string, role: UserRole) {
  const { prisma } = await import("../src/database/prisma");
  const user = await prisma.user.create({
    data: {
      fullName: `${testKey} ${name}`,
      email: `${testKey}-${name}@example.com`,
      phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
      role,
      isVerified: true
    }
  });
  createdUserIds.push(user.id);
  return user;
}

async function tokenFor(userId: string, role: UserRole) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}
