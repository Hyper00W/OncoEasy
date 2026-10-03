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
const testKey = `phase4_6-${Date.now()}`;
const userIds: string[] = [];
const sessionIds: string[] = [];

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser("patient"),
    createUser("admin", UserRole.OPS_ADMIN)
  ]);
  userIds.push(...users.map((user) => user.id));
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
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function createUser(suffix: string, role: UserRole = UserRole.PATIENT) {
  const { prisma } = await import("../src/database/prisma");
  return prisma.user.create({
    data: {
      fullName: `${testKey} ${suffix}`,
      email: `${testKey}-${suffix}@example.com`,
      phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
      role,
      isVerified: true
    }
  });
}

async function createSession(userId: string, role: UserRole = UserRole.PATIENT) {
  const { issueRefreshSession } = await import("../src/modules/auth/refresh-session.service");
  const token = await issueRefreshSession(userId, role);
  return token;
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function get(path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("valid refresh token issues new access token and rotates the refresh token", async () => {
  const token = await createSession(userIds[0]!, UserRole.PATIENT);

  const response = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);

  const data = response.body.data as Record<string, unknown>;
  assert.equal(typeof data.accessToken, "string");
  assert.equal(typeof data.refreshToken, "string");
  assert.notEqual(data.refreshToken, token); // rotated
  assert.ok(!("user" in data)); // no user-sensitive data in refresh response

  // New access token authorizes a protected request.
  const protectedResponse = await get("/api/v1/chat/sessions", data.accessToken as string);
  assert.equal(protectedResponse.status, 200);
});

test("rotated (old) refresh token cannot be replayed", async () => {
  const token = await createSession(userIds[0]!, UserRole.PATIENT);
  const first = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(first.status, 200);

  const replay = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(replay.status, 401);
  assert.equal((replay.body.error as Record<string, unknown>).code, "INVALID_REFRESH_TOKEN");
});

test("revoked refresh token is rejected (logout invalidates refresh)", async () => {
  const token = await createSession(userIds[0]!, UserRole.PATIENT);

  const logout = await post("/api/v1/auth/logout", { refreshToken: token });
  assert.equal(logout.status, 200);

  const afterLogout = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(afterLogout.status, 401);
});

test("expired refresh session is rejected", async () => {
  const { prisma } = await import("../src/database/prisma");
  const token = await createSession(userIds[0]!, UserRole.PATIENT);

  // Force the session row to look expired.
  await prisma.refreshSession.updateMany({
    where: {}, // narrowed by token uniqueness below
    data: {}
  }).catch(() => undefined);

  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.refreshSession.updateMany({
    where: { tokenHash },
    data: { expiresAt: new Date(Date.now() - 1000) }
  });

  const response = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(response.status, 401);
});

test("invalid (forged) refresh token is rejected without leaking details", async () => {
  const response = await post("/api/v1/auth/refresh", { refreshToken: "not-a-real-token" });
  assert.equal(response.status, 401);
  const message = JSON.stringify(response.body).toLowerCase();
  assert.ok(!message.includes("jwt"));
  assert.ok(!message.includes("secret"));
  assert.ok(!message.includes("hash"));
});

test("access tokens are not accepted by the refresh endpoint (wrong token type)", async () => {
  const { generateAccessToken } = await import("../src/services/jwt");
  const accessToken = generateAccessToken({ userId: userIds[0]!, role: UserRole.PATIENT });

  const response = await post("/api/v1/auth/refresh", { refreshToken: accessToken });
  assert.equal(response.status, 401);
});

test("refresh does not restore access for a deleted user", async () => {
  const { prisma } = await import("../src/database/prisma");
  const doomed = await createUser("doomed");
  userIds.push(doomed.id);
  const token = await createSession(doomed.id, UserRole.PATIENT);

  await prisma.user.delete({ where: { id: doomed.id } });

  const response = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(response.status, 401);
});

test("refresh does not restore access for a deactivated account", async () => {
  const { prisma } = await import("../src/database/prisma");
  const deactivated = await createUser("deactivated");
  userIds.push(deactivated.id);
  const token = await createSession(deactivated.id, UserRole.PATIENT);

  await prisma.user.update({ where: { id: deactivated.id }, data: { isActive: false } });

  const response = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(response.status, 401);
});

test("refresh mints access tokens from the authoritative DB role, not a stale credential claim", async () => {
  const { prisma } = await import("../src/database/prisma");
  const promoted = await createUser("promoted", UserRole.PATIENT);
  userIds.push(promoted.id);
  const token = await createSession(promoted.id, UserRole.PATIENT);

  // Role changed server-side after the session was issued. Refresh must mint
  // the access token with the CURRENT backend role — never a role carried by
  // the credential — so permissions can neither be widened by nor trapped at
  // a stale value.
  await prisma.user.update({ where: { id: promoted.id }, data: { role: UserRole.OPS_ADMIN } });

  const response = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(response.status, 200);

  const data = response.body.data as Record<string, unknown>;
  const adminOnly = await get("/api/v1/admin/analytics/overview", data.accessToken as string);
  assert.equal(adminOnly.status, 200);
});

test("malformed refresh request body is rejected", async () => {
  const missing = await post("/api/v1/auth/refresh", {});
  assert.equal(missing.status, 400);

  const wrongType = await post("/api/v1/auth/refresh", { refreshToken: 12345 });
  assert.equal(wrongType.status, 400);
});

test("concurrent refresh with the same token: exactly one succeeds, the replay fails", async () => {
  const token = await createSession(userIds[0]!, UserRole.PATIENT);

  const [a, b, c] = await Promise.all([
    post("/api/v1/auth/refresh", { refreshToken: token }),
    post("/api/v1/auth/refresh", { refreshToken: token }),
    post("/api/v1/auth/refresh", { refreshToken: token })
  ]);

  const successes = [a, b, c].filter((r) => r.status === 200);
  const failures = [a, b, c].filter((r) => r.status === 401);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 2);
});

test("access tokens still work normally and RBAC still applies after refresh", async () => {
  const token = await createSession(userIds[1]!, UserRole.OPS_ADMIN);
  const refreshed = await post("/api/v1/auth/refresh", { refreshToken: token });
  assert.equal(refreshed.status, 200);

  const data = refreshed.body.data as Record<string, unknown>;
  const accessToken = data.accessToken as string;

  // Admin endpoint accepts the refreshed admin token.
  const adminOk = await get("/api/v1/admin/analytics/overview", accessToken);
  assert.equal(adminOk.status, 200);

  // Patient-only endpoint rejects the admin token (RBAC intact post-refresh).
  const patientOnly = await get("/api/v1/chat/sessions", accessToken);
  assert.equal(patientOnly.status, 403);
});

test("refresh tokens cannot be used as access tokens (end-to-end)", async () => {
  const token = await createSession(userIds[0]!, UserRole.PATIENT);
  const response = await get("/api/v1/chat/sessions", token);
  assert.equal(response.status, 401);
});
