import { z } from "zod";

const statusSchema = z.enum(["ACTIVE", "ESCALATED", "CLOSED"]);

export const sessionIdParamsSchema = z.object({ sessionId: z.string().uuid() }).strict();
export const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(2000)
}).strict();
export const adminSessionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  escalated: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  status: statusSchema.optional()
}).strict();

export type AdminSessionListQuery = z.infer<typeof adminSessionListQuerySchema>;