import { apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type StoryPhotoMetadata = {
  documentName: string;
  mimeType: string | null;
};

export type StoryPhotoAccess = StoryPhotoMetadata & {
  access: {
    reference: string;
    expiresAt: string;
  };
};

export type PublishedStory = {
  storyId: string;
  displayName: string;
  story: string;
  photo: StoryPhotoAccess | null;
  publishedAt: string | null;
};

export type AdminStory = {
  storyId: string;
  displayName: string;
  story: string;
  photo: StoryPhotoMetadata | null;
  consentGiven: boolean;
  consentTextVersion: string | null;
  status: StoryStatus;
  isPublished: boolean;
  publishedAt: string | null;
  createdBy: { userId: string; fullName: string } | null;
  updatedBy: { userId: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type StoryStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

export type StoryListQuery = {
  page?: number;
  pageSize?: number;
  status?: StoryStatus;
  isPublished?: boolean;
};

export type CreateStoryInput = {
  displayName: string;
  story: string;
  consentGiven: boolean;
  consentTextVersion?: string;
  status?: StoryStatus;
  isPublished?: boolean;
};

export type UpdateStoryInput = {
  displayName?: string;
  story?: string;
  consentGiven?: boolean;
  consentTextVersion?: string | null;
};

export type Paginated<T> = {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export const storyStatuses: StoryStatus[] = ["DRAFT", "UNDER_REVIEW", "APPROVED", "REJECTED"];

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

export function listPublishedStories(params: StoryListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<PublishedStory>>>(`/api/v1/stories${toQuery(params)}`));
}

export function getPublishedStory(storyId: string) {
  return data(apiClient.get<Envelope<PublishedStory>>(`/api/v1/stories/${encodeURIComponent(storyId)}`));
}

export function listAdminStories(params: StoryListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<AdminStory>>>(`/api/v1/admin/stories${toQuery(params)}`));
}

export function getAdminStory(storyId: string) {
  return data(apiClient.get<Envelope<AdminStory>>(`/api/v1/admin/stories/${encodeURIComponent(storyId)}`));
}

export function createStory(input: CreateStoryInput) {
  return data(apiClient.post<Envelope<AdminStory>>("/api/v1/admin/stories", input));
}

export function updateStory(storyId: string, input: UpdateStoryInput) {
  return data(apiClient.patch<Envelope<AdminStory>>(`/api/v1/admin/stories/${encodeURIComponent(storyId)}`, input));
}

export function updateStoryStatus(storyId: string, status: StoryStatus) {
  return data(apiClient.patch<Envelope<AdminStory>>(`/api/v1/admin/stories/${encodeURIComponent(storyId)}/status`, { status }));
}

export function setStoryPublished(storyId: string, isPublished: boolean) {
  return data(apiClient.patch<Envelope<AdminStory>>(`/api/v1/admin/stories/${encodeURIComponent(storyId)}/publish`, { isPublished }));
}

export function uploadStoryPhoto(storyId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return data(apiClient.postForm<Envelope<AdminStory>>(`/api/v1/admin/stories/${encodeURIComponent(storyId)}/photo`, form));
}
