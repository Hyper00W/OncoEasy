import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import {
  appointmentParamsSchema,
  adminAppointmentListQuerySchema,
  availabilityCreateSchema,
  availabilityParamsSchema,
  bookAppointmentSchema,
  cancellationSchema,
  doctorParamsSchema
} from "./consultation.schemas";
import {
  book,
  cancelDoctor,
  cancelPatient,
  complete,
  confirm,
  createAvailability,
  deactivateAvailability,
  getDoctor,
  getAdmin,
  getPatient,
  listAvailability,
  listAdmin,
  listDoctor,
  listDoctors,
  listOwnSlots,
  listPatient
} from "./consultation.controller";

export const consultationRouter = Router();

consultationRouter.get("/doctors", authenticate, requireRole(UserRole.PATIENT), listDoctors);
consultationRouter.get(
  "/doctors/:doctorId/availability",
  authenticate,
  requireRole(UserRole.PATIENT),
  validateRequest({ params: doctorParamsSchema }),
  listAvailability
);
consultationRouter.post(
  "/appointments",
  authenticate,
  requireRole(UserRole.PATIENT),
  validateRequest({ body: bookAppointmentSchema }),
  book
);
consultationRouter.get("/appointments", authenticate, requireRole(UserRole.PATIENT), listPatient);
consultationRouter.get(
  "/appointments/:appointmentId",
  authenticate,
  requireRole(UserRole.PATIENT),
  validateRequest({ params: appointmentParamsSchema }),
  getPatient
);
consultationRouter.patch(
  "/appointments/:appointmentId/cancel",
  authenticate,
  requireRole(UserRole.PATIENT),
  validateRequest({ params: appointmentParamsSchema, body: cancellationSchema }),
  cancelPatient
);

consultationRouter.post(
  "/doctor/availability",
  authenticate,
  requireRole(UserRole.DOCTOR),
  validateRequest({ body: availabilityCreateSchema }),
  createAvailability
);
consultationRouter.get("/doctor/availability", authenticate, requireRole(UserRole.DOCTOR), listOwnSlots);
consultationRouter.patch(
  "/doctor/availability/:availabilityId/deactivate",
  authenticate,
  requireRole(UserRole.DOCTOR),
  validateRequest({ params: availabilityParamsSchema }),
  deactivateAvailability
);
consultationRouter.get("/doctor/appointments", authenticate, requireRole(UserRole.DOCTOR), listDoctor);
consultationRouter.get(
  "/doctor/appointments/:appointmentId",
  authenticate,
  requireRole(UserRole.DOCTOR),
  validateRequest({ params: appointmentParamsSchema }),
  getDoctor
);
consultationRouter.patch(
  "/doctor/appointments/:appointmentId/confirm",
  authenticate,
  requireRole(UserRole.DOCTOR),
  validateRequest({ params: appointmentParamsSchema }),
  confirm
);
consultationRouter.patch(
  "/doctor/appointments/:appointmentId/complete",
  authenticate,
  requireRole(UserRole.DOCTOR),
  validateRequest({ params: appointmentParamsSchema }),
  complete
);
consultationRouter.patch(
  "/doctor/appointments/:appointmentId/cancel",
  authenticate,
  requireRole(UserRole.DOCTOR),
  validateRequest({ params: appointmentParamsSchema, body: cancellationSchema }),
  cancelDoctor
);

export const adminConsultationRouter = Router();
adminConsultationRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN, UserRole.OWNER));
adminConsultationRouter.get("/appointments", validateRequest({ query: adminAppointmentListQuerySchema }), listAdmin);
adminConsultationRouter.get("/appointments/:appointmentId", validateRequest({ params: appointmentParamsSchema }), getAdmin);
