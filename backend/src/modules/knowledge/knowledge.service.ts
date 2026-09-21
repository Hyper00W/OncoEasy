import { KnowledgeArticleCategory, Prisma, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { toKnowledgeArticleResponse, toKnowledgeArticleSummary } from "./knowledge.mapper";
import type { CreateKnowledgeArticleInput, KnowledgeListQuery, UpdateKnowledgeArticleInput } from "./knowledge.schemas";
import { recordAnalyticsEvent } from "../analytics/analytics.events";

const publicSelect = {
  id: true,
  title: true,
  slug: true,
  category: true,
  summary: true,
  content: true,
  isPublished: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true
} as const;

const adminInclude = {
  createdBy: { select: { id: true, fullName: true } },
  updatedBy: { select: { id: true, fullName: true } }
} as const;

export async function listPublishedArticles(query: KnowledgeListQuery) {
  const where = {
    isPublished: true,
    ...(query.category ? { category: query.category as KnowledgeArticleCategory } : {}),
    ...(query.search ? {
      OR: [
        { title: { contains: query.search, mode: "insensitive" as const } },
        { summary: { contains: query.search, mode: "insensitive" as const } },
        { content: { contains: query.search, mode: "insensitive" as const } }
      ]
    } : {})
  };
  return listArticles(where, query, false);
}

export async function getPublishedArticle(slug: string) {
  const article = await prisma.knowledgeArticle.findFirst({ where: { slug, isPublished: true }, select: publicSelect });
  if (!article) throw new AppError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Knowledge article was not found");
  await recordAnalyticsEvent(prisma, "KNOWLEDGE_ARTICLE_VIEWED", { entityType: "KNOWLEDGE_ARTICLE", entityId: article.id });
  return toKnowledgeArticleResponse(article);
}

export async function listAdminArticles(query: KnowledgeListQuery) {
  const where = {
    ...(query.isPublished === undefined ? {} : { isPublished: query.isPublished }),
    ...(query.category ? { category: query.category as KnowledgeArticleCategory } : {}),
    ...(query.search ? {
      OR: [
        { title: { contains: query.search, mode: "insensitive" as const } },
        { summary: { contains: query.search, mode: "insensitive" as const } },
        { content: { contains: query.search, mode: "insensitive" as const } }
      ]
    } : {})
  };
  return listArticles(where, query, true);
}

export async function createArticle(adminId: string, input: CreateKnowledgeArticleInput) {
  await assertAdmin(adminId);
  try {
    const article = await prisma.knowledgeArticle.create({
      data: {
        title: input.title,
        slug: input.slug,
        category: input.category,
        summary: input.summary,
        content: input.content,
        isPublished: input.isPublished,
        publishedAt: input.isPublished ? new Date() : null,
        createdById: adminId,
        updatedById: adminId
      },
      include: adminInclude
    });
    return toKnowledgeArticleResponse(article, true);
  } catch (error) {
    throw mapArticleWriteError(error);
  }
}

export async function updateArticle(adminId: string, articleId: string, input: UpdateKnowledgeArticleInput) {
  await assertAdmin(adminId);
  try {
    const article = await prisma.knowledgeArticle.update({
      where: { id: articleId },
      data: { ...input, updatedById: adminId },
      include: adminInclude
    });
    return toKnowledgeArticleResponse(article, true);
  } catch (error) {
    if (isNotFoundError(error)) throw new AppError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Knowledge article was not found");
    throw mapArticleWriteError(error);
  }
}

export async function setArticlePublished(adminId: string, articleId: string, isPublished: boolean) {
  await assertAdmin(adminId);
  try {
    const article = await prisma.knowledgeArticle.update({
      where: { id: articleId },
      data: { isPublished, publishedAt: isPublished ? new Date() : null, updatedById: adminId },
      include: adminInclude
    });
    return toKnowledgeArticleResponse(article, true);
  } catch (error) {
    if (isNotFoundError(error)) throw new AppError(404, "KNOWLEDGE_ARTICLE_NOT_FOUND", "Knowledge article was not found");
    throw error;
  }
}

async function listArticles(where: Prisma.KnowledgeArticleWhereInput, query: KnowledgeListQuery, includeAudit: boolean) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, articles] = await prisma.$transaction([
    prisma.knowledgeArticle.count({ where }),
    includeAudit
      ? prisma.knowledgeArticle.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, include: adminInclude })
      : prisma.knowledgeArticle.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, select: publicSelect })
  ]);

  return {
    items: articles.map((article) => includeAudit ? toKnowledgeArticleResponse(article, true) : toKnowledgeArticleSummary(article)),
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) }
  };
}

async function assertAdmin(adminId: string) {
  const admin = await prisma.user.findFirst({ where: { id: adminId, role: UserRole.OPS_ADMIN, isActive: true }, select: { id: true } });
  if (!admin) throw new AppError(403, "ADMIN_NOT_AUTHORIZED", "Admin access is not authorized");
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function mapArticleWriteError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new AppError(409, "KNOWLEDGE_ARTICLE_SLUG_CONFLICT", "An article with this slug already exists");
  }
  return new AppError(500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred");
}
