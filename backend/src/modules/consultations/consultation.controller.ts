import type { RequestHandler } from "express";

import {
  bookAppointment,
  cancelDoctorAppointment,
  cancelPatientAppointment,
  completeDoctorAppointment,
  confirmDoctorAppointment,
  createDoctorAvailability,
  deactivateDoctorAvailability,
  getAdminAppointment,
  getDoctorAppointment,
  getPatientAppointment,
  listAvailableDoctors,
  listAdminAppointments,
  listDoctorAppointments,
  listDoctorAvailability,
  listOwnAvailability,
  listPatientAppointments
} from "./consultation.service";
import type { AdminAppointmentListQuery, AvailabilityCreateInput, BookAppointmentInput, CancellationInput } from "./consultation.schemas";

export const listDoctors: RequestHandler = async (_request, response, next) => {
  try { response.status(200).json({ success: true, data: await listAvailableDoctors() }); } catch (error) { next(error); }
};

export const listAvailability: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listDoctorAvailability(request.params.doctorId as string) }); } catch (error) { next(error); }
};

export const book: RequestHandler = async (request, response, next) => {
  try { response.status(201).json({ success: true, data: await bookAppointment(request.user?.userId as string, request.body as BookAppointmentInput) }); } catch (error) { next(error); }
};

export const listPatient: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listPatientAppointments(request.user?.userId as string) }); } catch (error) { next(error); }
};

export const getPatient: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getPatientAppointment(request.user?.userId as string, request.params.appointmentId as string) }); } catch (error) { next(error); }
};

export const cancelPatient: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await cancelPatientAppointment(request.user?.userId as string, request.params.appointmentId as string, request.body as CancellationInput) }); } catch (error) { next(error); }
};

export const createAvailability: RequestHandler = async (request, response, next) => {
  try { response.status(201).json({ success: true, data: await createDoctorAvailability(request.user?.userId as string, request.body as AvailabilityCreateInput) }); } catch (error) { next(error); }
};

export const listOwnSlots: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listOwnAvailability(request.user?.userId as string) }); } catch (error) { next(error); }
};

export const deactivateAvailability: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await deactivateDoctorAvailability(request.user?.userId as string, request.params.availabilityId as string) }); } catch (error) { next(error); }
};

export const listDoctor: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listDoctorAppointments(request.user?.userId as string) }); } catch (error) { next(error); }
};

export const getDoctor: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getDoctorAppointment(request.user?.userId as string, request.params.appointmentId as string) }); } catch (error) { next(error); }
};

export const listAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listAdminAppointments(request.query as unknown as AdminAppointmentListQuery) }); } catch (error) { next(error); }
};

export const getAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getAdminAppointment(request.params.appointmentId as string) }); } catch (error) { next(error); }
};

export const confirm: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await confirmDoctorAppointment(request.user?.userId as string, request.params.appointmentId as string) }); } catch (error) { next(error); }
};

export const complete: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await completeDoctorAppointment(request.user?.userId as string, request.params.appointmentId as string) }); } catch (error) { next(error); }
};

export const cancelDoctor: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await cancelDoctorAppointment(request.user?.userId as string, request.params.appointmentId as string, request.body as CancellationInput) }); } catch (error) { next(error); }
};
