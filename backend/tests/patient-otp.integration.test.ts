import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
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
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("valid OTP authenticates a new patient", async () => {
  const phone = "+15550000001";
  const requested = await requestOtp(phone);
  const verified = await verifyOtp(phone, requested.testOtp);

  assert.equal(verified.status, 200);
  assert.equal(verified.body.success, true);
  assert.equal(verified.body.data.user.phone, phone);
  assert.equal(verified.body.data.user.role, "PATIENT");
  assert.equal(typeof verified.body.data.accessToken, "string");
  assert.equal(typeof verified.body.data.refreshToken, "string");
  assert.equal(verified.body.data.onboardingRequired, true);
});

test("invalid OTP is rejected", async () => {
  const phone = "+15550000002";
  await requestOtp(phone);

  const response = await verifyOtp(phone, "9999");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_OTP");
});

test("expired OTP is rejected", async () => {
  const phone = "+15550000003";
  const requested = await requestOtp(phone);
  const { prisma } = await import("../src/database/prisma");

  await prisma.patientOtpChallenge.updateMany({
    where: { phone },
    data: { expiresAt: new Date(0) }
  });

  const response = await verifyOtp(phone, requested.testOtp);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "OTP_EXPIRED");
});

test("consumed OTP cannot be reused", async () => {
  const phone = "+15550000004";
  const requested = await requestOtp(phone);

  await verifyOtp(phone, requested.testOtp);
  const response = await verifyOtp(phone, requested.testOtp);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "OTP_ALREADY_CONSUMED");
});

test("OTP must contain exactly four numeric digits", async () => {
  const phone = "+15550000005";
  await requestOtp(phone);

  const response = await verifyOtp(phone, "123");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("repeated failed OTP attempts are blocked", async () => {
  const phone = "+15550000006";
  await requestOtp(phone);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await verifyOtp(phone, "9999");
    assert.equal(response.status, 400);
  }

  const blocked = await verifyOtp(phone, "9999");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, "OTP_ATTEMPTS_EXCEEDED");
});

async function requestOtp(phone: string): Promise<{
  testOtp: string;
  body: ApiResponse;
}> {
  const response = await fetch(`${baseUrl}/api/v1/auth/patient/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
  const body = (await response.json()) as ApiResponse;

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(typeof body.data.testOtp, "string");

  return { testOtp: body.data.testOtp, body };
}

async function verifyOtp(phone: string, otp: string): Promise<{
  status: number;
  body: ApiResponse;
}> {
  const response = await fetch(`${baseUrl}/api/v1/auth/patient/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, otp })
  });

  return {
    status: response.status,
    body: (await response.json()) as ApiResponse
  };
}

type ApiResponse = {
  success: boolean;
  data: {
    testOtp?: string;
    accessToken?: string;
    refreshToken?: string;
    onboardingRequired?: boolean;
    user: {
      phone?: string;
      role?: string;
    };
  };
  error: {
    code: string;
    message: string;
  };
};
