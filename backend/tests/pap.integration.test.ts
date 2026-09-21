import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { PapApplicationStatus, UserRole } from "@prisma/client";
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
let otherPatientId: string;
let adminId: string;
let doctorId: string;
const programIds: string[] = [];
const applicationIds: string[] = [];
const testKey = `phase1_11-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "other-patient", UserRole.PATIENT),
    createUser(prisma, "ops-admin", UserRole.OPS_ADMIN),
    createUser(prisma, "doctor", UserRole.DOCTOR)
  ]);
  [patientId, otherPatientId, adminId, doctorId] = users.map((user) => user.id);
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
  await prisma.pAPApplicationDocument.deleteMany({ where: { application: { id: { in: applicationIds } } } });
  await prisma.pAPApplication.deleteMany({ where: { id: { in: applicationIds } } });
  await prisma.pAPProgram.deleteMany({ where: { id: { in: programIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, adminId, doctorId] } } });
  const { resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  resetPrivateStorageProvider();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("active PAP programs are visible", async () => {
  const active = await createProgram({ name: "Generic Support Program", isActive: true });
  await createProgram({ name: "Inactive Demo Program", isActive: false });
  const response = await request("GET", "/api/v1/pap/programs", await tokenFor(patientId));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.some((program: { programId: string }) => program.programId === active.id), true);
  assert.equal(response.body.data.some((program: { name: string }) => program.name === "Inactive Demo Program"), false);
});

test("inactive program cannot be used and required application fields are validated", async () => {
  const inactive = await createProgram({ name: "Inactive Application Program", isActive: false });
  const inactiveResponse = await request("POST", "/api/v1/pap/applications", await tokenFor(patientId), { papProgramId: inactive.id, applicationData: validApplicationData() });
  const invalidResponse = await request("POST", "/api/v1/pap/applications", await tokenFor(patientId), { papProgramId: inactive.id, applicationData: { fullName: "A" } });
  assert.equal(inactiveResponse.status, 404);
  assert.equal(inactiveResponse.body.error.code, "PAP_PROGRAM_NOT_FOUND");
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResponse.body.error.code, "VALIDATION_ERROR");
});

test("patient can create and list only their own applications", async () => {
  const program = await createProgram({ name: "Patient Application Program", isActive: true });
  const created = await request("POST", "/api/v1/pap/applications", await tokenFor(patientId), { papProgramId: program.id, applicationData: validApplicationData() });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.status, PapApplicationStatus.SUBMITTED);
  const applicationId = created.body.data.applicationId as string;
  applicationIds.push(applicationId);
  const list = await request("GET", "/api/v1/pap/applications", await tokenFor(patientId));
  const otherList = await request("GET", "/api/v1/pap/applications", await tokenFor(otherPatientId));
  const own = await request("GET", `/api/v1/pap/applications/${applicationId}`, await tokenFor(patientId));
  const other = await request("GET", `/api/v1/pap/applications/${applicationId}`, await tokenFor(otherPatientId));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.some((item: { applicationId: string }) => item.applicationId === applicationId), true);
  assert.equal(otherList.body.data.some((item: { applicationId: string }) => item.applicationId === applicationId), false);
  assert.equal(own.status, 200);
  assert.equal(other.status, 404);
});

test("patient can upload a valid private document and invalid types are rejected", async () => {
  const program = await createProgram({ name: "Document Program", isActive: true });
  const created = await createApplication(program.id);
  const valid = await upload(created, await tokenFor(patientId), { name: "income.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.7 pap") });
  const invalid = await upload(created, await tokenFor(patientId), { name: "income.txt", type: "text/plain", bytes: Buffer.from("not pdf") });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.data.documentName, "income.pdf");
  assert.equal("storageKey" in valid.body.data, false);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "UNSUPPORTED_FILE_TYPE");
  const { prisma } = await import("../src/database/prisma");
  const document = await prisma.pAPApplicationDocument.findFirst({ where: { applicationId: created } });
  assert.ok(document);
  assert.equal(document.storageKey.startsWith("pap-documents/"), true);
});

test("admin can review applications, transitions are controlled, and reviewer identity is recorded", async () => {
  const program = await createProgram({ name: "Review Program", isActive: true });
  const applicationId = await createApplication(program.id);
  const queue = await request("GET", "/api/v1/admin/pap/applications", await tokenFor(adminId, UserRole.OPS_ADMIN));
  const detail = await request("GET", `/api/v1/admin/pap/applications/${applicationId}`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(queue.status, 200);
  assert.equal(queue.body.data.some((item: { applicationId: string }) => item.applicationId === applicationId), true);
  assert.equal(detail.status, 200);

  const underReview = await request("PATCH", `/api/v1/admin/pap/applications/${applicationId}/status`, await tokenFor(adminId, UserRole.OPS_ADMIN), { status: "UNDER_REVIEW" });
  const moreInfo = await request("PATCH", `/api/v1/admin/pap/applications/${applicationId}/status`, await tokenFor(adminId, UserRole.OPS_ADMIN), { status: "MORE_INFORMATION_REQUIRED", reason: "Please provide proof of income" });
  const patientMoreInfo = await request("GET", `/api/v1/pap/applications/${applicationId}`, await tokenFor(patientId));
  const resubmitted = await request("PATCH", `/api/v1/admin/pap/applications/${applicationId}/status`, await tokenFor(adminId, UserRole.OPS_ADMIN), { status: "SUBMITTED" });
  const underReviewAgain = await request("PATCH", `/api/v1/admin/pap/applications/${applicationId}/status`, await tokenFor(adminId, UserRole.OPS_ADMIN), { status: "UNDER_REVIEW" });
  const approved = await request("PATCH", `/api/v1/admin/pap/applications/${applicationId}/status`, await tokenFor(adminId, UserRole.OPS_ADMIN), { status: "APPROVED", reviewNotes: "Approved for manual support processing" });
  const patientApproved = await request("GET", `/api/v1/pap/applications/${applicationId}`, await tokenFor(patientId));
  const invalid = await request("PATCH", `/api/v1/admin/pap/applications/${applicationId}/status`, await tokenFor(adminId, UserRole.OPS_ADMIN), { status: "UNDER_REVIEW" });
  assert.equal(underReview.body.data.status, "UNDER_REVIEW");
  assert.equal(moreInfo.body.data.status, "MORE_INFORMATION_REQUIRED");
  assert.equal(patientMoreInfo.body.data.status, "MORE_INFORMATION_REQUIRED");
  assert.equal(patientMoreInfo.body.data.reviewReason, "Please provide proof of income");
  assert.equal(resubmitted.body.data.status, "SUBMITTED");
  assert.equal(underReviewAgain.body.data.status, "UNDER_REVIEW");
  assert.equal(approved.body.data.status, "APPROVED");
  assert.equal(patientApproved.body.data.status, "APPROVED");
  assert.equal(patientApproved.body.data.reviewNotes, "Approved for manual support processing");
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.error.code, "PAP_APPLICATION_STATE_CONFLICT");

  const rejectedApplicationId = await createApplication(program.id);
  const rejectedReview = await request("PATCH", `/api/v1/admin/pap/applications/${rejectedApplicationId}/status`, await tokenFor(adminId, UserRole.OPS_ADMIN), { status: "UNDER_REVIEW" });
  const rejected = await request("PATCH", `/api/v1/admin/pap/applications/${rejectedApplicationId}/status`, await tokenFor(adminId, UserRole.OPS_ADMIN), { status: "REJECTED", reason: "The submitted information does not meet this program's requirements" });
  const patientRejected = await request("GET", `/api/v1/pap/applications/${rejectedApplicationId}`, await tokenFor(patientId));
  assert.equal(rejectedReview.body.data.status, "UNDER_REVIEW");
  assert.equal(rejected.body.data.status, "REJECTED");
  assert.equal(patientRejected.body.data.status, "REJECTED");
  assert.equal(patientRejected.body.data.reviewReason, "The submitted information does not meet this program's requirements");

  const { prisma } = await import("../src/database/prisma");
  const record = await prisma.pAPApplication.findUnique({ where: { id: applicationId } });
  assert.equal(record?.reviewedBy, adminId);
  assert.ok(record?.reviewedAt);
});

test("admin can access document privately and patient cannot access another patient's document", async () => {
  const program = await createProgram({ name: "Private Access Program", isActive: true });
  const applicationId = await createApplication(program.id);
  const uploadResponse = await upload(applicationId, await tokenFor(patientId), { name: "identity.png", type: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  const documentId = uploadResponse.body.data.documentId as string;
  const admin = await request("GET", `/api/v1/admin/pap/applications/${applicationId}/documents/${documentId}`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  const unauthenticated = await request("GET", `/api/v1/admin/pap/applications/${applicationId}/documents/${documentId}`);
  const patient = await request("GET", `/api/v1/admin/pap/applications/${applicationId}/documents/${documentId}`, await tokenFor(patientId));
  const other = await request("GET", `/api/v1/pap/applications/${applicationId}`, await tokenFor(otherPatientId));
  const { prisma } = await import("../src/database/prisma");
  const document = await prisma.pAPApplicationDocument.findUnique({ where: { id: documentId } });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.access.reference.startsWith("http"), false);
  assert.equal("storageKey" in admin.body.data, false);
  assert.equal(unauthenticated.status, 401);
  assert.equal(patient.status, 403);
  assert.equal(other.status, 404);
  assert.ok(document?.storageKey.startsWith("pap-documents/"));
});

test("unauthorized roles cannot use PAP endpoints", async () => {
  const unauthenticated = await request("GET", "/api/v1/pap/programs");
  const doctor = await request("GET", "/api/v1/pap/programs", await tokenFor(doctorId, UserRole.DOCTOR));
  const patientAdmin = await request("GET", "/api/v1/admin/pap/applications", await tokenFor(patientId));
  assert.equal(unauthenticated.status, 401);
  assert.equal(doctor.status, 403);
  assert.equal(patientAdmin.status, 403);
});

async function createProgram(input: { name: string; isActive: boolean }) {
  const { prisma } = await import("../src/database/prisma");
  const program = await prisma.pAPProgram.create({ data: { name: `${testKey} ${input.name}`, description: "Generic test support program", eligibilityDescription: "Demo eligibility information", requiredDocuments: ["identity", "income"], isActive: input.isActive } });
  programIds.push(program.id);
  return program;
}

async function createApplication(programId: string) {
  const response = await request("POST", "/api/v1/pap/applications", await tokenFor(patientId), { papProgramId: programId, applicationData: validApplicationData() });
  assert.equal(response.status, 201);
  applicationIds.push(response.body.data.applicationId);
  return response.body.data.applicationId as string;
}

function validApplicationData() {
  return { fullName: "Test Patient", phone: "+15551234567", address: "123 Test Street", diagnosisSummary: "Generic oncology treatment support", householdIncome: "50000", financialNeed: "Support with treatment costs" };
}

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function upload(applicationId: string, token: string, file: { name: string; type: string; bytes: Buffer }) {
  const form = new FormData();
  form.append("file", new Blob([file.bytes], { type: file.type }), file.name);
  return requestForm("POST", `/api/v1/pap/applications/${applicationId}/documents`, token, form);
}

async function requestForm(method: string, path: string, token: string, body: FormData) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
