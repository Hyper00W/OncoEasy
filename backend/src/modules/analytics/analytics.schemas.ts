import { z } from "zod";

const dateTimeQuery = z.string().datetime({ offset: true });

export const analyticsDateRangeSchema = z.object({
  from: dateTimeQuery.optional(),
  to: dateTimeQuery.optional()
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, { message: "from must be before to" });

export const analyticsEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  eventName: z.string().trim().max(100).optional(),
  from: dateTimeQuery.optional(),
  to: dateTimeQuery.optional()
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, { message: "from must be before to" });

export type AnalyticsDateRange = z.infer<typeof analyticsDateRangeSchema>;
export type AnalyticsEventsQuery = z.infer<typeof analyticsEventsQuerySchema>;