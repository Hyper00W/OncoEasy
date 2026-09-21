import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { UserRole } from "@prisma/client";
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
let patientId: string;
let adminId: string;
const testKey = `phase1_19-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const patient = await createUser(prisma, "patient", UserRole.PATIENT);
  const admin = await createUser(prisma, "admin", UserRole.OPS_ADMIN);
  patientId = patient.id;
  adminId = admin.id;
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
  await prisma.user.deleteMany({ where: { id: { in: [patientId, adminId] } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("malformed JSON returns the standard 400 error envelope", async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid"
  });
  const body = await response.json() as { success: boolean; error: { code: string } };
  assert.equal(response.status, 400);
  assert.deepEqual(body, { success: false, error: { code: "MALFORMED_JSON", message: "Request body contains invalid JSON" } });
});

test("invalid tokens are rejected and admin analytics remains OPS_ADMIN-only", async () => {
  const unauthenticated = await request("GET", "/api/v1/admin/analytics/overview");
  const invalid = await request("GET", "/api/v1/admin/analytics/overview", "not-a-token");
  const patient = await request("GET", "/api/v1/admin/analytics/overview", await tokenFor(patientId, UserRole.PATIENT));
  const admin = await request("GET", "/api/v1/admin/analytics/overview", await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(unauthenticated.status, 401);
  assert.equal(invalid.status, 401);
  assert.equal(patient.status, 403);
  assert.equal(admin.status, 200);
});

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role: UserRole) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}