import { apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type ChatIntent =
  | "PHARMACY"
  | "DOCTOR_CONSULT"
  | "LABS"
  | "PAP"
  | "CARE_JOURNEY"
  | "KNOWLEDGE"
  | "CLINICAL_TRIALS"
  | "HUMAN_SUPPORT"
  | "GENERAL";

export type ChatSessionStatus = "ACTIVE" | "ESCALATED" | "CLOSED";

export type ChatMessageSender = "PATIENT" | "ROUTER";

export type ChatMessage = {
  messageId: string;
  sender: ChatMessageSender;
  content: string;
  intent: ChatIntent | null;
  createdAt: string;
};

export type ChatSession = {
  sessionId: string;
  patientId: string;
  status: ChatSessionStatus;
  intent: ChatIntent;
  escalated: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messages: ChatMessage[];
};

export type SendMessageResult = {
  detectedIntent: ChatIntent;
  response: string;
  route: string | null;
  escalated: boolean;
  session: ChatSession;
};

export type AdminSessionListQuery = {
  page?: number;
  pageSize?: number;
  escalated?: boolean;
  status?: ChatSessionStatus;
};

export type Paginated<T> = {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export const chatStatuses: ChatSessionStatus[] = ["ACTIVE", "ESCALATED", "CLOSED"];

const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

export function createChatSession() {
  return data(apiClient.post<Envelope<ChatSession>>("/api/v1/chat/sessions"));
}

export function listChatSessions() {
  return data(apiClient.get<Envelope<ChatSession[]>>("/api/v1/chat/sessions"));
}

export function getChatSession(sessionId: string) {
  return data(apiClient.get<Envelope<ChatSession>>(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}`));
}

export function sendChatMessage(sessionId: string, content: string) {
  return data(apiClient.post<Envelope<SendMessageResult>>(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`, { content }));
}

export function listAdminChatSessions(params: AdminSessionListQuery = {}) {
  const search = new URLSearchParams();
  (Object.entries(params) as Array<[string, string | number | boolean | undefined]>).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return data(apiClient.get<Envelope<Paginated<ChatSession>>>(`/api/v1/admin/chat/sessions${query ? `?${query}` : ""}`));
}

export function getAdminChatSession(sessionId: string) {
  return data(apiClient.get<Envelope<ChatSession>>(`/api/v1/admin/chat/sessions/${encodeURIComponent(sessionId)}`));
}
