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
    where: { email: { startsWith: "step13-test-" } }
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("valid doctor login returns the authentication session", async () => {
  await createUser("doctor", UserRole.DOCTOR, true);

  const response = await login("doctor", "doctor-password");

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(typeof response.body.data.accessToken, "string");
  assert.equal(typeof response.body.data.refreshToken, "string");
  assert.equal(response.body.data.user.role, UserRole.DOCTOR);
});

test("valid pharmacist login succeeds", async () => {
  await createUser("pharmacist", UserRole.PHARMACIST, true);

  const response = await login("pharmacist", "pharmacist-password");

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.role, UserRole.PHARMACIST);
});

test("valid admin login succeeds", async () => {
  await createUser("admin", UserRole.OPS_ADMIN, false);

  const response = await login("admin", "admin-password");

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.role, UserRole.OPS_ADMIN);
});

test("invalid password fails without exposing account details", async () => {
  await createUser("wrong-password", UserRole.DOCTOR, true);

  const response = await login("wrong-password", "wrong-password");

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_CREDENTIALS");
  assert.equal(response.body.error.message, "Invalid email or password");
});

test("nonexistent email fails safely", async () => {
  const response = await login("missing", "any-password");

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_CREDENTIALS");
  assert.equal(response.body.error.message, "Invalid email or password");
});

test("unverified doctor cannot log in", async () => {
  await createUser("unverified-doctor", UserRole.DOCTOR, false);

  const response = await login("unverified-doctor", "unverified-doctor-password");

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "ACCOUNT_NOT_APPROVED");
  assert.equal(response.body.error.message, "Your professional account is awaiting approval");
});

test("unverified pharmacist cannot log in", async () => {
  await createUser("unverified-pharmacist", UserRole.PHARMACIST, false);

  const response = await login(
    "unverified-pharmacist",
    "unverified-pharmacist-password"
  );

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "ACCOUNT_NOT_APPROVED");
});

test("patient cannot use the email-password login flow", async () => {
  await createUser("patient", UserRole.PATIENT, true);

  const response = await login("patient", "patient-password");

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_CREDENTIALS");
});

test("login request validates email and password", async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "" })
  });
  const body = (await response.json()) as ApiResponse;

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

async function createUser(
  name: string,
  role: UserRole,
  isVerified: boolean
): Promise<void> {
  const { prisma } = await import("../src/database/prisma");
  const { hashPassword } = await import("../src/services/password");

  await prisma.user.create({
    data: {
      fullName: `Step 1.3 ${name}`,
      email: `step13-test-${name}@example.com`,
      passwordHash: await hashPassword(`${name}-password`),
      role,
      isVerified
    }
  });
}

async function login(name: string, password: string): Promise<{
  status: number;
  body: ApiResponse;
}> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `step13-test-${name}@example.com`,
      password
    })
  });

  return {
    status: response.status,
    body: (await response.json()) as ApiResponse
  };
}

type ApiResponse = {
  success: boolean;
  data: {
    accessToken?: string;
    refreshToken?: string;
    user: {
      role?: string;
    };
  };
  error: {
    code: string;
    message: string;
  };
};
