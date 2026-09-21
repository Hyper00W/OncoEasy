import { apiClient } from "../api/client";

type Envelope<T> = { success: true; data: T };

export type KnowledgeCategory = "DISEASE" | "TREATMENT" | "RESEARCH" | "GENERAL";

export type KnowledgeArticleSummary = {
  articleId: string;
  title: string;
  slug: string;
  category: KnowledgeCategory;
  summary: string;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeArticle = KnowledgeArticleSummary & { content: string };

export type AdminKnowledgeArticle = KnowledgeArticle & {
  createdBy: { userId: string; fullName: string } | null;
  updatedBy: { userId: string; fullName: string } | null;
};

export type Paginated<T> = {
  items: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type KnowledgeListQuery = {
  page?: number;
  pageSize?: number;
  category?: KnowledgeCategory;
  search?: string;
  isPublished?: boolean;
};

export type CreateKnowledgeArticleInput = {
  title: string;
  slug: string;
  category: KnowledgeCategory;
  summary: string;
  content: string;
  isPublished?: boolean;
};

export type UpdateKnowledgeArticleInput = {
  title?: string;
  slug?: string;
  category?: KnowledgeCategory;
  summary?: string;
  content?: string;
};

export const knowledgeCategories: KnowledgeCategory[] = ["DISEASE", "TREATMENT", "RESEARCH", "GENERAL"];

const data = <T>(request: Promise<Envelope<T>>): Promise<T> => request.then((response) => response.data);

function toQuery(params: KnowledgeListQuery): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function listPublishedArticles(params: KnowledgeListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<KnowledgeArticleSummary>>>(`/api/v1/knowledge/articles${toQuery(params)}`));
}

export function getPublishedArticle(slug: string) {
  return data(apiClient.get<Envelope<KnowledgeArticle>>(`/api/v1/knowledge/articles/${encodeURIComponent(slug)}`));
}

export function listAdminArticles(params: KnowledgeListQuery = {}) {
  return data(apiClient.get<Envelope<Paginated<AdminKnowledgeArticle>>>(`/api/v1/admin/knowledge/articles${toQuery(params)}`));
}

export function createArticle(input: CreateKnowledgeArticleInput) {
  return data(apiClient.post<Envelope<AdminKnowledgeArticle>>("/api/v1/admin/knowledge/articles", input));
}

export function updateArticle(articleId: string, input: UpdateKnowledgeArticleInput) {
  return data(apiClient.patch<Envelope<AdminKnowledgeArticle>>(`/api/v1/admin/knowledge/articles/${articleId}`, input));
}

export function setArticlePublished(articleId: string, isPublished: boolean) {
  return data(apiClient.patch<Envelope<AdminKnowledgeArticle>>(`/api/v1/admin/knowledge/articles/${articleId}/publish`, { isPublished }));
}
