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
const testKey = `phase1_16-${Date.now()}`;
const createdSessionIds: string[] = [];
const createdUserIds: string[] = [];

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
  await prisma.chatSession.deleteMany({ where: { id: { in: createdSessionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("patient can create a session, route messages, and persist both sides of the transcript", async () => {
  const patient = await createUser("patient", UserRole.PATIENT);
  const token = await tokenFor(patient.id, UserRole.PATIENT);
  const created = await request("POST", "/api/v1/chat/sessions", token);
  assert.equal(created.status, 201);
  createdSessionIds.push(created.body.data.sessionId);

  const sent = await request("POST", `/api/v1/chat/sessions/${created.body.data.sessionId}/messages`, token, { content: "I need help finding the pharmacy" });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.data.detectedIntent, "PHARMACY");
  assert.equal(sent.body.data.route, "/patient/pharmacy");
  assert.equal(sent.body.data.escalated, false);
  assert.equal(sent.body.data.session.messages.length, 2);
  assert.equal(sent.body.data.session.messages[0].sender, "PATIENT");
  assert.equal(sent.body.data.session.messages[1].sender, "ROUTER");
});

test("supported navigation intents return stable routes and ambiguous text is GENERAL", async () => {
  const patient = await createUser("routes", UserRole.PATIENT);
  const token = await tokenFor(patient.id, UserRole.PATIENT);
  const intents = [
    ["doctor appointment", "DOCTOR_CONSULT", "/patient/consultations"],
    ["blood test report", "LABS", "/patient/labs"],
    ["patient assistance program", "PAP", "/patient/pap"],
    ["show my care journey next step", "CARE_JOURNEY", "/patient/journey"],
    ["learn from an article", "KNOWLEDGE", "/patient/knowledge"],
    ["find a clinical trial study", "CLINICAL_TRIALS", "/patient/trials"],
    ["I need a support representative", "HUMAN_SUPPORT", "HUMAN_SUPPORT_ESCALATION"],
    ["hello there", "GENERAL", null]
  ] as const;

  for (const [content, intent, route] of intents) {
    const session = await request("POST", "/api/v1/chat/sessions", token);
    const sessionId = session.body.data.sessionId as string;
    createdSessionIds.push(sessionId);
    const response = await request("POST", `/api/v1/chat/sessions/${sessionId}/messages`, token, { content });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.detectedIntent, intent);
    assert.equal(response.body.data.route, route);
    assert.equal(response.body.data.escalated, intent === "HUMAN_SUPPORT");
  }
});

test("medical requests are never answered medically and escalate", async () => {
  const patient = await createUser("medical", UserRole.PATIENT);
  const token = await tokenFor(patient.id, UserRole.PATIENT);
  const session = await request("POST", "/api/v1/chat/sessions", token);
  const sessionId = session.body.data.sessionId as string;
  createdSessionIds.push(sessionId);
  const response = await request("POST", `/api/v1/chat/sessions/${sessionId}/messages`, token, { content: "What medicine should I take and what dosage?" });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.detectedIntent, "HUMAN_SUPPORT");
  assert.equal(response.body.data.escalated, true);
  assert.match(response.body.data.response, /cannot provide medical advice/i);
  assert.match(response.body.data.response, /has not responded yet/i);
});

test("sessions are JWT-owned and admin can filter escalations without patient profile data", async () => {
  const patient = await createUser("owner", UserRole.PATIENT);
  const otherPatient = await createUser("other", UserRole.PATIENT);
  const admin = await createUser("admin", UserRole.OPS_ADMIN);
  const patientToken = await tokenFor(patient.id, UserRole.PATIENT);
  const otherToken = await tokenFor(otherPatient.id, UserRole.PATIENT);
  const adminToken = await tokenFor(admin.id, UserRole.OPS_ADMIN);
  const session = await request("POST", "/api/v1/chat/sessions", patientToken);
  const sessionId = session.body.data.sessionId as string;
  createdSessionIds.push(sessionId);
  await request("POST", `/api/v1/chat/sessions/${sessionId}/messages`, patientToken, { content: "Please contact someone" });

  const own = await request("GET", "/api/v1/chat/sessions", patientToken);
  const forbidden = await request("GET", `/api/v1/chat/sessions/${sessionId}`, otherToken);
  const adminList = await request("GET", "/api/v1/admin/chat/sessions?escalated=true", adminToken);
  const adminDetail = await request("GET", `/api/v1/admin/chat/sessions/${sessionId}`, adminToken);
  assert.equal(own.status, 200);
  assert.equal(own.body.data.some((item: { sessionId: string }) => item.sessionId === sessionId), true);
  assert.equal(forbidden.status, 404);
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.data.items.some((item: { sessionId: string }) => item.sessionId === sessionId), true);
  assert.equal(adminDetail.status, 200);
  assert.equal(adminDetail.body.data.patient, undefined);
  assert.equal(adminDetail.body.data.patientId, patient.id);
});

test("payload limits and roles are enforced", async () => {
  const patient = await createUser("validation", UserRole.PATIENT);
  const doctor = await createUser("doctor", UserRole.DOCTOR);
  const patientToken = await tokenFor(patient.id, UserRole.PATIENT);
  const doctorToken = await tokenFor(doctor.id, UserRole.DOCTOR);
  const session = await request("POST", "/api/v1/chat/sessions", patientToken);
  const sessionId = session.body.data.sessionId as string;
  createdSessionIds.push(sessionId);
  const empty = await request("POST", `/api/v1/chat/sessions/${sessionId}/messages`, patientToken, { content: " " });
  const oversized = await request("POST", `/api/v1/chat/sessions/${sessionId}/messages`, patientToken, { content: "x".repeat(2001) });
  const unauthorizedRole = await request("POST", "/api/v1/chat/sessions", doctorToken);
  assert.equal(empty.status, 400);
  assert.equal(oversized.status, 400);
  assert.equal(unauthorizedRole.status, 403);
});

async function createUser(name: string, role: UserRole) {
  const { prisma } = await import("../src/database/prisma");
  const user = await prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`, role, isVerified: true } });
  createdUserIds.push(user.id);
  return user;
}

async function tokenFor(userId: string, role: UserRole) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() as Record<string, any> };
}