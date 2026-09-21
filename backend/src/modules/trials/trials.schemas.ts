import { z } from "zod";

const sourceSchema = z.enum(["CTRI", "CLINICALTRIALS_GOV", "OTHER"]);
const statusSchema = z.enum(["NOT_YET_RECRUITING", "RECRUITING", "ACTIVE_NOT_RECRUITING", "COMPLETED", "UNKNOWN"]);
const interestStatusSchema = z.enum(["SUBMITTED", "CONTACTED", "CLOSED"]);
const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");

export const trialListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: statusSchema.optional(),
  isPublished: booleanQuerySchema.optional()
}).strict();

export const trialIdParamsSchema = z.object({ trialId: z.string().uuid() });
export const interestIdParamsSchema = z.object({ interestId: z.string().uuid() });

const trialFields = {
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(2000),
  description: z.string().trim().min(1).max(20000),
  source: sourceSchema,
  sourceTrialId: z.string().trim().max(200).optional().nullable(),
  sourceUrl: z.string().url().max(1000).optional().nullable(),
  sponsor: z.string().trim().max(300).optional().nullable(),
  location: z.string().trim().max(500).optional().nullable(),
  status: statusSchema,
  eligibilitySummary: z.string().trim().max(5000).optional().nullable(),
  contactInformation: z.string().trim().max(3000).optional().nullable()
};

export const createTrialSchema = z.object({ ...trialFields, isPublished: z.boolean().optional().default(false) }).strict();
export const updateTrialSchema = z.object(trialFields).partial().strict().refine((value) => Object.keys(value).length > 0, { message: "At least one trial field is required" });
export const publishTrialSchema = z.object({ isPublished: z.boolean() }).strict();
export const createInterestSchema = z.object({ notes: z.string().trim().max(2000).optional() }).strict();
export const updateInterestStatusSchema = z.object({ status: interestStatusSchema }).strict();

export type TrialListQuery = z.infer<typeof trialListQuerySchema>;
export type CreateTrialInput = z.infer<typeof createTrialSchema>;
export type UpdateTrialInput = z.infer<typeof updateTrialSchema>;
export type CreateInterestInput = z.infer<typeof createInterestSchema>;
export type UpdateInterestStatusInput = z.infer<typeof updateInterestStatusSchema>;
