import type { RequestHandler } from "express";

import {
  addReferralToPatientCart,
  createDoctorReferral,
  getAdminReferral,
  getDoctorReferral,
  listAdminReferrals,
  getPatientReferral,
  listDoctorReferrals
} from "./referral.service";
import type { ReferralCreateInput } from "./referral.schemas";
import type { AdminReferralListQuery } from "./referral.admin.schemas";

export const createReferral: RequestHandler = async (request, response, next) => {
  try {
    response.status(201).json({ success: true, data: await createDoctorReferral(request.user?.userId as string, request.body as ReferralCreateInput) });
  } catch (error) { next(error); }
};

export const listReferrals: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await listDoctorReferrals(request.user?.userId as string) });
  } catch (error) { next(error); }
};

export const getReferral: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await getDoctorReferral(request.user?.userId as string, request.params.referralId as string) });
  } catch (error) { next(error); }
};

export const listAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listAdminReferrals(request.query as unknown as AdminReferralListQuery) }); } catch (error) { next(error); }
};

export const getAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getAdminReferral(request.params.referralId as string) }); } catch (error) { next(error); }
};

export const getPatientReferralByToken: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await getPatientReferral(request.user?.userId as string, request.params.accessToken as string) });
  } catch (error) { next(error); }
};

export const addPatientReferralToCart: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await addReferralToPatientCart(request.user?.userId as string, request.params.accessToken as string) });
  } catch (error) { next(error); }
};
