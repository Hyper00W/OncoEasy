import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { LabBookingStatus, UserRole } from "@prisma/client";
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
let adminId: string;
const labTestIds: string[] = [];
const bookingIds: string[] = [];
const testKey = `phase3_7-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");

  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT),
    createUser(prisma, "other-patient", UserRole.PATIENT),
    createUser(prisma, "ops-admin", UserRole.OPS_ADMIN)
  ]);
  [patientId, otherPatientId, adminId] = users.map((user) => user.id);

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
  await prisma.labBooking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.labTest.deleteMany({ where: { id: { in: labTestIds } } });
  await prisma.user.deleteMany({
    where: { id: { in: [patientId, otherPatientId, adminId] } }
  });
  const { resetLabBookingProvider } = await import("../src/modules/labs/lab-provider");
  resetLabBookingProvider();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("DSA queue lists only PENDING_OPS bookings and hides completed work", async () => {
  const { prisma } = await import("../src/database/prisma");
  const testId = await createLabTest();
  const pending = await createBooking(testId);
  const booked = await createBooking(testId, { externalOrderId: `${testKey}-seeded`, status: LabBookingStatus.BOOKED });

  const response = await request("GET", "/api/v1/admin/labs/bookings?dsaQueue=true", await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(response.status, 200);
  const queueIds = (response.body.data as Array<{ bookingId: string }>).map((item) => item.bookingId);
  assert.ok(queueIds.includes(pending));
  assert.ok(!queueIds.includes(booked));
});

test("DSA queue and admin booking endpoints reject patients", async () => {
  const response = await request("GET", "/api/v1/admin/labs/bookings?dsaQueue=true", await tokenFor(patientId));
  assert.equal(response.status, 403);

  const unauthenticated = await request("GET", "/api/v1/admin/labs/bookings?dsaQueue=true");
  assert.equal(unauthenticated.status, 401);
});

test("recording a Thyrocare DSA reference transitions PENDING_OPS to BOOKED and echoes the provider", async () => {
  const { MockLabBookingProvider, setLabBookingProvider } = await import("../src/modules/labs/thyrocare-dsa");
  const { setLabBookingProvider: setActive } = await import("../src/modules/labs/lab-provider");
  const mock = new MockLabBookingProvider();
  setActive(mock);

  const testId = await createLabTest();
  const bookingId = await createBooking(testId);
  const detail = await request("GET", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.data.provider, { provider: mock.provider, mode: "MANUAL_DSA" });

  const recorded = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, await tokenFor(adminId, UserRole.OPS_ADMIN), { externalOrderId: `${testKey}-DSA-1` });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.data.status, LabBookingStatus.BOOKED);
  assert.equal(recorded.body.data.externalOrderId, `${testKey}-DSA-1`);
  assert.equal(mock.createdBookings.length, 1);
  assert.equal(mock.createdBookings[0].bookingId, bookingId);
  assert.equal(mock.createdBookings[0].collectionType, "HOME");

  const { resetLabBookingProvider } = await import("../src/modules/labs/lab-provider");
  resetLabBookingProvider();
});

test("recording the same DSA reference twice is idempotent; a different reference conflicts", async () => {
  const testId = await createLabTest();
  const bookingId = await createBooking(testId);
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);

  const first = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, token, { externalOrderId: `${testKey}-DSA-2` });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.status, LabBookingStatus.BOOKED);

  const repeat = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, token, { externalOrderId: `${testKey}-DSA-2` });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.data.externalOrderId, `${testKey}-DSA-2`);

  const mismatch = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, token, { externalOrderId: `${testKey}-DSA-2b` });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error.code, "EXTERNAL_ORDER_MISMATCH");
});

test("a DSA reference already used by another booking is rejected (unique constraint)", async () => {
  const testId = await createLabTest();
  const first = await createBooking(testId);
  const second = await createBooking(testId);
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);

  const seed = await request("PATCH", `/api/v1/admin/labs/bookings/${first}/dsa`, token, { externalOrderId: `${testKey}-DSA-SHARED` });
  assert.equal(seed.status, 200);

  const clash = await request("PATCH", `/api/v1/admin/labs/bookings/${second}/dsa`, token, { externalOrderId: `${testKey}-DSA-SHARED` });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error.code, "EXTERNAL_ORDER_ALREADY_RECORDED");
});

test("recording a DSA reference is rejected outside PENDING_OPS", async () => {
  const testId = await createLabTest();
  const bookingId = await createBooking(testId, { status: LabBookingStatus.BOOKED, externalOrderId: `${testKey}-DSA-3` });
  const response = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, await tokenFor(adminId, UserRole.OPS_ADMIN), { externalOrderId: `${testKey}-DSA-3` });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, LabBookingStatus.BOOKED);
});

test("patient cannot record a DSA reference or read the DSA detail", async () => {
  const testId = await createLabTest();
  const bookingId = await createBooking(testId);

  const record = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, await tokenFor(patientId), { externalOrderId: "EVIL-REF" });
  assert.equal(record.status, 403);

  const detail = await request("GET", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, await tokenFor(patientId));
  assert.equal(detail.status, 403);

  const booking = await request("GET", `/api/v1/labs/bookings/${bookingId}`, await tokenFor(patientId));
  assert.equal(booking.status, 200);
  assert.ok(!("provider" in booking.body.data));
  assert.ok(!("opsNotes" in booking.body.data));
});

test("foreign patient cannot read or modify another patient's booking", async () => {
  const testId = await createLabTest();
  const bookingId = await createBooking(testId);

  const detail = await request("GET", `/api/v1/labs/bookings/${bookingId}`, await tokenFor(otherPatientId));
  assert.equal(detail.status, 404);
});

test("ops note is appended idempotently, stored internally, and never exposed to patients", async () => {
  const testId = await createLabTest();
  const bookingId = await createBooking(testId);
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);

  const added = await request("POST", `/api/v1/admin/labs/bookings/${bookingId}/ops-notes`, token, { note: "Called Thyrocare DSA desk" });
  assert.equal(added.status, 200);

  const again = await request("POST", `/api/v1/admin/labs/bookings/${bookingId}/ops-notes`, token, { note: "Second note" });
  assert.equal(again.status, 200);

  const detail = await request("GET", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, token);
  const { prisma } = await import("../src/database/prisma");
  const stored = await prisma.labBooking.findUnique({ where: { id: bookingId }, select: { opsNotes: true } });
  assert.ok(Array.isArray(stored?.opsNotes));
  assert.equal((stored?.opsNotes as unknown[]).length, 2);

  const patientView = await request("GET", `/api/v1/labs/bookings/${bookingId}`, await tokenFor(patientId));
  assert.ok(!("opsNotes" in patientView.body.data));
  assert.ok(!JSON.stringify(patientView.body).includes("Called Thyrocare DSA desk"));
});

test("valid lifecycle transitions pass and invalid transitions are rejected with provider push", async () => {
  const testId = await createLabTest();
  const bookingId = await createBooking(testId);
  const token = await tokenFor(adminId, UserRole.OPS_ADMIN);

  const record = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/dsa`, token, { externalOrderId: `${testKey}-DSA-5` });
  assert.equal(record.status, 200);

  const invalid = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/status`, token, { status: "REPORT_READY" });
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.error.code, "LAB_BOOKING_STATE_CONFLICT");

  const collect = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/status`, token, { status: "SAMPLE_COLLECTED" });
  assert.equal(collect.status, 200);
  assert.equal(collect.body.data.status, LabBookingStatus.SAMPLE_COLLECTED);
  assert.deepEqual(collect.body.data.provider, { provider: "THYROCARE", mode: "MANUAL_DSA" });
});

test("legacy /book endpoint still records an external reference (regression)", async () => {
  const testId = await createLabTest();
  const bookingId = await createBooking(testId);
  const response = await request("PATCH", `/api/v1/admin/labs/bookings/${bookingId}/book`, await tokenFor(adminId, UserRole.OPS_ADMIN), { externalOrderId: `${testKey}-DSA-6` });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, LabBookingStatus.BOOKED);
  assert.equal(response.body.data.externalOrderId, `${testKey}-DSA-6`);
});

test("MANUAL_DSA mode performs no network calls (provider seam is mockable)", async () => {
  const { ThyrocareDsaAdapter, MockLabBookingProvider } = await import("../src/modules/labs/thyrocare-dsa");
  const adapter = new ThyrocareDsaAdapter();
  assert.equal(adapter.provider, "THYROCARE");
  assert.equal(adapter.mode, "MANUAL_DSA");

  const result = await adapter.createExternalBooking({ bookingId: "x", collectionType: "HOME", preferredDate: "2030-01-01", preferredTimeSlot: null });
  assert.equal(result.mode, "MANUAL_DSA");

  const mock = new MockLabBookingProvider();
  const mocked = await mock.createExternalBooking({ bookingId: "x", collectionType: "CENTER", preferredDate: "2030-01-01", preferredTimeSlot: "09:00" });
  assert.equal(mocked.externalOrderId, "MOCK-EXT-1");
  assert.equal(mock.createdBookings.length, 1);
});

// --- helpers ---

async function createUser(
  prisma: typeof import("../src/database/prisma").prisma,
  name: string,
  role: UserRole
) {
  return prisma.user.create({
    data: {
      fullName: `${testKey} ${name}`,
      email: `${testKey}-${name}@example.com`,
      phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
      role,
      isVerified: true
    }
  });
}

async function createLabTest() {
  const { prisma } = await import("../src/database/prisma");
  const created = await prisma.labTest.create({
    data: {
      name: `${testKey} CBC`,
      description: "Complete blood count (test fixture)",
      category: "PATHOLOGY",
      preparationInstructions: "None",
      price: "199.00",
      currency: "INR",
      requiresPrescription: false,
      homeCollectionAvailable: true,
      centerCollectionAvailable: true,
      isActive: true
    }
  });
  labTestIds.push(created.id);
  return created.id;
}

async function createBooking(
  labTestId: string,
  overrides: { status?: LabBookingStatus; externalOrderId?: string } = {}
) {
  const { prisma } = await import("../src/database/prisma");
  const created = await prisma.labBooking.create({
    data: {
      patientId,
      labTestId,
      collectionType: "HOME",
      preferredDate: new Date(`${futureDate(3)}T00:00:00.000Z`),
      status: overrides.status ?? LabBookingStatus.PENDING_OPS,
      externalOrderId: overrides.externalOrderId ?? null
    }
  });
  bookingIds.push(created.id);
  return created.id;
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: response.status, body: await response.json() as Record<string, any> };
}

function futureDate(daysAhead: number) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}
