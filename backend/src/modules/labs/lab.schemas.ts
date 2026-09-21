import { z } from "zod";

export const labTestParamsSchema = z.object({ testId: z.string().uuid() });
export const labBookingParamsSchema = z.object({ bookingId: z.string().uuid() });

export const labListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().trim().min(1).optional()
}).strict();

export const createLabBookingSchema = z.object({
  labTestId: z.string().uuid(),
  collectionType: z.enum(["HOME", "CENTER"]),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferredTimeSlot: z.string().trim().max(100).optional(),
  patientNotes: z.string().trim().max(2000).optional(),
  addressData: z.record(z.string(), z.unknown()).optional(),
  prescriptionId: z.string().uuid().optional()
}).strict();

export const bookLabBookingSchema = z.object({
  externalOrderId: z.string().trim().min(1).max(200)
}).strict();

export const addLabOpsNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000)
}).strict();

export const adminLabListQuerySchema = z.object({
  status: z.enum(["PENDING_OPS", "BOOKED", "SAMPLE_COLLECTED", "REPORT_READY", "COMPLETED", "CANCELLED"]).optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dsaQueue: z.enum(["true"]).optional()
}).strict();

export const updateLabStatusSchema = z.object({
  status: z.enum(["PENDING_OPS", "BOOKED", "SAMPLE_COLLECTED", "REPORT_READY", "COMPLETED", "CANCELLED"]),
  reason: z.string().trim().max(1000).optional()
}).strict();

export type LabListQuery = z.infer<typeof labListQuerySchema>;
export type CreateLabBookingInput = z.infer<typeof createLabBookingSchema>;
export type BookLabBookingInput = z.infer<typeof bookLabBookingSchema>;
export type UpdateLabStatusInput = z.infer<typeof updateLabStatusSchema>;
export type AddLabOpsNoteInput = z.infer<typeof addLabOpsNoteSchema>;
export type AdminLabListQuery = z.infer<typeof adminLabListQuerySchema>;
