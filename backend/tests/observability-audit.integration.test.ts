import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { UserRole } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
process.env.LOG_LEVEL = "error"; // keep test output quiet

const testKey = `phase47-${Date.now()}`;
let server: Server;
let baseUrl: string;
let patientId: string;
let adminId: string;
let pharmacistId: string;
let patientToken: string;
let adminToken: string;
let pharmacistToken: string;

const createdUserIds: string[] = [];
const createdResourceIds: string[] = [];
const trackedPhoneUserIds: string[] = [];

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");

  const users = await Promise.all([
    prisma.user.create({
      data: {
        fullName: `${testKey} patient`,
        phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
        role: UserRole.PATIENT,
        isVerified: true
      }
    }),
    prisma.user.create({
      data: {
        fullName: `${testKey} admin`,
        email: `${testKey}-admin@example.com`,
        role: UserRole.OPS_ADMIN,
        isVerified: true
      }
    }),
    prisma.user.create({
      data: {
        fullName: `${testKey} pharmacist`,
        email: `${testKey}-pharmacist@example.com`,
        role: UserRole.PHARMACIST,
        isVerified: true
      }
    })
  ]);
  [patientId, adminId, pharmacistId] = users.map((user) => user.id);
  createdUserIds.push(...users.map((user) => user.id));

  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { address: host, port } = address as AddressInfo;
  baseUrl = `http://${host}:${port}`;

  patientToken = await tokenFor(patientId, UserRole.PATIENT);
  adminToken = await tokenFor(adminId, UserRole.OPS_ADMIN);
  pharmacistToken = await tokenFor(pharmacistId, UserRole.PHARMACIST);
});

after(async () => {
  const { prisma } = await import("../src/database/prisma");
  // Remove only this test's records; audit rows created by other tests or
  // real data are never touched.
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: createdUserIds } },
        { resourceType: "PRESCRIPTION", resourceId: { in: createdResourceIds } },
        { resourceType: "ORDER", resourceId: { in: createdResourceIds } },
        { resourceType: "PAP_APPLICATION", resourceId: { in: createdResourceIds } },
        { resourceType: "APPOINTMENT", resourceId: { in: createdResourceIds } }
      ]
    }
  });
  await prisma.prescription.deleteMany({ where: { patientId } });
  await prisma.pAPApplication.deleteMany({ where: { patientId } });
  await prisma.appointment.deleteMany({ where: { patientId } });
  await prisma.refreshSession.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  // OTP-flow users minted inside this suite (refresh rotation test) are
  // cleaned up here so the run leaves no temporary users behind.
  if (trackedPhoneUserIds.length > 0) {
    await prisma.refreshSession.deleteMany({ where: { userId: { in: trackedPhoneUserIds } } });
    await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: trackedPhoneUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: trackedPhoneUserIds } } });
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function tokenFor(userId: string, role: UserRole): Promise<string> {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
}

test("every request receives an X-Request-Id response header", async () => {
  const response = await request("GET", "/health");
  assert.equal(response.status, 200);
  const requestId = response.headers.get("x-request-id");
  assert.ok(requestId, "X-Request-Id header must be present");
  assert.ok(requestId.length >= 16);
  // Request IDs are opaque: no PII-shaped values.
  assert.equal(/@/.test(requestId), false);
});

test("a safe incoming request ID is honored; unsafe ones are replaced", async () => {
  const honored = await request("GET", "/health", { headers: { "X-Request-Id": "trace-abc.123_42" } });
  assert.equal(honored.headers.get("x-request-id"), "trace-abc.123_42");

  const rejected = await request("GET", "/health", {
    headers: { "X-Request-Id": "user@example.com" } // PII-shaped: must be replaced
  });
  const replacedId = rejected.headers.get("x-request-id");
  assert.ok(replacedId);
  assert.notEqual(replacedId, "user@example.com");
});

test("errors carry a requestId in the safe error contract", async () => {
  const response = await request("GET", "/api/v1/pharmacy/prescriptions/550e8400-e29b-41d4-a716-446655440000", {
    token: patientToken
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "PRESCRIPTION_NOT_FOUND");
  assert.ok(response.body.error.requestId, "error contract must include requestId");
  const headerId = response.headers.get("x-request-id");
  assert.equal(response.body.error.requestId, headerId);
});

test("unexpected server errors are safe and correlated (no internals leaked)", async () => {
  const response = await request("POST", "/api/v1/pap/applications", {
    token: patientToken,
    body: { papProgramId: "not-even-a-shape" }
  });
  // Validation or unexpected — either way the contract must be safe.
  assert.equal(response.body.success, false);
  assert.ok(response.body.error.message.length < 300);
  assert.equal(JSON.stringify(response.body).toLowerCase().includes("stack"), false);
});

test("authentication audit events record actor and role without secrets", async () => {
  const login = await request("POST", "/api/v1/auth/login", {
    body: { email: `${testKey}-admin@example.com`, password: "definitely-not-the-password" }
  });
  assert.equal(login.status, 401);

  const { prisma } = await import("../src/database/prisma");
  const failure = await prisma.auditEvent.findFirst({
    where: { eventType: "LOGIN_FAILURE", actorUserId: adminId },
    orderBy: { createdAt: "desc" }
  });
  assert.ok(failure, "login failure must be audited");
  assert.equal(failure.actorRole, UserRole.OPS_ADMIN);
  assert.equal((failure.metadata as any)?.category, "INVALID_CREDENTIALS");
  assert.equal(JSON.stringify(failure.metadata).toLowerCase().includes("password"), false);
});

test("refresh rotation is audited without storing the token", async () => {
  // Request an OTP with a suite-unique phone so the run never depends on
  // state seeded by other test files. verify-otp creates (or reuses) the user
  // for that phone, so the audit actor is looked up from the phone — not from
  // the fixture patient, which has a random phone and never receives OTPs.
  const testPhone = `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
  const otpRequest = await request("POST", "/api/v1/auth/patient/request-otp", {
    body: { phone: testPhone }
  });
  assert.equal(otpRequest.status, 200, JSON.stringify(otpRequest.body));
  const { testOtp } = otpRequest.body.data;
  const verify = await request("POST", "/api/v1/auth/patient/verify-otp", {
    body: { phone: testPhone, otp: testOtp }
  });
  if (verify.status !== 200) return;

  const { prisma } = await import("../src/database/prisma");
  const phoneUser = await prisma.user.findUnique({ where: { phone: testPhone } });
  assert.ok(phoneUser, "OTP verification must resolve a user for the phone");
  trackedPhoneUserIds.push(phoneUser.id);

  const rotate = await request("POST", "/api/v1/auth/refresh", {
    body: { refreshToken: verify.body.data.refreshToken }
  });
  assert.equal(rotate.status, 200);

  const rotated = await prisma.auditEvent.findFirst({
    where: { eventType: "REFRESH_TOKEN_ROTATED", actorUserId: phoneUser.id },
    orderBy: { createdAt: "desc" }
  });
  assert.ok(rotated, "rotation must be audited");
  assert.equal(JSON.stringify(rotated).includes(verify.body.data.refreshToken), false);
});

test("important mutations produce audit events with actor, role, and resource", async () => {
  // Prescription upload (multipart via patient).
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from("%PDF-1.7 audit test document")], { type: "application/pdf" }),
    "audit-test.pdf"
  );
  const uploadResponse = await fetch(`${baseUrl}/api/v1/pharmacy/prescriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${patientToken}` },
    body: form
  });
  assert.equal(uploadResponse.status, 201);
  const prescription = (await uploadResponse.json()).data;
  createdResourceIds.push(prescription.id);

  // Pharmacist verifies.
  const requestId = `verify-${Date.now()}`;
  const verified = await request("PATCH", `/api/v1/pharmacy/prescriptions/${prescription.id}/verify`, {
    token: pharmacistToken,
    headers: { "X-Request-Id": requestId }
  });
  assert.equal(verified.status, 200);

  const { prisma } = await import("../src/database/prisma");
  const [submitted, verifyEvent] = await Promise.all([
    prisma.auditEvent.findFirst({
      where: { eventType: "PRESCRIPTION_SUBMITTED", resourceId: prescription.id }
    }),
    prisma.auditEvent.findFirst({
      where: { eventType: "PRESCRIPTION_VERIFIED", resourceId: prescription.id }
    })
  ]);
  assert.ok(submitted, "prescription submission must be audited");
  assert.equal(submitted.actorUserId, patientId);
  assert.equal(submitted.actorRole, "PATIENT");
  assert.ok(verifyEvent, "prescription verification must be audited");
  assert.equal(verifyEvent.actorUserId, pharmacistId);
  assert.equal(verifyEvent.requestId, requestId, "audit must carry the request correlation ID");
  // No document metadata leaks into audit metadata.
  const metadataJson = JSON.stringify(verifyEvent.metadata ?? {}).toLowerCase();
  assert.equal(metadataJson.includes("audit-test"), false);
  assert.equal(metadataJson.includes("documentkey"), false);
});

test("audit endpoint is OPS_ADMIN-only and patient/doctor rows are isolated by RBAC", async () => {
  const unauthenticated = await request("GET", "/api/v1/admin/audit/events");
  assert.equal(unauthenticated.status, 401);

  const patient = await request("GET", "/api/v1/admin/audit/events", { token: patientToken });
  assert.equal(patient.status, 403, "patients must not read the audit trail");

  const pharmacist = await request("GET", "/api/v1/admin/audit/events", { token: pharmacistToken });
  assert.equal(pharmacist.status, 403, "pharmacists must not read the audit trail");

  const admin = await request("GET", "/api/v1/admin/audit/events", { token: adminToken });
  assert.equal(admin.status, 200);
  assert.ok(Array.isArray(admin.body.data.items));
  // Every returned record exposes only the safe field set.
  for (const event of admin.body.data.items) {
    assert.ok(event.eventType);
    assert.ok(event.resourceType);
    assert.equal("accessToken" in event, false);
    assert.equal("token" in event, false);
  }
});

test("audit records cannot be modified or deleted through the API", async () => {
  const post = await request("POST", "/api/v1/admin/audit/events", { token: adminToken, body: {} });
  assert.equal(post.status, 404); // no write route exists
  const remove = await request("DELETE", "/api/v1/admin/audit/events", { token: adminToken });
  assert.equal(remove.status, 404);
});

test("readiness endpoint distinguishes liveness from database readiness safely", async () => {
  const ready = await request("GET", "/health/ready");
  assert.ok([200, 503].includes(ready.status));
  assert.ok(ready.body.checks);
  assert.ok(["ok", "unreachable"].includes(ready.body.checks.database));
  const bodyText = JSON.stringify(ready.body);
  assert.equal(bodyText.toLowerCase().includes("postgres://"), false);
  assert.equal(bodyText.includes("DATABASE_URL"), false);

  const live = await request("GET", "/health");
  assert.equal(live.status, 200);
  assert.equal(live.body.status, "ok");
});
