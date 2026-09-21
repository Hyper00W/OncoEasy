import { z } from "zod";

export const initiatePaymentBodySchema = z
  .object({
    method: z.enum(["PREPAID", "COD"])
  })
  .strict();

export const paymentOrderParamsSchema = z.object({
  orderId: z.string().uuid()
});

export const verifyPaymentBodySchema = z
  .object({
    gatewayOrderId: z.string().min(1).max(255),
    gatewayPaymentId: z.string().min(1).max(255),
    gatewaySignature: z.string().min(1).max(512)
  })
  .strict();

export type InitiatePaymentInput = z.infer<typeof initiatePaymentBodySchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentBodySchema>;