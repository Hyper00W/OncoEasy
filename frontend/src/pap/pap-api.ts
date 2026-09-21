import { apiClient } from "../api/client";

export type PapProgram = {
  programId: string;
  name: string;
  description: string;
  eligibilityDescription: string;
  requiredDocuments: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PapDocument = {
  documentId: string;
  documentName: string;
  mimeType: string;
  uploadedAt: string;
};

export type PapApplication = {
  applicationId: string;
  patient: { patientId: string; fullName: string };
  program: PapProgram;
  status: string;
  applicationData: {
    fullName: string;
    phone: string;
    address: string;
    diagnosisSummary: string;
    householdIncome: string;
    financialNeed: string;
  };
  reviewNotes: string | null;
  reviewReason: string | null;
  reviewedBy: { userId: string; fullName: string } | null;
  reviewedAt: string | null;
  documents: PapDocument[];
  createdAt: string;
  updatedAt: string;
};

export type PapDocumentAccess = {
  documentId: string;
  documentName: string;
  mimeType: string;
  access: { reference: string; expiresAt: string };
};

type Envelope<T> = { success: true; data: T };
const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

export function listPapPrograms() {
  return data(apiClient.get<Envelope<PapProgram[]>>("/api/v1/pap/programs"));
}

export function getPapProgram(programId: string) {
  return data(apiClient.get<Envelope<PapProgram>>(`/api/v1/pap/programs/${programId}`));
}

export function createPapApplication(input: {
  papProgramId: string;
  applicationData: PapApplication["applicationData"];
}) {
  return data(apiClient.post<Envelope<PapApplication>>("/api/v1/pap/applications", input));
}

export function listPapApplications() {
  return data(apiClient.get<Envelope<PapApplication[]>>("/api/v1/pap/applications"));
}

export function getPapApplication(applicationId: string) {
  return data(apiClient.get<Envelope<PapApplication>>(`/api/v1/pap/applications/${applicationId}`));
}

export function uploadPapDocument(applicationId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return data(apiClient.postForm<Envelope<PapDocument>>(`/api/v1/pap/applications/${applicationId}/documents`, form));
}

export function listAdminPapApplications(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return data(apiClient.get<Envelope<PapApplication[]>>(`/api/v1/admin/pap/applications${query}`));
}

export function getAdminPapApplication(applicationId: string) {
  return data(apiClient.get<Envelope<PapApplication>>(`/api/v1/admin/pap/applications/${applicationId}`));
}

export function updatePapApplicationStatus(
  applicationId: string,
  input: { status: string; reason?: string; reviewNotes?: string }
) {
  return data(apiClient.patch<Envelope<PapApplication>>(`/api/v1/admin/pap/applications/${applicationId}/status`, input));
}

export function getAdminPapDocument(applicationId: string, documentId: string) {
  return data(apiClient.get<Envelope<PapDocumentAccess>>(`/api/v1/admin/pap/applications/${applicationId}/documents/${documentId}`));
}
