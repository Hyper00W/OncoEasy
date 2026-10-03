import { createHash } from "node:crypto";

import { PrescriptionSource, PrescriptionStatus } from "@prisma/client";

import { prisma } from "../../../database/prisma";
import { AppError } from "../../../errors/app-error";
import {
  createPrivateTemporaryAccess,
  deletePrivateObject,
  uploadPrivatePrescription
} from "../../../storage/private-storage";
import { toPrescriptionResponse } from "./prescription.mapper";
import type { PrescriptionListQuery } from "./prescription.schemas";
import {
  normalizeDocumentName,
  validatePrescriptionFile
} from "./prescription.storage";
import { recordAnalyticsEvent } from "../../analytics/analytics.events";
import { recordAuditEvent, recordAuditEventSafe } from "../../../observability/audit";

const prescriptionSelect = {
  id: true,
  source: true,
  status: true,
  documentName: true,
  mimeType: true,
  notes: true,
  createdAt: true
} as const;

const reviewPrescriptionSelect = {
  id: true,
  patientId: true,
  source: true,
  status: true,
  documentKey: true,
  documentName: true,
  mimeType: true,
  notes: true,
  createdAt: true,
  reviewedByUserId: true,
  reviewedAt: true,
  reviewReason: true
} as const;

export async function createPatientPrescription(
  patientId: string,
  file: Express.Multer.File | undefined,
  notes?: string
) {
  if (!file) {
    throw new AppError(400, "FILE_REQUIRED", "A prescription file is required");
  }

  const fileType = validatePrescriptionFile(file);
  const checksum = createHash("sha256").update(file.buffer).digest("hex");
  const uploaded = await uploadPrivatePrescription({
    extension: fileType.extension,
    contentType: fileType.mimeType,
    body: file.buffer
  });

  try {
    const prescription = await prisma.prescription.create({
      data: {
        patientId,
        source: PrescriptionSource.PATIENT_UPLOAD,
        status: PrescriptionStatus.PENDING_REVIEW,
        documentKey: uploaded.key,
        documentName: normalizeDocumentName(file.originalname),
        mimeType: fileType.mimeType,
        checksum,
        notes: notes || null,
        createdByUserId: patientId
      },
      select: prescriptionSelect
    });

    // Business-action audit: submission is recorded without any document
    // metadata (no name, key, checksum, or notes).
    await recordAuditEvent(prisma, {
      eventType: "PRESCRIPTION_SUBMITTED",
      actorUserId: patientId,
      actorRole: "PATIENT",
      resourceType: "PRESCRIPTION",
      resourceId: prescription.id
    });

    return toPrescriptionResponse(prescription);
  } catch (error) {
    await deletePrivateObject(uploaded.key);
    throw error;
  }
}

export async function listPatientPrescriptions(
  patientId: string,
  query: PrescriptionListQuery
) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, prescriptions] = await prisma.$transaction([
    prisma.prescription.count({ where: { patientId } }),
    prisma.prescription.findMany({
      where: { patientId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: query.pageSize,
      select: prescriptionSelect
    })
  ]);

  return {
    items: prescriptions.map(toPrescriptionResponse),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize)
    }
  };
}

export async function getPatientPrescription(patientId: string, prescriptionId: string) {
  const prescription = await prisma.prescription.findFirst({
    where: { id: prescriptionId, patientId },
    select: prescriptionSelect
  });

  if (!prescription) {
    throw new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription was not found");
  }

  return toPrescriptionResponse(prescription);
}

export async function listPrescriptionReviewQueue(query: PrescriptionListQuery) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, prescriptions] = await prisma.$transaction([
    prisma.prescription.count({ where: { status: PrescriptionStatus.PENDING_REVIEW } }),
    prisma.prescription.findMany({
      where: { status: PrescriptionStatus.PENDING_REVIEW },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip,
      take: query.pageSize,
      select: reviewPrescriptionSelect
    })
  ]);

  return {
    items: prescriptions.map(toReviewPrescriptionResponse),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize)
    }
  };
}

export async function getPrescriptionForReview(prescriptionId: string) {
  const prescription = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    select: reviewPrescriptionSelect
  });

  if (!prescription) {
    throw new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription was not found");
  }

  const documentAccess = await createPrivateTemporaryAccess(prescription.documentKey);
  return {
    ...toReviewPrescriptionResponse(prescription),
    documentAccess
  };
}

export async function verifyPrescription(prescriptionId: string, reviewerId: string) {
  return transitionPrescription(prescriptionId, reviewerId, {
    status: PrescriptionStatus.VERIFIED,
    verifiedAt: new Date(),
    reviewReason: null
  });
}

export async function rejectPrescription(
  prescriptionId: string,
  reviewerId: string,
  reason: string
) {
  return transitionPrescription(prescriptionId, reviewerId, {
    status: PrescriptionStatus.REJECTED,
    verifiedAt: null,
    reviewReason: reason
  });
}

export async function queryPrescription(
  prescriptionId: string,
  reviewerId: string,
  reason: string
) {
  return transitionPrescription(prescriptionId, reviewerId, {
    status: PrescriptionStatus.QUERY,
    verifiedAt: null,
    reviewReason: reason
  });
}

async function transitionPrescription(
  prescriptionId: string,
  reviewerId: string,
  data: {
    status: PrescriptionStatus;
    verifiedAt: Date | null;
    reviewReason: string | null;
  }
) {
  const reviewedAt = new Date();
  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.prescription.updateMany({
      where: { id: prescriptionId, status: PrescriptionStatus.PENDING_REVIEW },
      data: { status: data.status, reviewedByUserId: reviewerId, reviewedAt, verifiedAt: data.verifiedAt, reviewReason: data.reviewReason }
    });
    if (result.count === 1 && data.status === PrescriptionStatus.QUERY) {
      await recordAnalyticsEvent(transaction, "PRESCRIPTION_QUERY_CREATED", { userId: reviewerId, entityType: "PRESCRIPTION", entityId: prescriptionId });
    }
    if (result.count === 1) {
      // Review actions are security-relevant pharmacist decisions; the review
      // reason (free text) is deliberately not copied into audit metadata.
      await recordAuditEvent(transaction, {
        eventType:
          data.status === PrescriptionStatus.VERIFIED
            ? "PRESCRIPTION_VERIFIED"
            : data.status === PrescriptionStatus.REJECTED
              ? "PRESCRIPTION_REJECTED"
              : "PRESCRIPTION_QUERIED",
        actorUserId: reviewerId,
        resourceType: "PRESCRIPTION",
        resourceId: prescriptionId,
        metadata: { status: data.status }
      });
    }
    return result;
  });

  if (updated.count === 0) {
    const exists = await prisma.prescription.findUnique({
      where: { id: prescriptionId },
      select: { id: true }
    });
    if (!exists) {
      throw new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription was not found");
    }
    throw new AppError(
      409,
      "PRESCRIPTION_STATE_CONFLICT",
      "Prescription is no longer pending review"
    );
  }

  const prescription = await prisma.prescription.findUniqueOrThrow({
    where: { id: prescriptionId },
    select: reviewPrescriptionSelect
  });
  return toReviewPrescriptionResponse(prescription);
}

function toReviewPrescriptionResponse(prescription: {
  id: string;
  patientId: string;
  source: string;
  status: string;
  documentKey: string;
  documentName: string;
  mimeType: string;
  notes: string | null;
  createdAt: Date;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
}) {
  return {
    id: prescription.id,
    patientId: prescription.patientId,
    source: prescription.source,
    status: prescription.status,
    documentName: prescription.documentName,
    mimeType: prescription.mimeType,
    notes: prescription.notes,
    createdAt: prescription.createdAt.toISOString(),
    reviewedByUserId: prescription.reviewedByUserId,
    reviewedAt: prescription.reviewedAt?.toISOString() ?? null,
    reviewReason: prescription.reviewReason
  };
}