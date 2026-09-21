import { apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type AdminOverview = {
  pendingPrescriptionReviews: number;
  pendingOrders: number;
  activeDeliveries: number;
  pendingReferrals: number;
  upcomingConsultations: number;
  pendingLabBookings: number;
  papApplicationsRequiringAttention: number;
  draftKnowledgeArticles: number;
  unpublishedClinicalTrials: number;
  storiesAwaitingReview: number;
  escalatedChatSessions: number;
};

export type ReferralStatus = "SENT" | "VIEWED" | "ORDERED" | "FULFILLED";

export type AdminReferral = {
  referralId: string;
  status: ReferralStatus;
  doctor: { doctorId: string; fullName: string } | undefined;
  patient: { patientId: string; fullName: string } | undefined;
  items: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: string;
    currency: string;
    unitLabel: string;
  }>;
  order: { id: string; status: string } | null;
  viewedAt: string | null;
  orderedAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReferralListQuery = {
  page?: number;
  pageSize?: number;
  status?: ReferralStatus;
};

export type AppointmentStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export type AdminAppointment = {
  appointmentId: string;
  doctor: { doctorId: string; fullName: string };
  patient: { patientId: string; fullName: string };
  availabilityId: string;
  consultationType: "IN_CLINIC" | "PHONE";
  scheduledAt: string;
  endsAt: string;
  status: AppointmentStatus;
  patientNotes: string | null;
  cancellationReason: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentListQuery = {
  page?: number;
  pageSize?: number;
  status?: AppointmentStatus;
  doctorId?: string;
  from?: string;
  to?: string;
};

export type Paginated<T> = {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export const referralStatuses: ReferralStatus[] = ["SENT", "VIEWED", "ORDERED", "FULFILLED"];
export const appointmentStatuses: AppointmentStatus[] = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"];

const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  (Object.entries(params) as Array<[string, string | number | boolean | undefined]>).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function getAdminOverview() {
  return data(apiClient.get<Envelope<AdminOverview>>("/api/v1/admin/overview"));
}

export function listAdminReferrals(params: ReferralListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<AdminReferral>>>(`/api/v1/admin/referrals${toQuery(params)}`));
}

export function getAdminReferral(referralId: string) {
  return data(apiClient.get<Envelope<AdminReferral>>(`/api/v1/admin/referrals/${encodeURIComponent(referralId)}`));
}

export function listAdminAppointments(params: AppointmentListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<AdminAppointment>>>(`/api/v1/admin/consultations/appointments${toQuery(params)}`));
}

export function getAdminAppointment(appointmentId: string) {
  return data(apiClient.get<Envelope<AdminAppointment>>(`/api/v1/admin/consultations/appointments/${encodeURIComponent(appointmentId)}`));
}
