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
const testKey = `phase1_10-${Date.now()}`;

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
  const { resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  resetPrivateStorageProvider();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("active lab catalog is visible", async () => {
  const activeTest = await createLabTest({
    name: "CBC",
    description: "Counts blood cells",
    category: "Blood",
    preparationInstructions: "No fasting required",
    price: "799.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const response = await request(
    "GET",
    "/api/v1/labs/tests",
    await tokenFor(patientId)
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(
    response.body.data.items.some((item: { testId: string; name: string }) => item.testId === activeTest.id && item.name === "CBC"),
    true
  );
});

test("inactive lab test cannot be booked", async () => {
  const inactiveTest = await createLabTest({
    name: "Inactive Panel",
    description: "Should not be bookable",
    category: "Blood",
    preparationInstructions: "None",
    price: "999.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: false
  });

  const response = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: inactiveTest.id,
    collectionType: "HOME",
    preferredDate: futureDate(3)
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "LAB_TEST_NOT_FOUND");
});

test("patient can create a booking", async () => {
  const test = await createLabTest({
    name: "Liver Function Test",
    description: "Monitoring liver health",
    category: "Liver",
    preparationInstructions: "Fast for 8-12 hours",
    price: "1299.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const response = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "HOME",
    preferredDate: futureDate(4),
    preferredTimeSlot: "10:00 AM",
    patientNotes: "Please call before arrival"
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, LabBookingStatus.PENDING_OPS);
  assert.equal(response.body.data.test.testId, test.id);
  assert.equal(response.body.data.collectionType, "HOME");
  bookingIds.push(response.body.data.bookingId);
});

test("patient identity comes from the JWT and client patientId is rejected", async () => {
  const test = await createLabTest({
    name: "JWT Identity Test",
    description: "Client identity must not control ownership",
    category: "Blood",
    preparationInstructions: "None",
    price: "899.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const response = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    patientId: otherPatientId,
    collectionType: "CENTER",
    preferredDate: futureDate(4)
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("unsupported collection type is rejected", async () => {
  const test = await createLabTest({
    name: "Center Only Test",
    description: "Only center collection is available",
    category: "Blood",
    preparationInstructions: "None",
    price: "1499.00",
    currency: "INR",
    homeCollectionAvailable: false,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const response = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "HOME",
    preferredDate: futureDate(5)
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "COLLECTION_TYPE_UNAVAILABLE");
});

test("past booking date is rejected", async () => {
  const test = await createLabTest({
    name: "Past Date Test",
    description: "Past dates should fail",
    category: "Blood",
    preparationInstructions: "None",
    price: "899.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const response = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "CENTER",
    preferredDate: pastDate(1)
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "PAST_LAB_DATE");
});

test("patient ownership is enforced", async () => {
  const test = await createLabTest({
    name: "Patient Ownership Test",
    description: "Check ownership",
    category: "Blood",
    preparationInstructions: "None",
    price: "899.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "CENTER",
    preferredDate: futureDate(6)
  });
  bookingIds.push(created.body.data.bookingId);

  const own = await request("GET", `/api/v1/labs/bookings/${created.body.data.bookingId}`, await tokenFor(patientId));
  const other = await request("GET", `/api/v1/labs/bookings/${created.body.data.bookingId}`, await tokenFor(otherPatientId));

  assert.equal(own.status, 200);
  assert.equal(own.body.data.bookingId, created.body.data.bookingId);
  assert.equal(other.status, 404);
  assert.equal(other.body.error.code, "LAB_BOOKING_NOT_FOUND");
});

test("admin can manually book and save external Thyrocare order ID", async () => {
  const test = await createLabTest({
    name: "Admin Booking Test",
    description: "Manual booking flow",
    category: "Blood",
    preparationInstructions: "None",
    price: "1099.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "HOME",
    preferredDate: futureDate(8)
  });
  bookingIds.push(created.body.data.bookingId);

  const response = await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/book`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { externalOrderId: "THYROCARE-12345" }
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, LabBookingStatus.BOOKED);
  assert.equal(response.body.data.externalOrderId, "THYROCARE-12345");
});

test("missing external order ID is rejected", async () => {
  const test = await createLabTest({
    name: "Missing External ID Test",
    description: "External order ID is required",
    category: "Blood",
    preparationInstructions: "None",
    price: "1099.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "HOME",
    preferredDate: futureDate(8)
  });
  bookingIds.push(created.body.data.bookingId);

  const response = await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/book`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { externalOrderId: "" }
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("admin can list, inspect, and complete valid booking transitions", async () => {
  const test = await createLabTest({
    name: "Admin Queue Test",
    description: "Queue and transition coverage",
    category: "Blood",
    preparationInstructions: "None",
    price: "1199.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "CENTER",
    preferredDate: futureDate(9)
  });
  const bookingId = created.body.data.bookingId as string;
  bookingIds.push(bookingId);

  const queue = await request("GET", "/api/v1/admin/labs/bookings", await tokenFor(adminId, UserRole.OPS_ADMIN));
  const detail = await request("GET", `/api/v1/admin/labs/bookings/${bookingId}`, await tokenFor(adminId, UserRole.OPS_ADMIN));
  assert.equal(queue.status, 200);
  assert.equal(queue.body.data.some((item: { bookingId: string }) => item.bookingId === bookingId), true);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.bookingId, bookingId);

  const booked = await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${bookingId}/book`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { externalOrderId: "THYROCARE-QUEUE-1" }
  );
  assert.equal(booked.body.data.status, LabBookingStatus.BOOKED);

  const collected = await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${bookingId}/status`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { status: "SAMPLE_COLLECTED" }
  );
  assert.equal(collected.status, 200);
  assert.equal(collected.body.data.status, LabBookingStatus.SAMPLE_COLLECTED);

  const completed = await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${bookingId}/status`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { status: "COMPLETED" }
  );
  assert.equal(completed.status, 200);
  assert.equal(completed.body.data.status, LabBookingStatus.COMPLETED);
});

test("invalid status transitions are rejected", async () => {
  const test = await createLabTest({
    name: "Status Transition Test",
    description: "Status validation",
    category: "Blood",
    preparationInstructions: "None",
    price: "999.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "CENTER",
    preferredDate: futureDate(9)
  });
  bookingIds.push(created.body.data.bookingId);

  const response = await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/status`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { status: "SAMPLE_COLLECTED" }
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "LAB_BOOKING_STATE_CONFLICT");
});

test("invalid report files are rejected", async () => {
  const test = await createLabTest({
    name: "File Validation Test",
    description: "Report validation",
    category: "Blood",
    preparationInstructions: "None",
    price: "799.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "HOME",
    preferredDate: futureDate(10)
  });
  bookingIds.push(created.body.data.bookingId);

  await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/book`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { externalOrderId: "THYROCARE-456" }
  );

  const form = new FormData();
  form.append("file", new Blob(["not a pdf"], { type: "text/plain" }), "report.txt");
  const response = await requestForm(
    "POST",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/report`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    form
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "UNSUPPORTED_FILE_TYPE");
});

test("report is unavailable before a report is uploaded", async () => {
  const test = await createLabTest({
    name: "Report Availability Test",
    description: "Report access must be gated by availability",
    category: "Blood",
    preparationInstructions: "None",
    price: "799.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "HOME",
    preferredDate: futureDate(10)
  });
  bookingIds.push(created.body.data.bookingId);

  const response = await request(
    "GET",
    `/api/v1/labs/bookings/${created.body.data.bookingId}/report`,
    await tokenFor(patientId)
  );

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "LAB_REPORT_NOT_AVAILABLE");
});

test("valid PDF report upload works", async () => {
  const test = await createLabTest({
    name: "Report Upload Test",
    description: "PDF report upload",
    category: "Liver",
    preparationInstructions: "None",
    price: "1599.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "HOME",
    preferredDate: futureDate(11)
  });
  bookingIds.push(created.body.data.bookingId);

  const booked = await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/book`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { externalOrderId: "THYROCARE-789" }
  );
  assert.equal(booked.status, 200);

  const form = new FormData();
  form.append("file", new Blob([Buffer.from("%PDF-1.7 test pdf")], { type: "application/pdf" }), "report.pdf");
  const response = await requestForm(
    "POST",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/report`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    form
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, LabBookingStatus.REPORT_READY);
  assert.equal(response.body.data.report.documentName, "report.pdf");
  assert.ok(response.body.data.report !== null);
});

test("report access is restricted to the owning patient/admin", async () => {
  const test = await createLabTest({
    name: "Report Access Test",
    description: "Ownership enforcement",
    category: "Blood",
    preparationInstructions: "None",
    price: "1299.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "CENTER",
    preferredDate: futureDate(12)
  });
  bookingIds.push(created.body.data.bookingId);

  await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/book`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { externalOrderId: "THYROCARE-101" }
  );

  const form = new FormData();
  form.append("file", new Blob([Buffer.from("%PDF-1.7 access check")], { type: "application/pdf" }), "access.pdf");
  await requestForm(
    "POST",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/report`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    form
  );

  const own = await request("GET", `/api/v1/labs/bookings/${created.body.data.bookingId}/report`, await tokenFor(patientId));
  const other = await request("GET", `/api/v1/labs/bookings/${created.body.data.bookingId}/report`, await tokenFor(otherPatientId));
  const admin = await request("GET", `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/report`, await tokenFor(adminId, UserRole.OPS_ADMIN));

  assert.equal(own.status, 200);
  assert.equal(own.body.data.bookingId, created.body.data.bookingId);
  assert.equal(own.body.data.access.reference.startsWith("private://"), true);
  assert.equal(other.status, 404);
  assert.equal(other.body.error.code, "LAB_BOOKING_NOT_FOUND");
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.bookingId, created.body.data.bookingId);
});

test("private storage abstraction is used", async () => {
  const { setPrivateStorageProvider, resetPrivateStorageProvider } = await import("../src/storage/private-storage");
  const providerCalls: { key: string; contentType: string }[] = [];

  setPrivateStorageProvider({
    upload: async (input) => {
      providerCalls.push({ key: input.key, contentType: input.contentType });
      return { key: input.key };
    },
    delete: async () => undefined,
    createTemporaryAccess: async (key) => ({
      reference: `private://${key}`,
      expiresAt: new Date(Date.now() + 300000)
    })
  });

  const test = await createLabTest({
    name: "Private Storage Test",
    description: "Storage abstraction check",
    category: "Blood",
    preparationInstructions: "None",
    price: "899.00",
    currency: "INR",
    homeCollectionAvailable: true,
    centerCollectionAvailable: true,
    requiresPrescription: false,
    isActive: true
  });

  const created = await request("POST", "/api/v1/labs/bookings", await tokenFor(patientId), {
    labTestId: test.id,
    collectionType: "HOME",
    preferredDate: futureDate(13)
  });
  bookingIds.push(created.body.data.bookingId);

  await request(
    "PATCH",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/book`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    { externalOrderId: "THYROCARE-202" }
  );

  const form = new FormData();
  form.append("file", new Blob([Buffer.from("%PDF-1.7 private storage")], { type: "application/pdf" }), "private.pdf");
  await requestForm(
    "POST",
    `/api/v1/admin/labs/bookings/${created.body.data.bookingId}/report`,
    await tokenFor(adminId, UserRole.OPS_ADMIN),
    form
  );

  assert.equal(providerCalls.length > 0, true);
  assert.equal(providerCalls[0].key.startsWith("lab-reports/"), true);
  assert.equal(providerCalls[0].contentType, "application/pdf");
  resetPrivateStorageProvider();
});

test("unauthorized roles are rejected", async () => {
  const unauthenticated = await request("GET", "/api/v1/labs/tests");
  const patientAdminAccess = await request(
    "GET",
    "/api/v1/admin/labs/bookings",
    await tokenFor(patientId)
  );
  const patientReportUpload = await request(
    "POST",
    "/api/v1/admin/labs/bookings/00000000-0000-4000-8000-000000000000/report",
    await tokenFor(patientId),
    { file: "noop" }
  );

  assert.equal(unauthenticated.status, 401);
  assert.equal(patientAdminAccess.status, 403);
  assert.equal(patientReportUpload.status, 403);
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
      phone: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
      role,
      isVerified: true
    }
  });
}

async function createLabTest(input: {
  name: string;
  description: string;
  category: string;
  preparationInstructions: string;
  price: string;
  currency: string;
  homeCollectionAvailable: boolean;
  centerCollectionAvailable: boolean;
  requiresPrescription: boolean;
  isActive: boolean;
}) {
  const { prisma } = await import("../src/database/prisma");
  const created = await prisma.labTest.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category,
      preparationInstructions: input.preparationInstructions,
      price: input.price,
      currency: input.currency,
      homeCollectionAvailable: input.homeCollectionAvailable,
      centerCollectionAvailable: input.centerCollectionAvailable,
      requiresPrescription: input.requiresPrescription,
      isActive: input.isActive
    }
  });
  labTestIds.push(created.id);
  return created;
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

async function requestForm(method: string, path: string, token: string, body: FormData) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body
  });

  return { status: response.status, body: await response.json() as Record<string, any> };
}

function futureDate(daysAhead: number) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function pastDate(daysAgo: number) {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}
