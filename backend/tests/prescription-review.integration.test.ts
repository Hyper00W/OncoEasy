import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { PrescriptionStatus, UserRole } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config({ override: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??=
  "postgresql://USERNAME:PASSWORD@localhost:5432/DATABASE_NAME?schema=public";
process.env.JWT_ACCESS_SECRET ??= "integration-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "integration-test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";

let server: Server;
let baseUrl: string;
let patientId: string;
let pharmacistId: string;
const prescriptionIds: string[] = [];
const testKey = `phase179-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "pharmacist", UserRole.PHARMACIST)
  ]);
  [patientId, pharmacistId] = users.map((user) => user.id);

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
  await prisma.prescription.deleteMany({ where: { patientId } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, pharmacistId] } } });
  const { resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  resetPrivateStorageProvider();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("review queue is pharmacist-only and contains only pending prescriptions", async () => {
  const pending = await upload(await tokenFor(patientId));
  const verified = await upload(await tokenFor(patientId));
  prescriptionIds.push(pending.body.data.id, verified.body.data.id);

  const { prisma } = await import("../src/database/prisma");
  await prisma.prescription.update({
    where: { id: verified.body.data.id },
    data: { status: PrescriptionStatus.VERIFIED }
  });

  const unauthenticated = await request("GET", "/api/v1/pharmacy/prescriptions/review-queue");
  const patient = await request(
    "GET",
    "/api/v1/pharmacy/prescriptions/review-queue",
    await tokenFor(patientId)
  );
  const pharmacist = await request(
    "GET",
    "/api/v1/pharmacy/prescriptions/review-queue",
    await tokenFor(pharmacistId, UserRole.PHARMACIST)
  );

  assert.equal(unauthenticated.status, 401);
  assert.equal(patient.status, 403);
  assert.equal(pharmacist.status, 200);
  assert.equal(
    pharmacist.body.data.items.every(
      (item: { status: string }) => item.status === "PENDING_REVIEW"
    ),
    true
  );
  assert.equal(
    pharmacist.body.data.items.some(
      (item: { id: string }) => item.id === pending.body.data.id
    ),
    true
  );
  assert.equal(
    pharmacist.body.data.items.some(
      (item: { id: string }) => item.id === verified.body.data.id
    ),
    false
  );
});

test("pharmacist detail returns metadata and short-lived private access", async () => {
  const uploadResponse = await upload(await tokenFor(patientId));
  const prescriptionId = uploadResponse.body.data.id as string;
  prescriptionIds.push(prescriptionId);

  const detail = await request(
    "GET",
    `/api/v1/pharmacy/prescriptions/review/${prescriptionId}`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST)
  );

  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.id, prescriptionId);
  assert.equal(typeof detail.body.data.documentAccess.reference, "string");
  assert.equal(typeof detail.body.data.documentAccess.expiresAt, "string");
  assert.equal("documentKey" in detail.body.data, false);
  assert.equal(detail.body.data.documentAccess.reference.startsWith("http"), false);
});

test("secure document access failures return a structured storage error", async () => {
  const uploadResponse = await upload(await tokenFor(patientId));
  const prescriptionId = uploadResponse.body.data.id as string;
  prescriptionIds.push(prescriptionId);
  const { setPrivateStorageProvider, resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  setPrivateStorageProvider({
    upload: async ({ key }) => ({ key }),
    delete: async () => undefined,
    createTemporaryAccess: async () => {
      throw new Error("access unavailable");
    }
  });

  const detail = await request(
    "GET",
    `/api/v1/pharmacy/prescriptions/review/${prescriptionId}`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST)
  );
  resetPrivateStorageProvider();

  assert.equal(detail.status, 502);
  assert.equal(detail.body.error.code, "STORAGE_ACCESS_FAILED");
});

test("pharmacist can verify pending prescription and repeated review conflicts", async () => {
  const uploadResponse = await upload(await tokenFor(patientId));
  const prescriptionId = uploadResponse.body.data.id as string;
  prescriptionIds.push(prescriptionId);

  const verified = await request(
    "PATCH",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}/verify`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST)
  );
  const repeated = await request(
    "PATCH",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}/verify`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST)
  );
  const { prisma } = await import("../src/database/prisma");
  const record = await prisma.prescription.findUnique({ where: { id: prescriptionId } });

  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.status, "VERIFIED");
  assert.equal(record?.reviewedByUserId, pharmacistId);
  assert.ok(record?.reviewedAt);
  assert.ok(record?.verifiedAt);
  assert.equal(repeated.status, 409);
  assert.equal(repeated.body.error.code, "PRESCRIPTION_STATE_CONFLICT");
});

test("reject requires a reason, records the pharmacist, and protects patient access", async () => {
  const uploadResponse = await upload(await tokenFor(patientId));
  const prescriptionId = uploadResponse.body.data.id as string;
  prescriptionIds.push(prescriptionId);

  const missingReason = await request(
    "PATCH",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}/reject`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST),
    {}
  );
  const patientReject = await request(
    "PATCH",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}/reject`,
    await tokenFor(patientId),
    { reason: "Not authorized" }
  );
  const rejected = await request(
    "PATCH",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}/reject`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST),
    { reason: "The prescription is illegible" }
  );
  const repeated = await request(
    "PATCH",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}/reject`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST),
    { reason: "Another reason" }
  );
  const { prisma } = await import("../src/database/prisma");
  const record = await prisma.prescription.findUnique({ where: { id: prescriptionId } });

  assert.equal(missingReason.status, 400);
  assert.equal(missingReason.body.error.code, "VALIDATION_ERROR");
  assert.equal(patientReject.status, 403);
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, "REJECTED");
  assert.equal(record?.reviewedByUserId, pharmacistId);
  assert.equal(record?.reviewReason, "The prescription is illegible");
  assert.ok(record?.reviewedAt);
  assert.equal(repeated.status, 409);
});

test("query uses a distinct state and required clarification reason", async () => {
  const uploadResponse = await upload(await tokenFor(patientId));
  const prescriptionId = uploadResponse.body.data.id as string;
  prescriptionIds.push(prescriptionId);

  const queried = await request(
    "PATCH",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}/query`,
    await tokenFor(pharmacistId, UserRole.PHARMACIST),
    { reason: "Please provide a clearer dosage instruction" }
  );

  assert.equal(queried.status, 200);
  assert.equal(queried.body.data.status, "QUERY");
  assert.equal(queried.body.data.reviewReason, "Please provide a clearer dosage instruction");
});

test("missing review prescription returns a structured not-found error", async () => {
  const response = await request(
    "GET",
    "/api/v1/pharmacy/prescriptions/review/550e8400-e29b-41d4-a716-446655440000",
    await tokenFor(pharmacistId, UserRole.PHARMACIST)
  );

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "PRESCRIPTION_NOT_FOUND");
});

async function createUser(
  prisma: typeof import("../src/database/prisma").prisma,
  name: string,
  role: UserRole
) {
  return prisma.user.create({
    data: {
      fullName: `${testKey} ${name}`,
      email: `${testKey}-${name}@example.com`,
      phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`,
      role,
      isVerified: true
    }
  });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function upload(token: string) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from("%PDF-1.7 review document")], { type: "application/pdf" }),
    "review.pdf"
  );
  return request("POST", "/api/v1/pharmacy/prescriptions", token, form);
}

async function request(
  method: string,
  path: string,
  token?: string,
  body?: FormData | Record<string, unknown>
) {
  const isMultipart = body instanceof FormData;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token
      ? { Authorization: `Bearer ${token}`, ...(isMultipart ? {} : { "Content-Type": "application/json" }) }
      : isMultipart
        ? undefined
        : { "Content-Type": "application/json" },
    body: isMultipart || body === undefined ? body : JSON.stringify(body)
  });

  return { status: response.status, body: (await response.json()) as any };
}