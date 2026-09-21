import { apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type JourneyStageKey =
  | "DIAGNOSED"
  | "TREATMENT_PLANNING"
  | "ACTIVE_TREATMENT"
  | "FOLLOW_UP";

export type JourneyStage = {
  stage: JourneyStageKey;
  order: number;
  title: string;
  description: string;
  checklist: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type JourneyHistoryEntry = {
  fromStage: string;
  toStage: string;
  changedAt: string;
};

export type PatientJourney = {
  journeyId: string;
  currentStage: JourneyStage | null;
  currentStageKey: string;
  stages: JourneyStage[];
  checklistProgress: { completed: number; total: number };
  history: JourneyHistoryEntry[];
  updatedAt: string;
};

export type JourneyAdvanceResult = {
  journeyId: string;
  currentStage: JourneyStage;
  currentStageKey: string;
  history: JourneyHistoryEntry[];
  updatedAt: string;
};

export type JourneyContentUpdate = {
  title?: string;
  description?: string;
  checklist?: string[];
  isActive?: boolean;
};

const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

export function getJourney() {
  return data(apiClient.get<Envelope<PatientJourney>>("/api/v1/patient/journey"));
}

export function getJourneyStage(stage: JourneyStageKey) {
  return data(apiClient.get<Envelope<JourneyStage>>(`/api/v1/patient/journey/stages/${stage}`));
}

export function advanceJourney(stage: JourneyStageKey) {
  return data(apiClient.patch<Envelope<JourneyAdvanceResult>>("/api/v1/patient/journey/stage", { stage }));
}

export function listAdminJourneyStages() {
  return data(apiClient.get<Envelope<JourneyStage[]>>("/api/v1/admin/journey/stages"));
}

export function getAdminJourneyStage(stage: JourneyStageKey) {
  return data(apiClient.get<Envelope<JourneyStage>>(`/api/v1/admin/journey/stages/${stage}`));
}

export function updateAdminJourneyStage(stage: JourneyStageKey, input: JourneyContentUpdate) {
  return data(apiClient.patch<Envelope<JourneyStage>>(`/api/v1/admin/journey/stages/${stage}`, input));
}
