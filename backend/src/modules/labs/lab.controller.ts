import type { RequestHandler } from "express";

import {
  addOpsNote as addOpsNoteService,
  createLabBooking,
  getAdminBooking,
  getAdminDsaBooking,
  getLabReport,
  getLabTest,
  getPatientBooking,
  listAdminBookings,
  listLabTests,
  listPatientBookings,
  listPendingDsaBookings,
  recordDsaBooking,
  recordExternalBooking,
  updateAdminBookingStatus,
  uploadLabReport
} from "./lab.service";
import type { AddLabOpsNoteInput, AdminLabListQuery, BookLabBookingInput, CreateLabBookingInput, LabListQuery, UpdateLabStatusInput } from "./lab.schemas";

export const listTests: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listLabTests(request.query as unknown as LabListQuery) }); } catch (error) { next(error); } };
export const getTest: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getLabTest(request.params.testId as string) }); } catch (error) { next(error); } };
export const createBooking: RequestHandler = async (request, response, next) => { try { response.status(201).json({ success: true, data: await createLabBooking(request.user?.userId as string, request.body as CreateLabBookingInput) }); } catch (error) { next(error); } };
export const listBookings: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listPatientBookings(request.user?.userId as string) }); } catch (error) { next(error); } };
export const getBooking: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getPatientBooking(request.user?.userId as string, request.params.bookingId as string) }); } catch (error) { next(error); } };
export const getPatientReport: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getLabReport(request.user?.userId as string, request.params.bookingId as string, false) }); } catch (error) { next(error); } };
export const listAdmin: RequestHandler = async (request, response, next) => {
  try {
    const query = request.query as unknown as AdminLabListQuery;
    response.status(200).json({ success: true, data: await listAdminBookings({ status: query.status, preferredDate: query.preferredDate, dsaQueue: query.dsaQueue === "true" }) });
  } catch (error) { next(error); }
};
export const listDsaQueue: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listPendingDsaBookings() }); } catch (error) { next(error); } };
export const getDsaBooking: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getAdminDsaBooking(request.params.bookingId as string) }); } catch (error) { next(error); } };
export const recordDsa: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await recordDsaBooking(request.params.bookingId as string, request.body as BookLabBookingInput) }); } catch (error) { next(error); } };
export const addOpsNote: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await addOpsNoteService(request.params.bookingId as string, (request.body as AddLabOpsNoteInput).note) }); } catch (error) { next(error); } };
export const getAdmin: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getAdminBooking(request.params.bookingId as string) }); } catch (error) { next(error); } };
export const getAdminReport: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getLabReport(request.user?.userId as string, request.params.bookingId as string, true) }); } catch (error) { next(error); } };
export const bookAdmin: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await recordExternalBooking(request.params.bookingId as string, request.body as BookLabBookingInput) }); } catch (error) { next(error); } };
export const updateStatus: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await updateAdminBookingStatus(request.params.bookingId as string, request.body as UpdateLabStatusInput) }); } catch (error) { next(error); } };
export const uploadReport: RequestHandler = async (request, response, next) => { try { response.status(201).json({ success: true, data: await uploadLabReport(request.params.bookingId as string, request.file) }); } catch (error) { next(error); } };
