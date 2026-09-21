import { apiClient } from "../api/client";

export type LabTest = {
  testId: string;
  name: string;
  description: string | null;
  category: string;
  preparationInstructions: string | null;
  price: string;
  currency: string;
  requiresPrescription: boolean;
  homeCollectionAvailable: boolean;
  centerCollectionAvailable: boolean;
};

export type LabBooking = {
  bookingId: string;
  patient: { patientId: string; fullName: string };
  test: LabTest;
  collectionType: "HOME" | "CENTER";
  preferredDate: string;
  preferredTimeSlot: string | null;
  patientNotes: string | null;
  addressData: Record<string, unknown> | null;
  prescriptionId: string | null;
  status: string;
  externalOrderId: string | null;
  report: { documentName: string; mimeType: string; uploadedAt: string | null } | null;
  provider?: { provider: string; mode: string };
  createdAt: string;
  updatedAt: string;
};

export type LabReportAccess = {
  bookingId: string;
  status: string;
  documentName: string | null;
  mimeType: string | null;
  access: {
    reference: string;
    expiresAt: string;
  };
};

type Envelope<T> = { success: true; data: T };
const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

export function listLabTests(query: Record<string, string | number | boolean | undefined> = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });

  return data(
    apiClient.get<Envelope<{ items: LabTest[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>>(
      `/api/v1/labs/tests${params.size ? `?${params.toString()}` : ""}`
    )
  );
}

export function getLabTest(testId: string) {
  return data(apiClient.get<Envelope<LabTest>>(`/api/v1/labs/tests/${testId}`));
}

export function listPatientBookings() {
  return data(apiClient.get<Envelope<LabBooking[]>>("/api/v1/labs/bookings"));
}

export function getPatientBooking(bookingId: string) {
  return data(apiClient.get<Envelope<LabBooking>>(`/api/v1/labs/bookings/${bookingId}`));
}

export function createLabBooking(input: {
  labTestId: string;
  collectionType: "HOME" | "CENTER";
  preferredDate: string;
  preferredTimeSlot?: string;
  patientNotes?: string;
  addressData?: Record<string, unknown>;
  prescriptionId?: string;
}) {
  return data(apiClient.post<Envelope<LabBooking>>("/api/v1/labs/bookings", input));
}

export function getLabReport(bookingId: string) {
  return data(apiClient.get<Envelope<LabReportAccess>>(`/api/v1/labs/bookings/${bookingId}/report`));
}

export function getAdminLabReport(bookingId: string) {
  return data(apiClient.get<Envelope<LabReportAccess>>(`/api/v1/admin/labs/bookings/${bookingId}/report`));
}

export function listAdminBookings(query: { dsaQueue?: boolean } = {}) {
  const params = new URLSearchParams();
  if (query.dsaQueue) params.set("dsaQueue", "true");
  return data(apiClient.get<Envelope<LabBooking[]>>(`/api/v1/admin/labs/bookings${params.size ? `?${params.toString()}` : ""}`));
}

export function getAdminDsaBooking(bookingId: string) {
  return data(apiClient.get<Envelope<LabBooking>>(`/api/v1/admin/labs/bookings/${bookingId}/dsa`));
}

export function recordDsaBooking(bookingId: string, externalOrderId: string) {
  return data(
    apiClient.patch<Envelope<LabBooking>>(`/api/v1/admin/labs/bookings/${bookingId}/dsa`, { externalOrderId })
  );
}

export function addAdminOpsNote(bookingId: string, note: string) {
  return data(apiClient.post<Envelope<LabBooking>>(`/api/v1/admin/labs/bookings/${bookingId}/ops-notes`, { note }));
}

export function getAdminBooking(bookingId: string) {
  return data(apiClient.get<Envelope<LabBooking>>(`/api/v1/admin/labs/bookings/${bookingId}`));
}

export function markLabBookingBooked(bookingId: string, externalOrderId: string) {
  return data(
    apiClient.patch<Envelope<LabBooking>>(`/api/v1/admin/labs/bookings/${bookingId}/book`, { externalOrderId })
  );
}

export function updateAdminBookingStatus(
  bookingId: string,
  input: { status: string; reason?: string }
) {
  return data(
    apiClient.patch<Envelope<LabBooking>>(`/api/v1/admin/labs/bookings/${bookingId}/status`, input)
  );
}

export function uploadAdminLabReport(bookingId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return data(apiClient.postForm<Envelope<LabBooking>>(`/api/v1/admin/labs/bookings/${bookingId}/report`, form));
}
