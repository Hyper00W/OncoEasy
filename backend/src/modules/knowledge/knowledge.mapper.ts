type KnowledgeArticleRecord = {
  id: string;
  title: string;
  slug: string;
  category: string;
  summary: string;
  content: string;
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { id: string; fullName: string };
  updatedBy?: { id: string; fullName: string } | null;
};

export function toKnowledgeArticleSummary(article: KnowledgeArticleRecord) {
  return {
    articleId: article.id,
    title: article.title,
    slug: article.slug,
    category: article.category,
    summary: article.summary,
    isPublished: article.isPublished,
    publishedAt: article.publishedAt?.toISOString() ?? null,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString()
  };
}

export function toKnowledgeArticleResponse(article: KnowledgeArticleRecord, includeAudit = false) {
  return {
    ...toKnowledgeArticleSummary(article),
    content: article.content,
    ...(includeAudit ? {
      createdBy: article.createdBy ? { userId: article.createdBy.id, fullName: article.createdBy.fullName } : null,
      updatedBy: article.updatedBy ? { userId: article.updatedBy.id, fullName: article.updatedBy.fullName } : null
    } : {})
  };
}
