import type { RequestHandler } from "express";

import { addPatientMessage, createSession, getAdminSession, getPatientSession, listAdminSessions, listPatientSessions } from "./chat.service";
import type { AdminSessionListQuery } from "./chat.schemas";

export const create: RequestHandler = async (request, response, next) => { try { response.status(201).json({ success: true, data: await createSession(request.user?.userId as string) }); } catch (error) { next(error); } };
export const list: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listPatientSessions(request.user?.userId as string) }); } catch (error) { next(error); } };
export const get: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getPatientSession(request.user?.userId as string, request.params.sessionId as string) }); } catch (error) { next(error); } };
export const message: RequestHandler = async (request, response, next) => { try { response.status(201).json({ success: true, data: await addPatientMessage(request.user?.userId as string, request.params.sessionId as string, request.body.content as string) }); } catch (error) { next(error); } };
export const adminList: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listAdminSessions(request.query as unknown as AdminSessionListQuery) }); } catch (error) { next(error); } };
export const adminGet: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getAdminSession(request.params.sessionId as string) }); } catch (error) { next(error); } };