import type { RequestHandler } from "express";

import {
  createPatientApplication,
  getActiveProgram,
  getAdminApplication,
  getApplicationDocument,
  getPatientApplication,
  listActivePrograms,
  listAdminApplications,
  listPatientApplications,
  updateApplicationStatus,
  uploadPatientDocument
} from "./pap.service";
import type { CreatePapApplicationInput, PapApplicationListQuery, UpdatePapStatusInput } from "./pap.schemas";

export const listPrograms: RequestHandler = async (_request, response, next) => {
  try { response.status(200).json({ success: true, data: await listActivePrograms() }); } catch (error) { next(error); }
};

export const getProgram: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getActiveProgram(request.params.programId as string) }); } catch (error) { next(error); }
};

export const createApplication: RequestHandler = async (request, response, next) => {
  try { response.status(201).json({ success: true, data: await createPatientApplication(request.user?.userId as string, request.body as CreatePapApplicationInput) }); } catch (error) { next(error); }
};

export const listApplications: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listPatientApplications(request.user?.userId as string) }); } catch (error) { next(error); }
};

export const getApplication: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getPatientApplication(request.user?.userId as string, request.params.applicationId as string) }); } catch (error) { next(error); }
};

export const uploadDocument: RequestHandler = async (request, response, next) => {
  try { response.status(201).json({ success: true, data: await uploadPatientDocument(request.user?.userId as string, request.params.applicationId as string, request.file) }); } catch (error) { next(error); }
};

export const listAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listAdminApplications(request.query as unknown as PapApplicationListQuery) }); } catch (error) { next(error); }
};

export const getAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getAdminApplication(request.params.applicationId as string) }); } catch (error) { next(error); }
};

export const updateStatus: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await updateApplicationStatus(request.params.applicationId as string, request.user?.userId as string, request.body as UpdatePapStatusInput) }); } catch (error) { next(error); }
};

export const getDocument: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getApplicationDocument(request.params.applicationId as string, request.params.documentId as string) }); } catch (error) { next(error); }
};
