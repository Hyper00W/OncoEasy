import { apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type RateMetric = {
  rate: number;
};

export type ReferralConversion = RateMetric & { converted: number; created: number };
export type LabConversion = RateMetric & { completed: number; bookings: number };
export type PapCompletion = RateMetric & { completed: number; submitted: number };
export type PrescriptionQueryRate = RateMetric & { queried: number; reviewed: number };

export type AnalyticsOverview = {
  referralConversion: ReferralConversion;
  consultationModeSplit: { IN_CLINIC: number; PHONE: number };
  labConversion: LabConversion;
  papCompletion: PapCompletion;
  repeatPharmacyOrders: { patients: number };
  doctorReReferral: { doctorPatientPairs: number };
  journeyReturns: { count: number };
  knowledgeEngagement: { articleViews: number };
  clinicalTrialInterests: { submitted: number };
  patientStories: { published: number };
  papApprovalTime: { averageHours: number | null; approvedApplications: number };
  prescriptionQueryRate: PrescriptionQueryRate;
  completedPharmacyOrders: number;
};

export type AnalyticsEventName =
  | "REFERRAL_CREATED"
  | "REFERRAL_ORDERED"
  | "REFERRAL_FULFILLED"
  | "CONSULTATION_BOOKED"
  | "CONSULTATION_COMPLETED"
  | "LAB_BOOKING_CREATED"
  | "PAP_SUBMITTED"
  | "PAP_COMPLETED"
  | "PHARMACY_ORDER_COMPLETED"
  | "DOCTOR_REFERRAL_CREATED"
  | "JOURNEY_STAGE_RETURNED"
  | "KNOWLEDGE_ARTICLE_VIEWED"
  | "TRIAL_INTEREST_SUBMITTED"
  | "PATIENT_STORY_PUBLISHED"
  | "PAP_STATUS_CHANGED"
  | "PRESCRIPTION_QUERY_CREATED";

export type AnalyticsEvent = {
  eventId: string;
  eventName: AnalyticsEventName;
  userId: string | null;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

export type AnalyticsOverviewQuery = {
  from?: string;
  to?: string;
};

export type AnalyticsEventsQuery = {
  page?: number;
  pageSize?: number;
  eventName?: AnalyticsEventName;
  from?: string;
  to?: string;
};

export type Paginated<T> = {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export const analyticsEventNames: AnalyticsEventName[] = [
  "REFERRAL_CREATED",
  "REFERRAL_ORDERED",
  "REFERRAL_FULFILLED",
  "CONSULTATION_BOOKED",
  "CONSULTATION_COMPLETED",
  "LAB_BOOKING_CREATED",
  "PAP_SUBMITTED",
  "PAP_COMPLETED",
  "PHARMACY_ORDER_COMPLETED",
  "DOCTOR_REFERRAL_CREATED",
  "JOURNEY_STAGE_RETURNED",
  "KNOWLEDGE_ARTICLE_VIEWED",
  "TRIAL_INTEREST_SUBMITTED",
  "PATIENT_STORY_PUBLISHED",
  "PAP_STATUS_CHANGED",
  "PRESCRIPTION_QUERY_CREATED"
];

const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  (Object.entries(params) as Array<[string, string | number | undefined]>).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function getAnalyticsOverview(params: AnalyticsOverviewQuery = {}) {
  return data(apiClient.get<Envelope<AnalyticsOverview>>(`/api/v1/admin/analytics/overview${toQuery(params)}`));
}

export function listAnalyticsEvents(params: AnalyticsEventsQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<AnalyticsEvent>>>(`/api/v1/admin/analytics/events${toQuery(params)}`));
}
