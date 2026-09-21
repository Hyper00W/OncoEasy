import { z } from "zod";

export const papProgramParamsSchema = z.object({ programId: z.string().uuid() });
export const papApplicationParamsSchema = z.object({ applicationId: z.string().uuid() });
export const papDocumentParamsSchema = z.object({
  applicationId: z.string().uuid(),
  documentId: z.string().uuid()
});

export const papApplicationDataSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  address: z.string().trim().min(5).max(500),
  diagnosisSummary: z.string().trim().min(2).max(2000),
  householdIncome: z.string().trim().min(1).max(100),
  financialNeed: z.string().trim().min(2).max(2000)
}).strict();

export const createPapApplicationSchema = z.object({
  papProgramId: z.string().uuid(),
  applicationData: papApplicationDataSchema
}).strict();

export const papApplicationListQuerySchema = z.object({
  status: z.enum([
    "SUBMITTED",
    "UNDER_REVIEW",
    "MORE_INFORMATION_REQUIRED",
    "APPROVED",
    "REJECTED",
    "COMPLETED"
  ]).optional()
}).strict();

export const updatePapStatusSchema = z.object({
  status: z.enum([
    "SUBMITTED",
    "UNDER_REVIEW",
    "MORE_INFORMATION_REQUIRED",
    "APPROVED",
    "REJECTED",
    "COMPLETED"
  ]),
  reason: z.string().trim().max(2000).optional(),
  reviewNotes: z.string().trim().max(2000).optional()
}).strict().superRefine((value, context) => {
  if ((value.status === "REJECTED" || value.status === "MORE_INFORMATION_REQUIRED") && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for this status" });
  }
});

export type CreatePapApplicationInput = z.infer<typeof createPapApplicationSchema>;
export type PapApplicationListQuery = z.infer<typeof papApplicationListQuerySchema>;
export type UpdatePapStatusInput = z.infer<typeof updatePapStatusSchema>;
