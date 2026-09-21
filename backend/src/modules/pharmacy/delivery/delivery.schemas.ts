import { z } from "zod";

export const deliveryPincodeSchema = z
  .object({
    pincode: z.string().trim().regex(/^\d{6}$/)
  })
  .strict();

export const deliveryOrderParamsSchema = z.object({
  orderId: z.string().uuid()
});

export type DeliveryPincodeInput = z.infer<typeof deliveryPincodeSchema>;