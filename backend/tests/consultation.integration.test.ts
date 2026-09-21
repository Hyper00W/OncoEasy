import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";
import { after, before, test } from "node:test";
import { AppointmentStatus, UserRole } from "@prisma/client";
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
let doctorId: string;
let otherDoctorId: string;
let unverifiedDoctorId: string;
const availabilityIds: string[] = [];
const appointmentIds: string[] = [];
const testKey = `phase19-${Date.now()}`;

before(async () => {
  const { default: app } = await import("../src/app");
  const { prisma } = await import("../src/database/prisma");
  const users = await Promise.all([
    createUser(prisma, "patient", UserRole.PATIENT, true),
    createUser(prisma, "other-patient", UserRole.PATIENT, true),
    createUser(prisma, "doctor", UserRole.DOCTOR, true),
    createUser(prisma, "other-doctor", UserRole.DOCTOR, true),
    createUser(prisma, "unverified-doctor", UserRole.DOCTOR, false)
  ]);
  [patientId, otherPatientId, doctorId, otherDoctorId, unverifiedDoctorId] = users.map((user) => user.id);
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
  await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
  await prisma.doctorAvailability.deleteMany({ where: { id: { in: availabilityIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [patientId, otherPatientId, doctorId, otherDoctorId, unverifiedDoctorId] } } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("patient and doctor RBAC plus approved doctor listing are enforced", async () => {
  const unauthenticated = await request("GET", "/api/v1/consultations/doctors");
  const doctor = await request("GET", "/api/v1/consultations/doctors", await tokenFor(doctorId, UserRole.DOCTOR));
  const patients = await request("GET", "/api/v1/consultations/doctors", await tokenFor(patientId));

  assert.equal(unauthenticated.status, 401);
  assert.equal(doctor.status, 403);
  assert.equal(patients.status, 200);
  assert.equal(patients.body.data.some((item: { doctorId: string }) => item.doctorId === doctorId), true);
  assert.equal(patients.body.data.some((item: { doctorId: string }) => item.doctorId === unverifiedDoctorId), false);
});

test("doctor availability supports future slots and rejects invalid or past slots", async () => {
  const invalid = await request("POST", "/api/v1/consultations/doctor/availability", await tokenFor(doctorId, UserRole.DOCTOR), { startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() });
  const reversed = await request("POST", "/api/v1/consultations/doctor/availability", await tokenFor(doctorId, UserRole.DOCTOR), { startsAt: future(4), endsAt: future(3) });
  const created = await createAvailability(doctorId, 2);
  const visible = await request("GET", `/api/v1/consultations/doctors/${doctorId}/availability`, await tokenFor(patientId));

  assert.equal(invalid.body.error.code, "PAST_APPOINTMENT_SLOT");
  assert.equal(reversed.body.error.code, "INVALID_AVAILABILITY");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(visible.status, 200);
  assert.equal(visible.body.data.some((slot: { availabilityId: string }) => slot.availabilityId === created.body.data.availabilityId), true);
  availabilityIds.push(created.body.data.availabilityId);

  const { prisma } = await import("../src/database/prisma");
  const past = await prisma.doctorAvailability.create({ data: { doctorId, startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 3_600_000) } });
  availabilityIds.push(past.id);
  const pastBooking = await request("POST", "/api/v1/consultations/appointments", await tokenFor(patientId), { availabilityId: past.id, consultationType: "PHONE" });
  assert.equal(pastBooking.body.error.code, "PAST_APPOINTMENT_SLOT");
});

test("valid in-clinic and phone bookings enforce slot validity and ownership", async () => {
  const firstSlot = await createAvailability(doctorId, 4);
  const unavailableSlot = await createAvailability(doctorId, 5);
  const deactivated = await request("PATCH", `/api/v1/consultations/doctor/availability/${unavailableSlot.body.data.availabilityId}/deactivate`, await tokenFor(doctorId, UserRole.DOCTOR));
  const booked = await request("POST", "/api/v1/consultations/appointments", await tokenFor(patientId), { availabilityId: firstSlot.body.data.availabilityId, consultationType: "IN_CLINIC", patientNotes: "Bring previous reports" });
  const own = await request("GET", "/api/v1/consultations/appointments", await tokenFor(patientId));
  const ownDetail = await request("GET", `/api/v1/consultations/appointments/${booked.body.data.appointmentId}`, await tokenFor(patientId));
  const doctorAppointments = await request("GET", "/api/v1/consultations/doctor/appointments", await tokenFor(doctorId, UserRole.DOCTOR));
  const foreignPatient = await request("GET", `/api/v1/consultations/appointments/${booked.body.data.appointmentId}`, await tokenFor(otherPatientId));
  const foreignDoctor = await request("GET", `/api/v1/consultations/doctor/appointments/${booked.body.data.appointmentId}`, await tokenFor(otherDoctorId, UserRole.DOCTOR));
  const foreignAvailability = await request("PATCH", `/api/v1/consultations/doctor/availability/${firstSlot.body.data.availabilityId}/deactivate`, await tokenFor(otherDoctorId, UserRole.DOCTOR));
  const rejectedDoctor = await request("POST", "/api/v1/consultations/appointments", await tokenFor(patientId), { availabilityId: unavailableSlot.body.data.availabilityId, consultationType: "PHONE" });

  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  appointmentIds.push(booked.body.data.appointmentId);
  assert.equal(booked.body.data.consultationType, "IN_CLINIC");
  assert.equal(booked.body.data.status, AppointmentStatus.PENDING);
  assert.equal(own.status, 200);
  assert.equal(ownDetail.status, 200);
  assert.equal(doctorAppointments.body.data.some((appointment: { appointmentId: string }) => appointment.appointmentId === booked.body.data.appointmentId), true);
  assert.equal(foreignPatient.status, 404);
  assert.equal(foreignDoctor.status, 404);
  assert.equal(foreignAvailability.status, 404);
  assert.equal(deactivated.status, 200);
  assert.equal(rejectedDoctor.body.error.code, "SLOT_UNAVAILABLE");
});

test("concurrent bookings produce one success and one conflict", async () => {
  const slot = await createAvailability(doctorId, 6);
  const token = await tokenFor(patientId);
  const [first, second] = await Promise.all([
    request("POST", "/api/v1/consultations/appointments", token, { availabilityId: slot.body.data.availabilityId, consultationType: "PHONE" }),
    request("POST", "/api/v1/consultations/appointments", await tokenFor(otherPatientId), { availabilityId: slot.body.data.availabilityId, consultationType: "PHONE" })
  ]);
  const responses = [first, second];
  const successful = responses.find((response) => response.status === 201);
  const conflict = responses.find((response) => response.status !== 201);
  assert.ok(successful);
  assert.ok(conflict);
  assert.equal(conflict.body.error.code, "SLOT_UNAVAILABLE");
  appointmentIds.push(successful.body.data.appointmentId);
});

test("doctor confirmation, completion, cancellation, and invalid transitions are guarded", async () => {
  const confirmedSlot = await createAvailability(doctorId, 8);
  const confirmed = await request("POST", "/api/v1/consultations/appointments", await tokenFor(patientId), { availabilityId: confirmedSlot.body.data.availabilityId, consultationType: "PHONE" });
  appointmentIds.push(confirmed.body.data.appointmentId);
  const wrongDoctor = await request("PATCH", `/api/v1/consultations/doctor/appointments/${confirmed.body.data.appointmentId}/confirm`, await tokenFor(otherDoctorId, UserRole.DOCTOR));
  const confirmedResponse = await request("PATCH", `/api/v1/consultations/doctor/appointments/${confirmed.body.data.appointmentId}/confirm`, await tokenFor(doctorId, UserRole.DOCTOR));
  const patientConfirmed = await request("GET", `/api/v1/consultations/appointments/${confirmed.body.data.appointmentId}`, await tokenFor(patientId));
  const completedResponse = await request("PATCH", `/api/v1/consultations/doctor/appointments/${confirmed.body.data.appointmentId}/complete`, await tokenFor(doctorId, UserRole.DOCTOR));
  const invalidComplete = await request("PATCH", `/api/v1/consultations/doctor/appointments/${confirmed.body.data.appointmentId}/complete`, await tokenFor(doctorId, UserRole.DOCTOR));

  assert.equal(wrongDoctor.status, 404);
  assert.equal(confirmedResponse.body.data.status, AppointmentStatus.CONFIRMED);
  assert.equal(patientConfirmed.body.data.status, AppointmentStatus.CONFIRMED);
  assert.equal(completedResponse.body.data.status, AppointmentStatus.COMPLETED);
  const patientCompleted = await request("GET", `/api/v1/consultations/appointments/${confirmed.body.data.appointmentId}`, await tokenFor(patientId));
  assert.equal(patientCompleted.body.data.status, AppointmentStatus.COMPLETED);
  assert.equal(invalidComplete.body.error.code, "APPOINTMENT_STATE_CONFLICT");

  const cancelledSlot = await createAvailability(doctorId, 10);
  const cancelled = await request("POST", "/api/v1/consultations/appointments", await tokenFor(patientId), { availabilityId: cancelledSlot.body.data.availabilityId, consultationType: "IN_CLINIC" });
  appointmentIds.push(cancelled.body.data.appointmentId);
  const cancelledResponse = await request("PATCH", `/api/v1/consultations/appointments/${cancelled.body.data.appointmentId}/cancel`, await tokenFor(patientId), { reason: "Schedule changed" });
  const recancelled = await request("PATCH", `/api/v1/consultations/appointments/${cancelled.body.data.appointmentId}/cancel`, await tokenFor(patientId), {});
  const patientHistory = await request("GET", "/api/v1/consultations/appointments", await tokenFor(patientId));
  assert.equal(cancelledResponse.body.data.status, AppointmentStatus.CANCELLED);
  assert.equal(patientHistory.body.data.some((appointment: { appointmentId: string; status: string }) => appointment.appointmentId === cancelled.body.data.appointmentId && appointment.status === AppointmentStatus.CANCELLED), true);
  assert.equal(recancelled.body.error.code, "APPOINTMENT_STATE_CONFLICT");

  const doctorCancelledSlot = await createAvailability(doctorId, 12);
  const doctorCancelled = await request("POST", "/api/v1/consultations/appointments", await tokenFor(patientId), { availabilityId: doctorCancelledSlot.body.data.availabilityId, consultationType: "PHONE" });
  appointmentIds.push(doctorCancelled.body.data.appointmentId);
  const missingReason = await request("PATCH", `/api/v1/consultations/doctor/appointments/${doctorCancelled.body.data.appointmentId}/cancel`, await tokenFor(doctorId, UserRole.DOCTOR), {});
  const doctorCancelledResponse = await request("PATCH", `/api/v1/consultations/doctor/appointments/${doctorCancelled.body.data.appointmentId}/cancel`, await tokenFor(doctorId, UserRole.DOCTOR), { reason: "Clinic unavailable" });
  assert.equal(missingReason.body.error.code, "CANCELLATION_REASON_REQUIRED");
  assert.equal(doctorCancelledResponse.body.data.status, AppointmentStatus.CANCELLED);
});

async function createAvailability(ownerId: string, hoursFromNow: number) {
  const response = await request("POST", "/api/v1/consultations/doctor/availability", await tokenFor(ownerId, UserRole.DOCTOR), { startsAt: future(hoursFromNow), endsAt: future(hoursFromNow + 1) });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  availabilityIds.push(response.body.data.availabilityId);
  return response;
}

function future(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

async function createUser(prisma: typeof import("../src/database/prisma").prisma, name: string, role: UserRole, isVerified: boolean) {
  return prisma.user.create({ data: { fullName: `${testKey} ${name}`, email: `${testKey}-${name}@example.com`, phone: `+1555${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, role, isVerified } });
}

async function tokenFor(userId: string, role = UserRole.PATIENT) {
  const { generateAccessToken } = await import("../src/services/jwt");
  return generateAccessToken({ userId, role });
}

async function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
