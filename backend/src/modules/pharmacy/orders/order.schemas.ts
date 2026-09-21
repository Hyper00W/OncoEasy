import { z } from "zod";

export const createOrderBodySchema = z
  .object({
    prescriptionId: z.string().uuid().optional(),
    referralToken: z.string().trim().min(32).max(128).optional(),
    deliveryPincode: z.string().trim().regex(/^\d{4,10}$/).optional()
  })
  .strict();

export const orderParamsSchema = z.object({
  orderId: z.string().uuid()
});

export const adminOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["DRAFT", "PENDING_PRESCRIPTION", "PENDING_PHARMACIST_REVIEW", "PENDING_PAYMENT", "PAID", "PROCESSING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "SHIPPED", "DELIVERED", "CANCELLED"]).optional()
}).strict();

export type CreateOrderInput = z.infer<typeof createOrderBodySchema>;
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;