import { z } from "zod";

export const deliveryParamsSchema = z.object({
  deliveryId: z.string().uuid()
});

export const adminDeliveryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "ASSIGNED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "SHIPPED", "DELIVERED", "FAILED", "CANCELLED"]).optional(),
  mode: z.enum(["LOCAL", "COURIER"]).optional()
}).strict();

export const assignDeliverySchema = z.object({
  agentId: z.string().uuid()
}).strict();

export const failDeliverySchema = z.object({
  reason: z.string().trim().min(1).max(1000)
}).strict();

export const proofTypeSchema = z.enum(["DELIVERY_PHOTO", "CASH_OVER_BILL", "ONLINE_PAYMENT"]);

export type AssignDeliveryInput = z.infer<typeof assignDeliverySchema>;
export type FailDeliveryInput = z.infer<typeof failDeliverySchema>;
export type ProofType = z.infer<typeof proofTypeSchema>;
export type AdminDeliveryListQuery = z.infer<typeof adminDeliveryListQuerySchema>;