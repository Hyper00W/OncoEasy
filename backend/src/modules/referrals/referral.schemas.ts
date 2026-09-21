import { z } from "zod";

export const referralCreateSchema = z.object({
  patientId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1)
  }).strict()).min(1).max(100)
}).strict();

export const referralIdParamsSchema = z.object({
  referralId: z.string().uuid()
});

export const referralTokenParamsSchema = z.object({
  accessToken: z.string().trim().min(32).max(128)
});

export type ReferralCreateInput = z.infer<typeof referralCreateSchema>;
