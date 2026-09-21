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
    where: { email: { startsWith: "step15-test-" } }
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("authenticated patient can complete onboarding and status changes", async () => {
  const patient = await createUser("complete", UserRole.PATIENT);
  const token = await tokenFor(patient.id, UserRole.PATIENT);

  const before = await patientRequest("/me", token);
  assert.equal(before.status, 200);
  assert.equal(before.body.data.onboardingCompleted, false);

  const completed = await patientRequest("/onboarding", token, {
    fullName: "Amina Patient",
    diagnosisStage: "EARLY_STAGE",
    city: "Lahore"
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.data.onboardingCompleted, true);
  assert.equal(completed.body.data.user.fullName, "Amina Patient");

  const after = await patientRequest("/me", token);
  assert.equal(after.body.data.onboardingCompleted, true);
  assert.equal(after.body.data.user.phone, patient.phone);
});

test("unauthenticated onboarding requests are rejected", async () => {
  const response = await patientRequest("/onboarding", undefined, {
    fullName: "Unauthenticated Patient",
    diagnosisStage: "NOT_SURE",
    city: "Delhi"
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
});

test("only patients can use onboarding", async () => {
  for (const role of [UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.OPS_ADMIN]) {
    const user = await createUser(role.toLowerCase(), role);
    const token = await tokenFor(user.id, role);
    const response = await patientRequest("/onboarding", token, {
      fullName: "Blocked User",
      diagnosisStage: "NOT_SURE",
      city: "Delhi"
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "FORBIDDEN");
  }
});

test("invalid or missing onboarding fields are rejected", async () => {
  const patient = await createUser("invalid", UserRole.PATIENT);
  const token = await tokenFor(patient.id, UserRole.PATIENT);

  const response = await patientRequest("/onboarding", token, {
    fullName: "A",
    diagnosisStage: "STAGE_FIVE",
    city: ""
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("cancer type is not accepted by onboarding", async () => {
  const patient = await createUser("cancer-type", UserRole.PATIENT);
  const token = await tokenFor(patient.id, UserRole.PATIENT);

  const response = await patientRequest("/onboarding", token, {
    fullName: "Amina Patient",
    diagnosisStage: "NOT_SURE",
    city: "Delhi",
    cancerType: "Not collected"
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("a patient can only update the record from their own token", async () => {
  const first = await createUser("first", UserRole.PATIENT);
  const second = await createUser("second", UserRole.PATIENT);
  const token = await tokenFor(first.id, UserRole.PATIENT);

  const response = await patientRequest("/onboarding", token, {
    fullName: "First Patient",
    diagnosisStage: "ADVANCED",
    city: "Mumbai"
  });
  assert.equal(response.status, 200);

  const { prisma } = await import("../src/database/prisma");
  const unchangedSecond = await prisma.user.findUnique({
    where: { id: second.id }
  });
  assert.equal(unchangedSecond?.fullName, "Pending onboarding");
  assert.equal(unchangedSecond?.city, null);
});

async function createUser(name: string, role: UserRole) {
  const { prisma } = await import("../src/database/prisma");

  return prisma.user.create({
    data: {
      fullName: "Pending onboarding",
      email: `step15-test-${name}@example.com`,
      phone: `+1555100${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`,
      role,
      isVerified: true
    }
  });
}

async function tokenFor(userId: string, role: UserRole): Promise<string> {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function patientRequest(
  path: string,
  token?: string,
  body?: Record<string, string>
): Promise<{ status: number; body: ApiResponse }> {
  const response = await fetch(`${baseUrl}/api/v1/patient${path}`, {
    method: path === "/me" ? "GET" : "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  return {
    status: response.status,
    body: (await response.json()) as ApiResponse
  };
}

type ApiResponse = {
  success: boolean;
  data: {
    onboardingCompleted?: boolean;
    user: {
      fullName?: string;
      phone?: string | null;
    };
  };
  error: {
    code: string;
    message: string;
  };
};
