type PrescriptionRecord = {
  id: string;
  source: string;
  status: string;
  documentName: string;
  mimeType: string;
  notes: string | null;
  createdAt: Date;
};

export function toPrescriptionResponse(prescription: PrescriptionRecord) {
  return {
    id: prescription.id,
    source: prescription.source,
    status: prescription.status,
    documentName: prescription.documentName,
    mimeType: prescription.mimeType,
    notes: prescription.notes,
    createdAt: prescription.createdAt.toISOString()
  };
}