import { AppointmentStatus, Prisma, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import {
  toAppointmentResponse,
  toAvailabilityResponse,
  toDoctorResponse
} from "./consultation.mapper";
import type {
  AdminAppointmentListQuery,
  AvailabilityCreateInput,
  BookAppointmentInput,
  CancellationInput
} from "./consultation.schemas";
import { recordAnalyticsEvent } from "../analytics/analytics.events";
import { recordAuditEvent, recordAuditEventSafe } from "../../observability/audit";

const appointmentInclude = {
  doctor: { select: { id: true, fullName: true } },
  patient: { select: { id: true, fullName: true } },
  availability: { select: { id: true, startsAt: true, endsAt: true, isActive: true } }
} as const;

const availabilityInclude = {
  appointment: { select: { id: true, status: true } }
} as const;

export async function listAvailableDoctors() {
  const doctors = await prisma.user.findMany({
    where: { role: UserRole.DOCTOR, isActive: true, isVerified: true },
    select: { id: true, fullName: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }]
  });
  return doctors.map(toDoctorResponse);
}

export async function listDoctorAvailability(doctorId: string) {
  await assertDoctor(doctorId);
  const now = new Date();
  const availability = await prisma.doctorAvailability.findMany({
    where: {
      doctorId,
      isActive: true,
      startsAt: { gt: now },
      appointment: null
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    include: availabilityInclude
  });
  return availability.map(toAvailabilityResponse);
}

export async function createDoctorAvailability(doctorId: string, input: AvailabilityCreateInput) {
  await assertDoctor(doctorId);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  assertFutureSlot(startsAt, endsAt);

  try {
    const availability = await prisma.doctorAvailability.create({
      data: { doctorId, startsAt, endsAt }
    });
    return toAvailabilityResponse(availability);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "AVAILABILITY_ALREADY_EXISTS", "This availability slot already exists");
    }
    throw error;
  }
}

export async function listOwnAvailability(doctorId: string) {
  await assertDoctor(doctorId);
  const availability = await prisma.doctorAvailability.findMany({
    where: { doctorId },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    include: availabilityInclude
  });
  return availability.map(toAvailabilityResponse);
}

export async function deactivateDoctorAvailability(doctorId: string, availabilityId: string) {
  await assertDoctor(doctorId);
  const availability = await prisma.doctorAvailability.findFirst({
    where: { id: availabilityId, doctorId },
    include: availabilityInclude
  });
  if (!availability) throw new AppError(404, "AVAILABILITY_NOT_FOUND", "Availability slot was not found");
  if (availability.appointment && availability.appointment.status !== AppointmentStatus.CANCELLED) {
    throw new AppError(409, "AVAILABILITY_STATE_CONFLICT", "Booked availability cannot be deactivated");
  }
  const updated = await prisma.doctorAvailability.update({
    where: { id: availabilityId },
    data: { isActive: false },
    include: availabilityInclude
  });
  return toAvailabilityResponse(updated);
}

export async function bookAppointment(patientId: string, input: BookAppointmentInput) {
  await assertPatient(patientId);
  try {
    const appointment = await prisma.$transaction(async (transaction) => {
      const availability = await transaction.doctorAvailability.findUnique({
        where: { id: input.availabilityId },
        include: { doctor: { select: { id: true, fullName: true, role: true, isActive: true, isVerified: true } }, appointment: { select: { id: true, status: true } } }
      });
      if (!availability || !availability.doctor.isActive || !availability.doctor.isVerified || availability.doctor.role !== UserRole.DOCTOR) {
        throw new AppError(404, "DOCTOR_NOT_FOUND", "Doctor or availability was not found");
      }
      if (!availability.isActive || availability.appointment) {
        throw new AppError(409, "SLOT_UNAVAILABLE", "This consultation slot is no longer available");
      }
      assertFutureSlot(availability.startsAt, availability.endsAt);

      const appointment = await transaction.appointment.create({
        data: {
          doctorId: availability.doctorId,
          patientId,
          availabilityId: availability.id,
          consultationType: input.consultationType,
          scheduledAt: availability.startsAt,
          endsAt: availability.endsAt,
          patientNotes: input.patientNotes || null
        },
        include: appointmentInclude
      });
      await recordAnalyticsEvent(transaction, "CONSULTATION_BOOKED", { userId: patientId, entityType: "APPOINTMENT", entityId: appointment.id, metadata: { consultationType: input.consultationType } });
      await recordAuditEvent(transaction, {
        eventType: "APPOINTMENT_CREATED",
        actorUserId: patientId,
        actorRole: "PATIENT",
        resourceType: "APPOINTMENT",
        resourceId: appointment.id,
        metadata: { doctorUserId: availability.doctorId }
      });
      return appointment;
    });
    return toAppointmentResponse(appointment);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "SLOT_UNAVAILABLE", "This consultation slot is no longer available");
    }
    throw error;
  }
}

export async function listPatientAppointments(patientId: string) {
  await assertPatient(patientId);
  const appointments = await prisma.appointment.findMany({
    where: { patientId },
    orderBy: [{ scheduledAt: "desc" }, { id: "desc" }],
    include: appointmentInclude
  });
  return appointments.map(toAppointmentResponse);
}

export async function getPatientAppointment(patientId: string, appointmentId: string) {
  await assertPatient(patientId);
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, patientId }, include: appointmentInclude });
  if (!appointment) throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found");
  return toAppointmentResponse(appointment);
}

export async function cancelPatientAppointment(patientId: string, appointmentId: string, input: CancellationInput) {
  await assertPatient(patientId);
  const updated = await prisma.appointment.updateMany({
    where: { id: appointmentId, patientId, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] } },
    data: { status: AppointmentStatus.CANCELLED, cancellationReason: input.reason || null, cancelledAt: new Date() }
  });
  if (updated.count !== 1) await throwAppointmentStateError(appointmentId, patientId);
  await recordAuditEventSafe({
    eventType: "APPOINTMENT_STATUS_CHANGED",
    actorUserId: patientId,
    actorRole: "PATIENT",
    resourceType: "APPOINTMENT",
    resourceId: appointmentId,
    metadata: { to: AppointmentStatus.CANCELLED }
  });
  return getPatientAppointment(patientId, appointmentId);
}

export async function listDoctorAppointments(doctorId: string) {
  await assertDoctor(doctorId);
  const appointments = await prisma.appointment.findMany({ where: { doctorId }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], include: appointmentInclude });
  return appointments.map(toAppointmentResponse);
}

export async function getDoctorAppointment(doctorId: string, appointmentId: string) {
  await assertDoctor(doctorId);
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, doctorId }, include: appointmentInclude });
  if (!appointment) throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found");
  return toAppointmentResponse(appointment);
}

export async function listAdminAppointments(query: AdminAppointmentListQuery) {
  const where = {
    ...(query.status ? { status: query.status as AppointmentStatus } : {}),
    ...(query.doctorId ? { doctorId: query.doctorId } : {}),
    ...(query.from || query.to ? { scheduledAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {})
  };
  const skip = (query.page - 1) * query.pageSize;
  const [total, appointments] = await prisma.$transaction([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], skip, take: query.pageSize, include: appointmentInclude })
  ]);
  return { items: appointments.map(toAppointmentResponse), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

export async function getAdminAppointment(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: appointmentInclude });
  if (!appointment) throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found");
  return toAppointmentResponse(appointment);
}

export async function confirmDoctorAppointment(doctorId: string, appointmentId: string) {
  await assertDoctor(doctorId);
  const updated = await prisma.appointment.updateMany({ where: { id: appointmentId, doctorId, status: AppointmentStatus.PENDING }, data: { status: AppointmentStatus.CONFIRMED, confirmedAt: new Date() } });
  if (updated.count !== 1) await throwAppointmentStateError(appointmentId, doctorId);
  return getDoctorAppointment(doctorId, appointmentId);
}

export async function completeDoctorAppointment(doctorId: string, appointmentId: string) {
  await assertDoctor(doctorId);
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.appointment.updateMany({ where: { id: appointmentId, doctorId, status: AppointmentStatus.CONFIRMED }, data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() } });
    if (result.count === 1) {
      await recordAnalyticsEvent(transaction, "CONSULTATION_COMPLETED", { userId: doctorId, entityType: "APPOINTMENT", entityId: appointmentId });
      await recordAuditEvent(transaction, {
        eventType: "APPOINTMENT_STATUS_CHANGED",
        actorUserId: doctorId,
        actorRole: "DOCTOR",
        resourceType: "APPOINTMENT",
        resourceId: appointmentId,
        metadata: { to: AppointmentStatus.COMPLETED }
      });
    }
    return result;
  });
  if (updated.count !== 1) await throwAppointmentStateError(appointmentId, doctorId);
  return getDoctorAppointment(doctorId, appointmentId);
}

export async function cancelDoctorAppointment(doctorId: string, appointmentId: string, input: CancellationInput) {
  await assertDoctor(doctorId);
  if (!input.reason) throw new AppError(400, "CANCELLATION_REASON_REQUIRED", "A cancellation reason is required");
  const updated = await prisma.appointment.updateMany({ where: { id: appointmentId, doctorId, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] } }, data: { status: AppointmentStatus.CANCELLED, cancellationReason: input.reason, cancelledAt: new Date() } });
  if (updated.count !== 1) await throwAppointmentStateError(appointmentId, doctorId);
  return getDoctorAppointment(doctorId, appointmentId);
}

async function assertDoctor(userId: string) {
  const doctor = await prisma.user.findFirst({ where: { id: userId, role: UserRole.DOCTOR, isActive: true, isVerified: true }, select: { id: true } });
  if (!doctor) throw new AppError(403, "DOCTOR_NOT_AUTHORIZED", "Doctor access is not authorized");
  return doctor;
}

async function assertPatient(userId: string) {
  const patient = await prisma.user.findFirst({ where: { id: userId, role: UserRole.PATIENT, isActive: true }, select: { id: true } });
  if (!patient) throw new AppError(403, "PATIENT_NOT_AUTHORIZED", "Patient access is not authorized");
  return patient;
}

async function throwAppointmentStateError(appointmentId: string, ownerId: string): Promise<never> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, OR: [{ patientId: ownerId }, { doctorId: ownerId }] },
    select: { id: true, status: true }
  });
  if (!appointment) throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found");
  throw new AppError(409, "APPOINTMENT_STATE_CONFLICT", "Appointment transition is not valid");
}

function assertFutureSlot(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) throw new AppError(400, "INVALID_AVAILABILITY", "Availability must end after it starts");
  if (startsAt <= new Date()) throw new AppError(400, "PAST_APPOINTMENT_SLOT", "Appointment slots must be in the future");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
