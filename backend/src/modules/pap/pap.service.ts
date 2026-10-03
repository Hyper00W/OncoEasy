import { createHash } from "node:crypto";
import { PapApplicationStatus, Prisma, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { createPrivateTemporaryAccess, deletePrivateObject, uploadPrivateFile } from "../../storage/private-storage";
import { normalizePapDocumentName, validatePapDocumentFile } from "./pap.storage";
import { toPapApplicationResponse, toPapDocumentAccessResponse, toPapProgramResponse } from "./pap.mapper";
import type { CreatePapApplicationInput, PapApplicationListQuery, UpdatePapStatusInput } from "./pap.schemas";
import { recordAnalyticsEvent } from "../analytics/analytics.events";
import { recordAuditEvent } from "../../observability/audit";

const programSelect = {
  id: true,
  name: true,
  description: true,
  eligibilityDescription: true,
  requiredDocuments: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} as const;

const applicationInclude = {
  patient: { select: { id: true, fullName: true } },
  papProgram: { select: programSelect },
  reviewer: { select: { id: true, fullName: true } },
  documents: { select: { id: true, documentName: true, mimeType: true, uploadedAt: true }, orderBy: { uploadedAt: "asc" as const } }
} as const;

export async function listActivePrograms() {
  const programs = await prisma.pAPProgram.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }], select: programSelect });
  return programs.map(toPapProgramResponse);
}

export async function getActiveProgram(programId: string) {
  const program = await prisma.pAPProgram.findFirst({ where: { id: programId, isActive: true }, select: programSelect });
  if (!program) throw new AppError(404, "PAP_PROGRAM_NOT_FOUND", "PAP program was not found");
  return toPapProgramResponse(program);
}

export async function createPatientApplication(patientId: string, input: CreatePapApplicationInput) {
  await assertPatient(patientId);
  const program = await prisma.pAPProgram.findFirst({ where: { id: input.papProgramId, isActive: true }, select: programSelect });
  if (!program) throw new AppError(404, "PAP_PROGRAM_NOT_FOUND", "PAP program was not found");

  const application = await prisma.$transaction(async (transaction) => {
    const created = await transaction.pAPApplication.create({
      data: { patientId, papProgramId: program.id, applicationData: input.applicationData as Prisma.InputJsonValue },
      include: applicationInclude
    });
    await recordAnalyticsEvent(transaction, "PAP_SUBMITTED", { userId: patientId, entityType: "PAP_APPLICATION", entityId: created.id });
    // Business-action audit: applicationData (medical/financial content) is
    // never copied into audit metadata.
    await recordAuditEvent(transaction, {
      eventType: "PAP_APPLICATION_CREATED",
      actorUserId: patientId,
      actorRole: "PATIENT",
      resourceType: "PAP_APPLICATION",
      resourceId: created.id,
      metadata: { papProgramId: program.id }
    });
    return created;
  });
  return toPapApplicationResponse(application);
}

export async function listPatientApplications(patientId: string) {
  await assertPatient(patientId);
  const applications = await prisma.pAPApplication.findMany({ where: { patientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: applicationInclude });
  return applications.map(toPapApplicationResponse);
}

export async function getPatientApplication(patientId: string, applicationId: string) {
  await assertPatient(patientId);
  const application = await prisma.pAPApplication.findFirst({ where: { id: applicationId, patientId }, include: applicationInclude });
  if (!application) throw new AppError(404, "PAP_APPLICATION_NOT_FOUND", "PAP application was not found");
  return toPapApplicationResponse(application);
}

export async function uploadPatientDocument(patientId: string, applicationId: string, file: Express.Multer.File | undefined) {
  if (!file) throw new AppError(400, "FILE_REQUIRED", "A PAP document is required");
  const fileType = validatePapDocumentFile(file);
  const application = await prisma.pAPApplication.findFirst({ where: { id: applicationId, patientId }, select: { id: true } });
  if (!application) throw new AppError(404, "PAP_APPLICATION_NOT_FOUND", "PAP application was not found");

  const uploaded = await uploadPrivateFile("pap-documents", { extension: fileType.extension, contentType: fileType.mimeType, body: file.buffer });
  try {
    const document = await prisma.pAPApplicationDocument.create({
      data: {
        applicationId,
        storageKey: uploaded.key,
        documentName: normalizePapDocumentName(file.originalname),
        mimeType: fileType.mimeType,
        checksum: createHash("sha256").update(file.buffer).digest("hex")
      },
      select: { id: true, documentName: true, mimeType: true, uploadedAt: true }
    });
    return { documentId: document.id, documentName: document.documentName, mimeType: document.mimeType, uploadedAt: document.uploadedAt.toISOString() };
  } catch (error) {
    await deletePrivateObject(uploaded.key);
    throw error;
  }
}

export async function listAdminApplications(query: PapApplicationListQuery) {
  const applications = await prisma.pAPApplication.findMany({ where: query.status ? { status: query.status } : undefined, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: applicationInclude });
  return applications.map(toPapApplicationResponse);
}

export async function getAdminApplication(applicationId: string) {
  const application = await prisma.pAPApplication.findUnique({ where: { id: applicationId }, include: applicationInclude });
  if (!application) throw new AppError(404, "PAP_APPLICATION_NOT_FOUND", "PAP application was not found");
  return toPapApplicationResponse(application);
}

export async function updateApplicationStatus(applicationId: string, reviewerId: string, input: UpdatePapStatusInput) {
  const application = await prisma.pAPApplication.findUnique({ where: { id: applicationId }, select: { status: true } });
  if (!application) throw new AppError(404, "PAP_APPLICATION_NOT_FOUND", "PAP application was not found");
  assertStatusTransition(application.status, input.status);

  const updated = await prisma.$transaction(async (transaction) => {
    // Conditional transition: only a row still in the expected source status is
    // updated, so two concurrent reviewers can never both move the application
    // (e.g. one to APPROVED while the other moves it to REJECTED).
    const transitioned = await transaction.pAPApplication.updateMany({
      where: { id: applicationId, status: application.status },
      data: { status: input.status, reviewReason: input.reason || null, reviewNotes: input.reviewNotes || null, reviewedBy: reviewerId, reviewedAt: new Date() }
    });
    if (transitioned.count === 0) {
      throw new AppError(409, "PAP_APPLICATION_STATE_CONFLICT", "PAP application transition is not valid");
    }
    const result = await transaction.pAPApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: applicationInclude
    });
    await recordAnalyticsEvent(transaction, "PAP_STATUS_CHANGED", { userId: reviewerId, entityType: "PAP_APPLICATION", entityId: applicationId, metadata: { status: input.status } });
    await recordAuditEvent(transaction, {
      eventType: "PAP_STATUS_CHANGED",
      actorUserId: reviewerId,
      resourceType: "PAP_APPLICATION",
      resourceId: applicationId,
      metadata: { from: application.status, to: input.status }
    });
    if (input.status === PapApplicationStatus.COMPLETED) await recordAnalyticsEvent(transaction, "PAP_COMPLETED", { userId: result.patientId, entityType: "PAP_APPLICATION", entityId: applicationId });
    return result;
  });
  return toPapApplicationResponse(updated);
}

export async function getApplicationDocument(applicationId: string, documentId: string) {
  const document = await prisma.pAPApplicationDocument.findFirst({ where: { id: documentId, applicationId }, select: { id: true, storageKey: true, documentName: true, mimeType: true, uploadedAt: true } });
  if (!document) throw new AppError(404, "PAP_DOCUMENT_NOT_FOUND", "PAP document was not found");
  const access = await createPrivateTemporaryAccess(document.storageKey);
  return toPapDocumentAccessResponse(document, access);
}

async function assertPatient(patientId: string) {
  const patient = await prisma.user.findFirst({ where: { id: patientId, role: UserRole.PATIENT, isActive: true }, select: { id: true } });
  if (!patient) throw new AppError(403, "PATIENT_NOT_AUTHORIZED", "Patient access is not authorized");
}

function assertStatusTransition(current: PapApplicationStatus, next: PapApplicationStatus) {
  const allowed: Record<PapApplicationStatus, PapApplicationStatus[]> = {
    SUBMITTED: [PapApplicationStatus.UNDER_REVIEW],
    UNDER_REVIEW: [PapApplicationStatus.MORE_INFORMATION_REQUIRED, PapApplicationStatus.APPROVED, PapApplicationStatus.REJECTED],
    MORE_INFORMATION_REQUIRED: [PapApplicationStatus.SUBMITTED, PapApplicationStatus.UNDER_REVIEW, PapApplicationStatus.REJECTED],
    APPROVED: [PapApplicationStatus.COMPLETED],
    REJECTED: [],
    COMPLETED: []
  };
  if (!allowed[current].includes(next)) throw new AppError(409, "PAP_APPLICATION_STATE_CONFLICT", "PAP application transition is not valid");
}
