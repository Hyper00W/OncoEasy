type LabTestRecord = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  preparationInstructions: string | null;
  price: { toFixed(decimalPlaces: number): string };
  currency: string;
  requiresPrescription: boolean;
  homeCollectionAvailable: boolean;
  centerCollectionAvailable: boolean;
  isActive: boolean;
};

type LabBookingRecord = {
  id: string;
  collectionType: string;
  preferredDate: Date;
  preferredTimeSlot: string | null;
  patientNotes: string | null;
  addressData: unknown;
  prescriptionId: string | null;
  status: string;
  externalOrderId: string | null;
  reportDocumentName: string | null;
  reportMimeType: string | null;
  reportUploadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  patient: { id: string; fullName: string };
  labTest: LabTestRecord;
};

export function toLabTestResponse(test: LabTestRecord) {
  return {
    testId: test.id,
    name: test.name,
    description: test.description,
    category: test.category,
    preparationInstructions: test.preparationInstructions,
    price: test.price.toFixed(2),
    currency: test.currency,
    requiresPrescription: test.requiresPrescription,
    homeCollectionAvailable: test.homeCollectionAvailable,
    centerCollectionAvailable: test.centerCollectionAvailable
  };
}

export function toLabBookingResponse(booking: LabBookingRecord) {
  return {
    bookingId: booking.id,
    patient: { patientId: booking.patient.id, fullName: booking.patient.fullName },
    test: toLabTestResponse(booking.labTest),
    collectionType: booking.collectionType,
    preferredDate: booking.preferredDate.toISOString().slice(0, 10),
    preferredTimeSlot: booking.preferredTimeSlot,
    patientNotes: booking.patientNotes,
    addressData: booking.addressData,
    prescriptionId: booking.prescriptionId,
    status: booking.status,
    externalOrderId: booking.externalOrderId,
    report: booking.reportDocumentName ? { documentName: booking.reportDocumentName, mimeType: booking.reportMimeType, uploadedAt: booking.reportUploadedAt?.toISOString() ?? null } : null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString()
  };
}
