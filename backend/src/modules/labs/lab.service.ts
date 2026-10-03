import { createHash } from "node:crypto";
import { LabBookingStatus, Prisma, PrescriptionStatus, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { createPrivateTemporaryAccess, deletePrivateObject, uploadPrivateFile } from "../../storage/private-storage";
import { toLabBookingResponse, toLabTestResponse } from "./lab.mapper";
import { normalizeLabReportName, validateLabReportFile } from "./lab.storage";
import type { BookLabBookingInput, CreateLabBookingInput, LabListQuery, UpdateLabStatusInput } from "./lab.schemas";
import { recordAnalyticsEvent } from "../analytics/analytics.events";
import { recordAuditEvent } from "../../observability/audit";
import { getLabBookingProvider } from "./lab-provider";

function currentProviderInfo() {
  const provider = getLabBookingProvider();
  return { provider: provider.provider, mode: provider.mode } as const;
}

const labTestSelect = {
  id: true, name: true, description: true, category: true, preparationInstructions: true,
  price: true, currency: true, requiresPrescription: true, homeCollectionAvailable: true,
  centerCollectionAvailable: true, isActive: true
} as const;

const bookingInclude = {
  patient: { select: { id: true, fullName: true } },
  labTest: { select: labTestSelect }
} as const;

export async function listLabTests(query: LabListQuery) {
  const where = { isActive: true, ...(query.category ? { category: query.category } : {}) };
  const skip = (query.page - 1) * query.pageSize;
  const [total, tests] = await prisma.$transaction([
    prisma.labTest.count({ where }),
    prisma.labTest.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take: query.pageSize, select: labTestSelect })
  ]);
  return { items: tests.map(toLabTestResponse), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

export async function getLabTest(testId: string) {
  const test = await prisma.labTest.findFirst({ where: { id: testId, isActive: true }, select: labTestSelect });
  if (!test) throw new AppError(404, "LAB_TEST_NOT_FOUND", "Lab test was not found");
  return toLabTestResponse(test);
}

export async function createLabBooking(patientId: string, input: CreateLabBookingInput) {
  await assertPatient(patientId);
  const test = await prisma.labTest.findFirst({ where: { id: input.labTestId, isActive: true }, select: labTestSelect });
  if (!test) throw new AppError(404, "LAB_TEST_NOT_FOUND", "Lab test was not found");
  assertCollectionSupported(test, input.collectionType);
  const preferredDate = parseDate(input.preferredDate);
  if (preferredDate < startOfToday()) throw new AppError(400, "PAST_LAB_DATE", "Lab booking date cannot be in the past");

  let prescriptionId: string | null = null;
  if (test.requiresPrescription) {
    if (!input.prescriptionId) throw new AppError(400, "PRESCRIPTION_REQUIRED", "A verified prescription is required for this lab test");
    const prescription = await prisma.prescription.findFirst({ where: { id: input.prescriptionId, patientId, status: PrescriptionStatus.VERIFIED }, select: { id: true } });
    if (!prescription) throw new AppError(409, "PRESCRIPTION_NOT_VERIFIED", "Prescription must be verified before booking this lab test");
    prescriptionId = prescription.id;
  }

  const booking = await prisma.$transaction(async (transaction) => {
    const created = await transaction.labBooking.create({
      data: { patientId, labTestId: test.id, collectionType: input.collectionType, preferredDate, preferredTimeSlot: input.preferredTimeSlot || null, patientNotes: input.patientNotes || null, addressData: input.addressData as Prisma.InputJsonValue | undefined, prescriptionId },
      include: bookingInclude
    });
    await recordAnalyticsEvent(transaction, "LAB_BOOKING_CREATED", { userId: patientId, entityType: "LAB_BOOKING", entityId: created.id });
    await recordAuditEvent(transaction, {
      eventType: "LAB_BOOKING_CREATED",
      actorUserId: patientId,
      actorRole: "PATIENT",
      resourceType: "LAB_BOOKING",
      resourceId: created.id,
      metadata: { collectionType: input.collectionType }
    });
    return created;
  });
  return toLabBookingResponse(booking);
}

export async function listPatientBookings(patientId: string) {
  await assertPatient(patientId);
  const bookings = await prisma.labBooking.findMany({ where: { patientId }, orderBy: [{ preferredDate: "desc" }, { createdAt: "desc" }], include: bookingInclude });
  return bookings.map(toLabBookingResponse);
}

export async function getPatientBooking(patientId: string, bookingId: string) {
  await assertPatient(patientId);
  const booking = await prisma.labBooking.findFirst({ where: { id: bookingId, patientId }, include: bookingInclude });
  if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");
  return toLabBookingResponse(booking);
}

export async function getLabReport(userId: string, bookingId: string, isAdmin: boolean) {
  if (!isAdmin) await assertPatient(userId);
  const booking = await prisma.labBooking.findFirst({ where: isAdmin ? { id: bookingId } : { id: bookingId, patientId: userId }, include: bookingInclude });
  if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");
  if (!booking.reportStorageKey || (booking.status !== LabBookingStatus.REPORT_READY && booking.status !== LabBookingStatus.COMPLETED)) {
    throw new AppError(409, "LAB_REPORT_NOT_AVAILABLE", "The lab report is not available");
  }
  const access = await createPrivateTemporaryAccess(booking.reportStorageKey);
  return { bookingId: booking.id, status: booking.status, documentName: booking.reportDocumentName, mimeType: booking.reportMimeType, access };
}

export async function listAdminBookings(query: { status?: LabBookingStatus; preferredDate?: string; dsaQueue?: boolean }) {
  if (query.dsaQueue) {
    return prisma.labBooking.findMany({ where: { status: LabBookingStatus.PENDING_OPS }, orderBy: [{ preferredDate: "asc" }, { createdAt: "asc" }], include: bookingInclude }).then((bookings) => bookings.map(toLabBookingResponse));
  }
  const bookings = await prisma.labBooking.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.preferredDate ? { preferredDate: parseDate(query.preferredDate) } : {}) }, orderBy: [{ preferredDate: "asc" }, { createdAt: "asc" }], include: bookingInclude });
  return bookings.map(toLabBookingResponse);
}

export async function getAdminBooking(bookingId: string) {
  const booking = await prisma.labBooking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");
  return toLabBookingResponse(booking);
}

/**
 * Pending manual Thyrocare DSA queue: bookings awaiting an Ops operator to
 * place the collection in the Thyrocare DSA portal and record the reference.
 */
export async function listPendingDsaBookings() {
  return listAdminBookings({ dsaQueue: true });
}

export async function getAdminDsaBooking(bookingId: string) {
  const booking = await prisma.labBooking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");
  return { ...toLabBookingResponse(booking), provider: currentProviderInfo() };
}

export async function recordExternalBooking(bookingId: string, input: BookLabBookingInput) {
  return recordDsaBooking(bookingId, input);
}

/**
 * Provider-backed and idempotent: the adapter runs inside the transaction;
 * repeating the same reference is accepted as a no-op, a different reference
 * is rejected, and the reference is unique across bookings.
 */export async function recordDsaBooking(bookingId: string, input: BookLabBookingInput) {
  const booking = await prisma.labBooking.findUnique({ where: { id: bookingId }, select: { status: true, externalOrderId: true, collectionType: true, preferredDate: true, preferredTimeSlot: true } });
  if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");

  // Idempotency: a reference already recorded on this booking is a no-op when
  // identical and a conflict when different, regardless of current status.
  if (booking.externalOrderId) {
    if (booking.externalOrderId !== input.externalOrderId) {
      throw new AppError(409, "EXTERNAL_ORDER_MISMATCH", "A different external order reference is already recorded for this booking");
    }
    return getAdminDsaBooking(bookingId);
  }

  if (booking.status !== LabBookingStatus.PENDING_OPS) throw new AppError(409, "LAB_BOOKING_STATE_CONFLICT", "External booking can only be recorded while the booking is pending Ops");

  const provider = getLabBookingProvider();
  await provider.createExternalBooking({
    bookingId,
    collectionType: booking.collectionType,
    preferredDate: booking.preferredDate.toISOString().slice(0, 10),
    preferredTimeSlot: booking.preferredTimeSlot
  });

  try {
    const updated = await prisma.labBooking.update({
      where: { id: bookingId, status: LabBookingStatus.PENDING_OPS },
      data: { externalOrderId: input.externalOrderId, status: LabBookingStatus.BOOKED },
      include: bookingInclude
    });
    // DSA booking reference recording: the external order reference is an
    // operational identifier and is safe to audit; patient data is not.
    await recordAuditEvent(prisma, {
      eventType: "LAB_BOOKING_STATUS_CHANGED",
      resourceType: "LAB_BOOKING",
      resourceId: bookingId,
      metadata: { from: LabBookingStatus.PENDING_OPS, to: LabBookingStatus.BOOKED }
    });
    return { ...toLabBookingResponse(updated), provider: currentProviderInfo() };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "EXTERNAL_ORDER_ALREADY_RECORDED", "This external order reference is already recorded on another booking");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      await throwBookingStateError(bookingId);
    }
    throw error;
  }
}/** Ops-only operational note stored in booking metadata (never patient-visible). */export async function addOpsNote(bookingId: string, note: string) {
  const updated = await prisma.$transaction(async (transaction) => {
    const booking = await transaction.labBooking.findUnique({ where: { id: bookingId }, select: { id: true, opsNotes: true } });
    if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");
    const entry = { at: new Date().toISOString(), note };
    const existingNotes = Array.isArray(booking.opsNotes) ? booking.opsNotes : [];
    return transaction.labBooking.update({ where: { id: bookingId }, data: { opsNotes: [...existingNotes, entry] as Prisma.InputJsonValue[] }, include: bookingInclude });
  });
  return toLabBookingResponse(updated);
}

export async function updateAdminBookingStatus(bookingId: string, input: UpdateLabStatusInput) {
  const booking = await prisma.labBooking.findUnique({ where: { id: bookingId }, select: { status: true, externalOrderId: true } });
  if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");
  assertStatusTransition(booking.status, input.status);
  const provider = getLabBookingProvider();
  if (booking.externalOrderId) {
    await provider.pushExternalStatus({ bookingId, externalOrderId: booking.externalOrderId, status: input.status });
  }
  try {
    // Conditional transition: only a row still in the source status is moved,
    // so concurrent Ops updates cannot interleave contradictory statuses.
    const updated = await prisma.labBooking.updateMany({
      where: { id: bookingId, status: booking.status },
      data: { status: input.status, ...(input.status === LabBookingStatus.CANCELLED ? { cancellationReason: input.reason || null } : {}) }
    });
    if (updated.count === 0) await throwBookingStateError(bookingId);
    await recordAuditEvent(prisma, {
      eventType: "LAB_BOOKING_STATUS_CHANGED",
      resourceType: "LAB_BOOKING",
      resourceId: bookingId,
      metadata: { from: booking.status, to: input.status }
    });
    const refreshed = await prisma.labBooking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingInclude });
    return { ...toLabBookingResponse(refreshed), provider: currentProviderInfo() };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      await throwBookingStateError(bookingId);
    }
    throw error;
  }
}

export async function uploadLabReport(bookingId: string, file: Express.Multer.File | undefined) {
  if (!file) throw new AppError(400, "FILE_REQUIRED", "A lab report PDF is required");
  const fileType = validateLabReportFile(file);
  const booking = await prisma.labBooking.findUnique({ where: { id: bookingId }, select: { id: true, status: true, reportStorageKey: true } });
  if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");
  if (booking.status !== LabBookingStatus.BOOKED && booking.status !== LabBookingStatus.SAMPLE_COLLECTED) throw new AppError(409, "LAB_BOOKING_STATE_CONFLICT", "Report cannot be uploaded in this booking state");
  const uploaded = await uploadPrivateFile("lab-reports", { extension: fileType.extension, contentType: fileType.mimeType, body: file.buffer });
  try {
    const updated = await prisma.labBooking.update({ where: { id: bookingId }, data: { status: LabBookingStatus.REPORT_READY, reportStorageKey: uploaded.key, reportDocumentName: normalizeLabReportName(file.originalname), reportMimeType: fileType.mimeType, reportChecksum: createHash("sha256").update(file.buffer).digest("hex"), reportUploadedAt: new Date() }, include: bookingInclude });
    // Report upload is a sensitive Ops action; only the booking reference and
    // transition are recorded — never the document name or contents.
    await recordAuditEvent(prisma, {
      eventType: "LAB_REPORT_UPLOADED",
      resourceType: "LAB_BOOKING",
      resourceId: bookingId,
      metadata: { to: LabBookingStatus.REPORT_READY }
    });
    return toLabBookingResponse(updated);
  } catch (error) {
    await deletePrivateObject(uploaded.key);
    throw error;
  }
}

async function assertPatient(patientId: string) {
  const patient = await prisma.user.findFirst({ where: { id: patientId, role: UserRole.PATIENT, isActive: true }, select: { id: true } });
  if (!patient) throw new AppError(403, "PATIENT_NOT_AUTHORIZED", "Patient access is not authorized");
}

function assertCollectionSupported(test: { homeCollectionAvailable: boolean; centerCollectionAvailable: boolean }, collectionType: string) {
  if (collectionType === "HOME" && !test.homeCollectionAvailable) throw new AppError(409, "COLLECTION_TYPE_UNAVAILABLE", "Home collection is unavailable for this test");
  if (collectionType === "CENTER" && !test.centerCollectionAvailable) throw new AppError(409, "COLLECTION_TYPE_UNAVAILABLE", "Center collection is unavailable for this test");
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new AppError(400, "INVALID_DATE", "A valid date is required");
  return date;
}

function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function assertStatusTransition(current: LabBookingStatus, next: LabBookingStatus) {
  const allowed: Record<LabBookingStatus, LabBookingStatus[]> = {
    PENDING_OPS: [LabBookingStatus.BOOKED, LabBookingStatus.CANCELLED],
    BOOKED: [LabBookingStatus.SAMPLE_COLLECTED, LabBookingStatus.CANCELLED],
    SAMPLE_COLLECTED: [LabBookingStatus.REPORT_READY, LabBookingStatus.COMPLETED, LabBookingStatus.CANCELLED],
    REPORT_READY: [LabBookingStatus.COMPLETED],
    COMPLETED: [],
    CANCELLED: []
  };
  if (!allowed[current].includes(next)) throw new AppError(409, "LAB_BOOKING_STATE_CONFLICT", "Lab booking transition is not valid");
}

async function throwBookingStateError(bookingId: string): Promise<never> {
  const booking = await prisma.labBooking.findUnique({ where: { id: bookingId }, select: { id: true } });
  if (!booking) throw new AppError(404, "LAB_BOOKING_NOT_FOUND", "Lab booking was not found");
  throw new AppError(409, "LAB_BOOKING_STATE_CONFLICT", "Lab booking transition is not valid");
}
