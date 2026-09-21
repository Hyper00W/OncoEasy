import { z } from "zod";

export const cartItemBodySchema = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1)
  })
  .strict();

export const cartItemQuantityBodySchema = z
  .object({
    quantity: z.number().int().min(1)
  })
  .strict();

export const cartItemParamsSchema = z.object({
  productId: z.string().uuid()
});

export type CartItemInput = z.infer<typeof cartItemBodySchema>;
export type CartItemQuantityInput = z.infer<typeof cartItemQuantityBodySchema>;