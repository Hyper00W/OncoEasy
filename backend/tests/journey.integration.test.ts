import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { JourneyStageKey, UserRole } from "@prisma/client";
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
const testKey = `phase1_12-${Date.now()}`;
let originalStages: Array<{ key: JourneyStageKey; title: string; description: string; checklist: unknown; isActive: boolean }> = [];

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  await ensureJourneyStages();
  originalStages = await prisma.journeyStage.findMany({ select: { key: true, title: true, description: true, checklist: true, isActive: true } });
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "other-patient", UserRole.PATIENT),
    createUser(prisma, "admin", UserRole.OPS_ADMIN),
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
  if (!patientId || !otherPatientId) return;
  await prisma.patientJourneyStageHistory.deleteMany({ where: { patientJourney: { patientId: { in: [patientId, otherPatientId] } } } });
  await prisma.patientJourney.deleteMany({ where: { patientId: { in: [patientId, otherPatientId] } } });
  for (const stage of originalStages) {
    await prisma.journeyStage.update({ where: { key: stage.key }, data: { title: stage.title, description: stage.description, checklist: stage.checklist as never, isActive: stage.isActive } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, adminId, doctorId] } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("patient gets a lazy initialized journey with all active stages in order", async () => {
  const response = await request("GET", "/api/v1/patient/journey", await tokenFor(patientId));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.currentStageKey, JourneyStageKey.DIAGNOSED);
  assert.equal(response.body.data.currentStage.stage, JourneyStageKey.DIAGNOSED);
  assert.deepEqual(response.body.data.stages.map((stage: { stage: string }) => stage.stage), ["DIAGNOSED", "TREATMENT_PLANNING", "ACTIVE_TREATMENT", "FOLLOW_UP"]);
  assert.equal(Array.isArray(response.body.data.currentStage.checklist), true);
  assert.deepEqual(response.body.data.history, []);
});

test("patient can read a stage and advance only one stage at a time", async () => {
  const detail = await request("GET", "/api/v1/patient/journey/stages/DIAGNOSED", await tokenFor(patientId));
  const advanced = await request("PATCH", "/api/v1/patient/journey/stage", await tokenFor(patientId), { stage: "TREATMENT_PLANNING" });
  const journey = await request("GET", "/api/v1/patient/journey", await tokenFor(patientId));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.stage, "DIAGNOSED");
  assert.equal(advanced.status, 200);
  assert.equal(advanced.body.data.currentStageKey, "TREATMENT_PLANNING");
  assert.equal(journey.body.data.history.length, 1);
  assert.deepEqual(journey.body.data.history[0], { fromStage: "DIAGNOSED", toStage: "TREATMENT_PLANNING", changedAt: journey.body.data.history[0].changedAt });
});

test("patient cannot skip or move backwards and invalid transitions are rejected", async () => {
  const skip = await request("PATCH", "/api/v1/patient/journey/stage", await tokenFor(patientId), { stage: "FOLLOW_UP" });
  const backwards = await request("PATCH", "/api/v1/patient/journey/stage", await tokenFor(patientId), { stage: "DIAGNOSED" });
  const invalid = await request("PATCH", "/api/v1/patient/journey/stage", await tokenFor(patientId), { stage: "NOT_A_STAGE" });
  assert.equal(skip.status, 409);
  assert.equal(skip.body.error.code, "JOURNEY_STAGE_TRANSITION_INVALID");
  assert.equal(backwards.status, 409);
  assert.equal(backwards.body.error.code, "JOURNEY_STAGE_TRANSITION_INVALID");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
});

test("admin can read and update content, while stable stage identity and order remain protected", async () => {
  const list = await request("GET", "/api/v1/admin/journey/stages", await tokenFor(adminId, UserRole.OPS_ADMIN));
  const updated = await request("PATCH", "/api/v1/admin/journey/stages/DIAGNOSED", await tokenFor(adminId, UserRole.OPS_ADMIN), { title: "Updated Diagnosed Stage", checklist: ["Review your care information"] });
  const patient = await request("GET", "/api/v1/patient/journey", await tokenFor(otherPatientId));
  const invalidIdentity = await request("PATCH", "/api/v1/admin/journey/stages/DIAGNOSED", await tokenFor(adminId, UserRole.OPS_ADMIN), { order: 99 });
  const patientEdit = await request("PATCH", "/api/v1/admin/journey/stages/DIAGNOSED", await tokenFor(otherPatientId), { title: "Patient Edit" });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.map((stage: { stage: string }) => stage.stage), ["DIAGNOSED", "TREATMENT_PLANNING", "ACTIVE_TREATMENT", "FOLLOW_UP"]);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.title, "Updated Diagnosed Stage");
  assert.equal(patient.body.data.stages[0].title, "Updated Diagnosed Stage");
  assert.equal(invalidIdentity.status, 400);
  assert.equal(invalidIdentity.body.error.code, "VALIDATION_ERROR");
  assert.equal(patientEdit.status, 403);
  assert.equal(patientEdit.body.error.code, "FORBIDDEN");
});

test("inactive stages are hidden from patients and unavailable by stage endpoint", async () => {
  const deactivated = await request("PATCH", "/api/v1/admin/journey/stages/FOLLOW_UP", await tokenFor(adminId, UserRole.OPS_ADMIN), { isActive: false });
  const journey = await request("GET", "/api/v1/patient/journey", await tokenFor(otherPatientId));
  const detail = await request("GET", "/api/v1/patient/journey/stages/FOLLOW_UP", await tokenFor(otherPatientId));
  assert.equal(deactivated.status, 200);
  assert.equal(journey.body.data.stages.some((stage: { stage: string }) => stage.stage === "FOLLOW_UP"), false);
  assert.equal(detail.status, 404);
  assert.equal(detail.body.error.code, "JOURNEY_STAGE_NOT_FOUND");
});

test("patient ownership is JWT-bound and roles are enforced", async () => {
  const patientJourney = await request("GET", "/api/v1/patient/journey", await tokenFor(patientId));
  const otherJourney = await request("GET", `/api/v1/patient/journey?patientId=${otherPatientId}`, await tokenFor(patientId));
  const unauthenticated = await request("GET", "/api/v1/patient/journey");
  const doctor = await request("GET", "/api/v1/patient/journey", await tokenFor(doctorId, UserRole.DOCTOR));
  const patientAdmin = await request("GET", "/api/v1/admin/journey/stages", await tokenFor(patientId));
  assert.equal(patientJourney.status, 200);
  assert.equal(otherJourney.status, 200);
  assert.equal(otherJourney.body.data.journeyId, patientJourney.body.data.journeyId);
  assert.equal(unauthenticated.status, 401);
  assert.equal(doctor.status, 403);
  assert.equal(patientAdmin.status, 403);
});

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`, role, isVerified: true } });
}

async function ensureJourneyStages() {
  const { prisma } = await import("../src/database/prisma");
  const stages = [
    [JourneyStageKey.DIAGNOSED, 1, "Diagnosed"],
    [JourneyStageKey.TREATMENT_PLANNING, 2, "Treatment Planning"],
    [JourneyStageKey.ACTIVE_TREATMENT, 3, "Active Treatment"],
    [JourneyStageKey.FOLLOW_UP, 4, "Follow-up"]
  ] as const;
  for (const [key, order, title] of stages) {
    await prisma.journeyStage.upsert({
      where: { key },
      update: { order, title, description: `${title} stage content`, checklist: [`${title} checklist item`], isActive: true },
      create: { key, order, title, description: `${title} stage content`, checklist: [`${title} checklist item`], isActive: true }
    });
  }
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
