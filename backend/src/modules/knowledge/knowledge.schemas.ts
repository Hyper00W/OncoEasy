import { z } from "zod";

const categorySchema = z.enum(["DISEASE", "TREATMENT", "RESEARCH", "GENERAL"]);
const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");

export const knowledgeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: categorySchema.optional(),
  search: z.string().trim().max(200).optional(),
  isPublished: booleanQuerySchema.optional()
}).strict();

export const knowledgeSlugParamsSchema = z.object({ slug: z.string().trim().min(1).max(200) });
export const knowledgeIdParamsSchema = z.object({ articleId: z.string().uuid() });

export const createKnowledgeArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must contain lowercase letters, numbers, and hyphens"),
  category: categorySchema,
  summary: z.string().trim().min(1).max(1000),
  content: z.string().trim().min(1).max(20000),
  isPublished: z.boolean().optional().default(false)
}).strict();

export const updateKnowledgeArticleSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must contain lowercase letters, numbers, and hyphens").optional(),
  category: categorySchema.optional(),
  summary: z.string().trim().min(1).max(1000).optional(),
  content: z.string().trim().min(1).max(20000).optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one article field is required" });

export const publishKnowledgeArticleSchema = z.object({ isPublished: z.boolean() }).strict();

export type KnowledgeListQuery = z.infer<typeof knowledgeListQuerySchema>;
export type CreateKnowledgeArticleInput = z.infer<typeof createKnowledgeArticleSchema>;
export type UpdateKnowledgeArticleInput = z.infer<typeof updateKnowledgeArticleSchema>;
export type PublishKnowledgeArticleInput = z.infer<typeof publishKnowledgeArticleSchema>;
