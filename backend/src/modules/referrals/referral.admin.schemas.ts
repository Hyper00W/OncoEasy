import { z } from "zod";

export const adminReferralListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["SENT", "VIEWED", "ORDERED", "FULFILLED"]).optional()
}).strict();

export type AdminReferralListQuery = z.infer<typeof adminReferralListQuerySchema>;