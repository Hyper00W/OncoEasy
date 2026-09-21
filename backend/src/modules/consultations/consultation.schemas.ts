import { z } from "zod";

export const consultationTypeSchema = z.enum(["IN_CLINIC", "PHONE"]);

export const doctorParamsSchema = z.object({
  doctorId: z.string().uuid()
});

export const appointmentParamsSchema = z.object({
  appointmentId: z.string().uuid()
});

export const adminAppointmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  doctorId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, { message: "from must be before to" });

export const availabilityParamsSchema = z.object({
  availabilityId: z.string().uuid()
});

export const bookAppointmentSchema = z.object({
  availabilityId: z.string().uuid(),
  consultationType: consultationTypeSchema,
  patientNotes: z.string().trim().max(2000).optional()
}).strict();

export const availabilityCreateSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true })
}).strict();

export const cancellationSchema = z.object({
  reason: z.string().trim().max(1000).optional()
}).strict();

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
export type AvailabilityCreateInput = z.infer<typeof availabilityCreateSchema>;
export type CancellationInput = z.infer<typeof cancellationSchema>;
export type AdminAppointmentListQuery = z.infer<typeof adminAppointmentListQuerySchema>;
