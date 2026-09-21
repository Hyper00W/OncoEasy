type PapProgramRecord = {
  id: string;
  name: string;
  description: string;
  eligibilityDescription: string;
  requiredDocuments: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type PapDocumentRecord = {
  id: string;
  documentName: string;
  mimeType: string;
  uploadedAt: Date;
};

type PapApplicationRecord = {
  id: string;
  status: string;
  applicationData: unknown;
  reviewNotes: string | null;
  reviewReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  patient: { id: string; fullName: string };
  papProgram: PapProgramRecord;
  reviewer: { id: string; fullName: string } | null;
  documents: PapDocumentRecord[];
};

export function toPapProgramResponse(program: PapProgramRecord) {
  return {
    programId: program.id,
    name: program.name,
    description: program.description,
    eligibilityDescription: program.eligibilityDescription,
    requiredDocuments: program.requiredDocuments,
    isActive: program.isActive,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString()
  };
}

export function toPapApplicationResponse(application: PapApplicationRecord) {
  return {
    applicationId: application.id,
    patient: { patientId: application.patient.id, fullName: application.patient.fullName },
    program: toPapProgramResponse(application.papProgram),
    status: application.status,
    applicationData: application.applicationData,
    reviewNotes: application.reviewNotes,
    reviewReason: application.reviewReason,
    reviewedBy: application.reviewer ? { userId: application.reviewer.id, fullName: application.reviewer.fullName } : null,
    reviewedAt: application.reviewedAt?.toISOString() ?? null,
    documents: application.documents.map((document) => ({
      documentId: document.id,
      documentName: document.documentName,
      mimeType: document.mimeType,
      uploadedAt: document.uploadedAt.toISOString()
    })),
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString()
  };
}

export function toPapDocumentAccessResponse(document: PapDocumentRecord, access: { reference: string; expiresAt: Date }) {
  return {
    documentId: document.id,
    documentName: document.documentName,
    mimeType: document.mimeType,
    access: {
      reference: access.reference,
      expiresAt: access.expiresAt.toISOString()
    }
  };
}
