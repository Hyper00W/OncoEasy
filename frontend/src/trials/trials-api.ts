import { apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type TrialSource = "CTRI" | "CLINICALTRIALS_GOV" | "OTHER";

export type TrialStatus =
  | "NOT_YET_RECRUITING"
  | "RECRUITING"
  | "ACTIVE_NOT_RECRUITING"
  | "COMPLETED"
  | "UNKNOWN";

export type TrialInterestStatus = "SUBMITTED" | "CONTACTED" | "CLOSED";

export type Trial = {
  trialId: string;
  title: string;
  summary: string;
  description: string;
  source: TrialSource;
  sourceTrialId: string | null;
  sourceUrl: string | null;
  sponsor: string | null;
  location: string | null;
  status: TrialStatus;
  eligibilitySummary: string | null;
  contactInformation: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminTrial = Trial & {
  createdBy: { userId: string; fullName: string } | null;
  updatedBy: { userId: string; fullName: string } | null;
};

export type TrialInterest = {
  interestId: string;
  trial: Trial;
  notes: string | null;
  status: TrialInterestStatus;
  createdAt: string;
  updatedAt: string;
};

export type AdminTrialInterest = TrialInterest & {
  patient: { patientId: string; fullName: string } | null;
};

export type Paginated<T> = {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type TrialListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: TrialStatus;
  isPublished?: boolean;
};

export type CreateTrialInput = {
  title: string;
  summary: string;
  description: string;
  source: TrialSource;
  sourceTrialId?: string | null;
  sourceUrl?: string | null;
  sponsor?: string | null;
  location?: string | null;
  status: TrialStatus;
  eligibilitySummary?: string | null;
  contactInformation?: string | null;
  isPublished?: boolean;
};

export type UpdateTrialInput = Partial<Omit<CreateTrialInput, "isPublished">>;

export type TrialInterestListQuery = {
  page?: number;
  pageSize?: number;
};

export const trialSources: TrialSource[] = ["CTRI", "CLINICALTRIALS_GOV", "OTHER"];
export const trialStatuses: TrialStatus[] = [
  "NOT_YET_RECRUITING",
  "RECRUITING",
  "ACTIVE_NOT_RECRUITING",
  "COMPLETED",
  "UNKNOWN"
];
export const trialInterestStatuses: TrialInterestStatus[] = ["SUBMITTED", "CONTACTED", "CLOSED"];

const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function listPublishedTrials(params: TrialListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<Trial>>>(`/api/v1/trials${toQuery(params)}`));
}

export function getPublishedTrial(trialId: string) {
  return data(apiClient.get<Envelope<Trial>>(`/api/v1/trials/${encodeURIComponent(trialId)}`));
}

export function submitTrialInterest(trialId: string, notes?: string) {
  return data(apiClient.post<Envelope<TrialInterest>>(`/api/v1/trials/${encodeURIComponent(trialId)}/interest`, notes ? { notes } : {}));
}

export function listMyTrialInterests() {
  return data(apiClient.get<Envelope<TrialInterest[]>>("/api/v1/trials/interests"));
}

export function listAdminTrials(params: TrialListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<AdminTrial>>>(`/api/v1/admin/trials${toQuery(params)}`));
}

export function getAdminTrial(trialId: string) {
  return data(apiClient.get<Envelope<AdminTrial>>(`/api/v1/admin/trials/${encodeURIComponent(trialId)}`));
}

export function createTrial(input: CreateTrialInput) {
  return data(apiClient.post<Envelope<AdminTrial>>("/api/v1/admin/trials", input));
}

export function updateTrial(trialId: string, input: UpdateTrialInput) {
  return data(apiClient.patch<Envelope<AdminTrial>>(`/api/v1/admin/trials/${encodeURIComponent(trialId)}`, input));
}

export function setTrialPublished(trialId: string, isPublished: boolean) {
  return data(apiClient.patch<Envelope<AdminTrial>>(`/api/v1/admin/trials/${encodeURIComponent(trialId)}/publish`, { isPublished }));
}

export function listAdminTrialInterests(params: TrialInterestListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<AdminTrialInterest>>>(`/api/v1/admin/trial-interests${toQuery(params)}`));
}

export function setTrialInterestStatus(interestId: string, status: TrialInterestStatus) {
  return data(apiClient.patch<Envelope<AdminTrialInterest>>(`/api/v1/admin/trial-interests/${encodeURIComponent(interestId)}/status`, { status }));
}
