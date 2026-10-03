import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { UserRole } from "@prisma/client";
import dotenv from "dotenv";
import type { PatientDashboard } from "../src/modules/patient/patient-dashboard.service";

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
  // All Phase 1 quick-link destinations are implemented; each must map to a
  // frontend-routable path and be offered as available.
  assert.equal(response.body.data.quickLinks.length, 9);
  assert.equal(response.body.data.quickLinks.every((link) => link.available === true), true);
  for (const link of response.body.data.quickLinks) {
    assert.match(link.path, /^\/patient\//);
  }
});

test("dashboard aggregates real patient data from implemented modules", async () => {
  const patient = await createPatient("aggregate", true);
  const { prisma } = await import("../src/database/prisma");

  const doctor = await prisma.user.create({
    data: {
      fullName: "Step 16 Aggregate Doctor",
      email: `step16-test-aggregate-doctor-${Date.now()}@example.com`,
      phone: `+1555310${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`,
      role: UserRole.DOCTOR,
      isVerified: true
    }
  });
  const availability = await prisma.doctorAvailability.create({
    data: {
      doctorId: doctor.id,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 25 * 60 * 60 * 1000)
    }
  });
  const appointment = await prisma.appointment.create({
    data: {
      doctorId: doctor.id,
      patientId: patient.id,
      availabilityId: availability.id,
      consultationType: "PHONE",
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
      status: "CONFIRMED"
    }
  });
  const product = await prisma.product.create({
    data: {
      sku: `step16-dashboard-${Date.now()}`,
      name: "Dashboard regression test product",
      category: { create: { name: "Dashboard test category", slug: `dashboard-test-${Date.now()}`, isActive: true } },
      unitLabel: "tablet",
      price: 10,
      currency: "USD",
      isActive: true
    }
  });
  const cart = await prisma.cart.create({
    data: {
      patientId: patient.id,
      status: "CONVERTED",
      currency: "USD",
      items: { create: { productId: product.id, quantity: 2, unitPriceSnapshot: product.price, productNameSnapshot: product.name } }
    }
  });
  await prisma.order.create({
    data: {
      patientId: patient.id,
      cartId: cart.id,
      originType: "DIRECT_CART",
      status: "PENDING_PAYMENT",
      currency: "USD",
      subtotal: 20,
      totalAmount: 20,
      items: { create: { productId: product.id, quantity: 2, unitPriceSnapshot: product.price, productNameSnapshot: product.name } }
    }
  });
  const labTest = await prisma.labTest.create({
    data: {
      name: "Dashboard regression test panel",
      category: "blood",
      price: 50,
      currency: "USD"
    }
  });
  await prisma.labBooking.create({
    data: {
      patientId: patient.id,
      labTestId: labTest.id,
      collectionType: "HOME",
      preferredDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
      status: "PENDING_OPS"
    }
  });
  const program = await prisma.pAPProgram.create({
    data: {
      name: "Dashboard regression test program",
      description: "Test program",
      eligibilityDescription: "Test eligibility",
      requiredDocuments: ["ID proof"],
      isActive: true
    }
  });
  await prisma.pAPApplication.create({
    data: {
      patientId: patient.id,
      papProgramId: program.id,
      status: "UNDER_REVIEW",
      applicationData: { fullName: "Step 16 Aggregate" }
    }
  });

  const response = await getDashboard(await tokenFor(patient.id));
  assert.equal(response.status, 200);

  const dashboard = response.body.data as PatientDashboard;
  assert.equal(dashboard.upcomingAppointment?.appointmentId, appointment.id);
  assert.equal(dashboard.upcomingAppointment?.doctorName, doctor.fullName);
  assert.equal(dashboard.activeOrders.length, 1);
  assert.equal(dashboard.activeOrders[0]?.status, "PENDING_PAYMENT");
  assert.equal(dashboard.activeOrders[0]?.itemCount, 1); // one line item (quantity 2)
  assert.equal(dashboard.labTests.length, 1);
  assert.equal(dashboard.labTests[0]?.name, labTest.name);
  assert.equal(dashboard.papStatus?.programName, program.name);
  assert.equal(dashboard.referral, null);

  await prisma.pAPApplication.deleteMany({ where: { patientId: patient.id } });
  await prisma.pAPProgram.delete({ where: { id: program.id } });
  await prisma.labBooking.deleteMany({ where: { patientId: patient.id } });
  await prisma.labTest.delete({ where: { id: labTest.id } });
  await prisma.order.deleteMany({ where: { patientId: patient.id } });
  await prisma.cart.delete({ where: { id: cart.id } });
  await prisma.product.delete({ where: { id: product.id } });
  await prisma.appointment.delete({ where: { id: appointment.id } });
  await prisma.doctorAvailability.delete({ where: { id: availability.id } });
  await prisma.user.delete({ where: { id: doctor.id } });
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
  data: PatientDashboard;
  error: {
    code: string;
    message: string;
  };
};
