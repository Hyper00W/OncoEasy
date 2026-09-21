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
  await prisma.user.deleteMany({
    where: { email: { startsWith: "step16-test-" } }
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("authenticated patient can access an empty dashboard", async () => {
  const patient = await createPatient("complete", true);
  const token = await tokenFor(patient.id);
  const response = await getDashboard(token);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.nextStep, null);
  assert.equal(response.body.data.upcomingAppointment, null);
  assert.deepEqual(response.body.data.activeOrders, []);
  assert.equal(response.body.data.referral, null);
  assert.deepEqual(response.body.data.labTests, []);
  assert.equal(response.body.data.papStatus, null);
  assert.equal(response.body.data.quickLinks.length, 6);
  assert.equal(response.body.data.quickLinks.every((link) => link.available === false), true);
});

test("unauthenticated dashboard access is rejected", async () => {
  const response = await getDashboard();

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
});

test("only patients can access the dashboard", async () => {
  for (const role of [UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.OPS_ADMIN]) {
    const user = await createUser(role.toLowerCase(), role);
    const response = await getDashboard(await tokenFor(user.id, role));

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "FORBIDDEN");
  }
});

test("dashboard state comes from the authenticated patient identity", async () => {
  const completePatient = await createPatient("complete-state", true);
  const incompletePatient = await createPatient("incomplete-state", false);

  const completeDashboard = await getDashboard(await tokenFor(completePatient.id));
  const incompleteDashboard = await getDashboard(await tokenFor(incompletePatient.id));

  assert.equal(completeDashboard.body.data.nextStep, null);
  assert.deepEqual(incompleteDashboard.body.data.nextStep, {
    type: "COMPLETE_PROFILE",
    label: "Complete your profile"
  });
});

test("dashboard does not accept a patient identifier from the client", async () => {
  const patient = await createPatient("ownership", true);
  const otherPatient = await createPatient("other-ownership", false);
  const response = await fetch(`${baseUrl}/api/v1/patient/dashboard?patientId=${otherPatient.id}`, {
    headers: { Authorization: `Bearer ${await tokenFor(patient.id)}` }
  });
  const body = (await response.json()) as ApiResponse;

  assert.equal(response.status, 200);
  assert.equal(body.data.nextStep, null);
});

async function createPatient(name: string, complete: boolean) {
  return createUser(name, UserRole.PATIENT, complete);
}

async function createUser(name: string, role: UserRole, complete = false) {
  const { prisma } = await import("../src/database/prisma");

  return prisma.user.create({
    data: {
      fullName: complete ? `Step 16 ${name}` : "Pending onboarding",
      email: `step16-test-${name}@example.com`,
      phone: `+1555200${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`,
      diagnosisStage: complete ? "EARLY_STAGE" : null,
      city: complete ? "Lahore" : null,
      role,
      isVerified: true
    }
  });
}

async function tokenFor(userId: string, role = UserRole.PATIENT): Promise<string> {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function getDashboard(token?: string): Promise<{
  status: number;
  body: ApiResponse;
}> {
  const response = await fetch(`${baseUrl}/api/v1/patient/dashboard`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  return {
    status: response.status,
    body: (await response.json()) as ApiResponse
  };
}

type ApiResponse = {
  success: boolean;
  data: {
    nextStep: { type: string; label: string } | null;
    upcomingAppointment: null;
    activeOrders: unknown[];
    referral: null;
    labTests: unknown[];
    papStatus: null;
    quickLinks: Array<{ available: boolean }>;
  };
  error: {
    code: string;
    message: string;
  };
};
