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

let server: Server;
let baseUrl: string;
let patientId: string;
let otherPatientId: string;
let professionalId: string;
const prescriptionIds: string[] = [];
const testKey = `phase178-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");

  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "other-patient", UserRole.PATIENT),
    createUser(prisma, "professional", UserRole.PHARMACIST)
  ]);
  [patientId, otherPatientId, professionalId] = users.map((user) => user.id);

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
  await prisma.prescription.deleteMany({
    where: { patientId: { in: [patientId, otherPatientId] } }
  });
  await prisma.user.deleteMany({
    where: { id: { in: [patientId, otherPatientId, professionalId] } }
  });
  const { resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  resetPrivateStorageProvider();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("rejects unauthenticated and non-patient uploads", async () => {
  const unauthenticated = await upload();
  const professional = await upload(
    await tokenFor(professionalId, UserRole.PHARMACIST)
  );

  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error.code, "UNAUTHORIZED");
  assert.equal(professional.status, 403);
  assert.equal(professional.body.error.code, "FORBIDDEN");
});

test("rejects missing, unsupported, and oversized files", async () => {
  const missing = await upload(await tokenFor(patientId), null);
  const unsupported = await upload(await tokenFor(patientId), {
    name: "prescription.txt",
    type: "text/plain",
    bytes: Buffer.from("not a prescription")
  });
  const oversized = await upload(await tokenFor(patientId), {
    name: "large.pdf",
    type: "application/pdf",
    bytes: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(10 * 1024 * 1024 + 1)])
  });

  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "FILE_REQUIRED");
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error.code, "UNSUPPORTED_FILE_TYPE");
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, "FILE_TOO_LARGE");
});

test("accepts a PDF, persists private metadata, and lists the patient's record", async () => {
  const response = await upload(await tokenFor(patientId), {
    name: "folder/prescription.pdf",
    type: "application/pdf",
    bytes: Buffer.from("%PDF-1.7 prescription contents"),
    notes: "Please review this prescription"
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.source, "PATIENT_UPLOAD");
  assert.equal(response.body.data.status, "PENDING_REVIEW");
  assert.equal(response.body.data.documentName, "prescription.pdf");
  assert.equal(response.body.data.mimeType, "application/pdf");
  assert.equal(response.body.data.notes, "Please review this prescription");
  assert.equal("documentKey" in response.body.data, false);

  const prescriptionId = response.body.data.id as string;
  prescriptionIds.push(prescriptionId);
  const { prisma } = await import("../src/database/prisma");
  const record = await prisma.prescription.findUnique({ where: { id: prescriptionId } });
  assert.ok(record);
  assert.equal(record.patientId, patientId);
  assert.equal(record.createdByUserId, patientId);
  assert.equal(record.source, "PATIENT_UPLOAD");
  assert.equal(record.status, "PENDING_REVIEW");
  assert.equal(record.documentKey.startsWith("prescriptions/"), true);
  assert.equal(record.checksum, "c3a16f67d540275520fff572e8a629831f93d64316c469769cd7322ae329f2ed");

  const list = await request("GET", "/api/v1/pharmacy/prescriptions", await tokenFor(patientId));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.items.length, 1);
  assert.equal(list.body.data.pagination.total, 1);
});

test("accepts a valid PNG and protects prescription ownership", async () => {
  const response = await upload(await tokenFor(patientId), {
    name: "prescription.png",
    type: "image/png",
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  });
  assert.equal(response.status, 201);
  const prescriptionId = response.body.data.id as string;
  prescriptionIds.push(prescriptionId);

  const own = await request(
    "GET",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}`,
    await tokenFor(patientId)
  );
  const other = await request(
    "GET",
    `/api/v1/pharmacy/prescriptions/${prescriptionId}`,
    await tokenFor(otherPatientId)
  );

  assert.equal(own.status, 200);
  assert.equal(own.body.data.id, prescriptionId);
  assert.equal(other.status, 404);
  assert.equal(other.body.error.code, "PRESCRIPTION_NOT_FOUND");
});

test("storage failure does not create a prescription record", async () => {
  const { setPrivateStorageProvider } = await import("../src/storage/private-storage");
  const { prisma } = await import("../src/database/prisma");
  const beforeCount = await prisma.prescription.count({ where: { patientId } });
  setPrivateStorageProvider({
    upload: async () => {
      throw new Error("storage unavailable");
    },
    delete: async () => undefined
  });

  const response = await upload(await tokenFor(patientId), {
    name: "prescription.pdf",
    type: "application/pdf",
    bytes: Buffer.from("%PDF-1.7 failure case")
  });
  assert.equal(response.status, 502);
  assert.equal(response.body.error.code, "STORAGE_UPLOAD_FAILED");

  const afterCount = await prisma.prescription.count({ where: { patientId } });
  assert.equal(afterCount, beforeCount);
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

async function upload(
  token?: string,
  file: { name: string; type: string; bytes: Buffer; notes?: string } | null = {
    name: "prescription.pdf",
    type: "application/pdf",
    bytes: Buffer.from("%PDF-1.7 default")
  }
) {
  const form = new FormData();
  if (file !== null) {
    form.append("file", new Blob([file.bytes], { type: file.type }), file.name);
    if (file.notes) {
      form.append("notes", file.notes);
    }
  }

  return request("POST", "/api/v1/pharmacy/prescriptions", token, form);
}

async function request(method: string, path: string, token?: string, body?: BodyInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body
  });

  return { status: response.status, body: (await response.json()) as any };
}