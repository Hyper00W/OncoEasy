import { z } from "zod";

const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");

export const productListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(200).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    prescriptionRequired: booleanQuerySchema.optional(),
    coldChainRequired: booleanQuerySchema.optional()
  })
  .strict();

export const productParamsSchema = z.object({
  productId: z.string().uuid()
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;