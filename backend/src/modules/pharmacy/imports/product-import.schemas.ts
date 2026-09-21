import { z } from "zod";

export const productImportListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict();

export const productImportParamsSchema = z.object({
  importJobId: z.string().uuid()
});

export type ProductImportListQuery = z.infer<typeof productImportListQuerySchema>;