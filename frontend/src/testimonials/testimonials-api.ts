import { apiAssetUrl, apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type TestimonialType = "IMAGE" | "VIDEO";

export type TestimonialMediaAccess = {
  documentName: string;
  mimeType: string | null;
  checksum: string | null;
  uploadedAt: string | null;
  /**
   * Backend media delivery path. Always the preferred source: it works with the
   * development in-memory storage (server-side streaming) and with production
   * private storage (redirect to a short-lived signed URL).
   */
  deliveryUrl: string | null;
  /** Temporary provider reference; may be null if the provider could not issue one. */
  access: {
    reference: string;
    expiresAt: string;
  } | null;
};

export type PublicTestimonial = {
  testimonialId: string;
  type: TestimonialType;
  title: string;
  description: string;
  displayName: string;
  displayOrder: number;
  published: boolean;
  media: TestimonialMediaAccess | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminTestimonial = {
  testimonialId: string;
  type: TestimonialType;
  title: string;
  description: string;
  displayName: string;
  displayOrder: number;
  published: boolean;
  publishedAt: string | null;
  media: {
    documentName: string;
    mimeType: string | null;
    checksum: string | null;
    uploadedAt: string | null;
    deliveryUrl: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type TestimonialListQuery = {
  page?: number;
  pageSize?: number;
  type?: TestimonialType;
  published?: boolean;
};

export type CreateTestimonialInput = {
  type: TestimonialType;
  title: string;
  description: string;
  displayName: string;
  displayOrder?: number;
  published?: boolean;
};

export type UpdateTestimonialInput = {
  type?: TestimonialType;
  title?: string;
  description?: string;
  displayName?: string;
  displayOrder?: number;
  published?: boolean;
};

export type Paginated<T> = {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export const testimonialTypes: TestimonialType[] = ["IMAGE", "VIDEO"];

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

/** Public listing: published testimonials only, ordered by displayOrder then createdAt. */
export function listPublicTestimonials(params: TestimonialListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<PublicTestimonial>>>(`/api/v1/testimonials${toQuery(params)}`));
}

export function listAdminTestimonials(params: TestimonialListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<AdminTestimonial>>>(`/api/v1/admin/testimonials${toQuery(params)}`));
}

export function getAdminTestimonial(testimonialId: string) {
  return data(apiClient.get<Envelope<AdminTestimonial>>(`/api/v1/admin/testimonials/${encodeURIComponent(testimonialId)}`));
}

export function createTestimonial(input: CreateTestimonialInput) {
  return data(apiClient.post<Envelope<AdminTestimonial>>("/api/v1/admin/testimonials", input));
}

export function updateTestimonial(testimonialId: string, input: UpdateTestimonialInput) {
  return data(apiClient.patch<Envelope<AdminTestimonial>>(`/api/v1/admin/testimonials/${encodeURIComponent(testimonialId)}`, input));
}

export function deleteTestimonial(testimonialId: string) {
  return data(apiClient.delete<Envelope<{ deleted: boolean }>>(`/api/v1/admin/testimonials/${encodeURIComponent(testimonialId)}`));
}

export function uploadTestimonialMedia(testimonialId: string, type: TestimonialType, file: File) {
  const form = new FormData();
  form.append("file", file);
  return data(apiClient.postForm<Envelope<AdminTestimonial>>(`/api/v1/admin/testimonials/${encodeURIComponent(testimonialId)}/media?type=${type}`, form));
}

/** Absolute URL for a backend media delivery path. */
export function testimonialMediaUrl(deliveryUrl: string | null | undefined) {
  return apiAssetUrl(deliveryUrl);
}

/**
 * Admin preview of private media (works for unpublished testimonials). Fetched
 * with the bearer token because the browser cannot attach it to <img>/<video>.
 */
export function fetchAdminTestimonialMedia(testimonialId: string) {
  return apiClient.getBlob(`/api/v1/admin/testimonials/${encodeURIComponent(testimonialId)}/media`);
}
