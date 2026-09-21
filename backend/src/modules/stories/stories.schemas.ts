import { z } from "zod";

const statusSchema = z.enum(["DRAFT", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");

export const storyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: statusSchema.optional(),
  isPublished: booleanQuerySchema.optional()
}).strict();

export const storyIdParamsSchema = z.object({ storyId: z.string().uuid() });
export const createStorySchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  story: z.string().trim().min(1).max(20000),
  consentGiven: z.boolean(),
  consentTextVersion: z.string().trim().min(1).max(100).optional(),
  status: statusSchema.optional().default("DRAFT"),
  isPublished: z.boolean().optional().default(false)
}).strict();
export const updateStorySchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  story: z.string().trim().min(1).max(20000).optional(),
  consentGiven: z.boolean().optional(),
  consentTextVersion: z.string().trim().min(1).max(100).optional().nullable()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "At least one story field is required" });
export const updateStoryStatusSchema = z.object({ status: statusSchema }).strict();
export const publishStorySchema = z.object({ isPublished: z.boolean() }).strict();

export type StoryListQuery = z.infer<typeof storyListQuerySchema>;
export type CreateStoryInput = z.infer<typeof createStorySchema>;
export type UpdateStoryInput = z.infer<typeof updateStorySchema>;
export type UpdateStoryStatusInput = z.infer<typeof updateStoryStatusSchema>;
