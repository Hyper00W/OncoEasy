import { z } from "zod";

export const prescriptionUploadBodySchema = z
  .object({
    notes: z.string().trim().max(2000).optional()
  })
  .strict();

export const prescriptionListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict();

export const prescriptionParamsSchema = z.object({
  prescriptionId: z.string().uuid()
});

export const prescriptionReviewReasonSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000)
  })
  .strict();

export type PrescriptionListQuery = z.infer<typeof prescriptionListQuerySchema>;
export type PrescriptionUploadBody = z.infer<typeof prescriptionUploadBodySchema>;