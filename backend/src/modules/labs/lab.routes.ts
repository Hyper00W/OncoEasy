import { UserRole, LabBookingStatus } from "@prisma/client";
import multer from "multer";
import { Router } from "express";

import { env } from "../../config/env";
import { AppError } from "../../errors/app-error";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import {
  addOpsNote,
  bookAdmin, createBooking, getAdmin, getAdminReport, getBooking, getDsaBooking, getPatientReport, getTest, listAdmin, listBookings, listDsaQueue, listTests, recordDsa, updateStatus, uploadReport
} from "./lab.controller";
import { allowedLabReportTypes } from "./lab.storage";
import { addLabOpsNoteSchema, bookLabBookingSchema, createLabBookingSchema, labBookingParamsSchema, adminLabListQuerySchema, labListQuerySchema, labTestParamsSchema, updateLabStatusSchema } from "./lab.schemas";

const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.PRESCRIPTION_MAX_FILE_SIZE_BYTES },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype in allowedLabReportTypes) callback(null, true);
    else callback(new AppError(400, "UNSUPPORTED_FILE_TYPE", "Lab reports must be PDF files"));
  }
});

function parseReportUpload(request: Parameters<typeof uploadReport>[0], response: Parameters<typeof uploadReport>[1], next: Parameters<typeof uploadReport>[2]) {
  reportUpload.single("file")(request, response, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") { next(new AppError(413, "FILE_TOO_LARGE", "Lab report is too large")); return; }
    next(error);
  });
}

export const labRouter = Router();
labRouter.get("/tests", authenticate, requireRole(UserRole.PATIENT), validateRequest({ query: labListQuerySchema }), listTests);
labRouter.get("/tests/:testId", authenticate, requireRole(UserRole.PATIENT), validateRequest({ params: labTestParamsSchema }), getTest);
labRouter.post("/bookings", authenticate, requireRole(UserRole.PATIENT), validateRequest({ body: createLabBookingSchema }), createBooking);
labRouter.get("/bookings", authenticate, requireRole(UserRole.PATIENT), listBookings);
labRouter.get("/bookings/:bookingId/report", authenticate, requireRole(UserRole.PATIENT), validateRequest({ params: labBookingParamsSchema }), getPatientReport);
labRouter.get("/bookings/:bookingId", authenticate, requireRole(UserRole.PATIENT), validateRequest({ params: labBookingParamsSchema }), getBooking);

const admin = Router();
admin.use(authenticate, requireRole(UserRole.OPS_ADMIN, UserRole.OWNER));
admin.get("/bookings", validateRequest({ query: adminLabListQuerySchema }), listAdmin);
admin.get("/dsa-queue", listDsaQueue);
admin.get("/bookings/:bookingId/dsa", validateRequest({ params: labBookingParamsSchema }), getDsaBooking);
admin.patch("/bookings/:bookingId/dsa", validateRequest({ params: labBookingParamsSchema, body: bookLabBookingSchema }), recordDsa);
admin.post("/bookings/:bookingId/ops-notes", validateRequest({ params: labBookingParamsSchema, body: addLabOpsNoteSchema }), addOpsNote);
admin.get("/bookings/:bookingId/report", validateRequest({ params: labBookingParamsSchema }), getAdminReport);
admin.get("/bookings/:bookingId", validateRequest({ params: labBookingParamsSchema }), getAdmin);
admin.patch("/bookings/:bookingId/book", validateRequest({ params: labBookingParamsSchema, body: bookLabBookingSchema }), bookAdmin);
admin.patch("/bookings/:bookingId/status", validateRequest({ params: labBookingParamsSchema, body: updateLabStatusSchema }), updateStatus);
admin.post("/bookings/:bookingId/report", validateRequest({ params: labBookingParamsSchema }), parseReportUpload, uploadReport);

export const adminLabRouter = admin;
