import { z } from "zod";

export const cartItemInputSchema = z.object({
  cartId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
  unitPriceSnapshot: z.number().finite().min(0),
  productNameSnapshot: z.string().trim().min(1)
});

export const prescriptionSourceSchema = z.enum([
  "PATIENT_UPLOAD",
  "PHARMACIST_CREATED_CART",
  "DOCTOR_CALLBACK"
]);

export const prescriptionStatusSchema = z.enum([
  "UPLOADED",
  "PENDING_REVIEW",
  "QUERY",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
  "USED"
]);

export const prescriptionInputSchema = z.object({
  patientId: z.string().uuid(),
  source: prescriptionSourceSchema,
  status: prescriptionStatusSchema.default("UPLOADED"),
  documentKey: z.string().trim().min(1),
  documentName: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  checksum: z.string().trim().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdByUserId: z.string().uuid().nullable().optional(),
  reviewedByUserId: z.string().uuid().nullable().optional(),
  doctorId: z.string().uuid().nullable().optional(),
  verifiedAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional()
});

export type CartItemInput = z.infer<typeof cartItemInputSchema>;
export type PrescriptionInput = z.infer<typeof prescriptionInputSchema>;
