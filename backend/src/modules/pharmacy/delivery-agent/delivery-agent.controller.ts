import type { RequestHandler } from "express";

import {
  assignLocalDelivery,
  getAdminDelivery,
  getAssignedDelivery,
  listAdminDeliveries,
  listAssignedDeliveries,
  markDelivered,
  markFailed,
  markOutForDelivery,
  uploadDeliveryProof
} from "./delivery-agent.service";
import { proofTypeSchema, type AdminDeliveryListQuery } from "./delivery-agent.schemas";

export const assignDelivery: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await assignLocalDelivery(request.params.deliveryId as string, request.body) });
  } catch (error) { next(error); }
};

export const listAssigned: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await listAssignedDeliveries(request.user?.userId as string) });
  } catch (error) { next(error); }
};

export const getAssigned: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await getAssignedDelivery(request.user?.userId as string, request.params.deliveryId as string) });
  } catch (error) { next(error); }
};

export const outForDelivery: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await markOutForDelivery(request.user?.userId as string, request.params.deliveryId as string) });
  } catch (error) { next(error); }
};

export const delivered: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await markDelivered(request.user?.userId as string, request.params.deliveryId as string) });
  } catch (error) { next(error); }
};

export const failed: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await markFailed(request.user?.userId as string, request.params.deliveryId as string, request.body) });
  } catch (error) { next(error); }
};

export const uploadProof: RequestHandler = async (request, response, next) => {
  try {
    const parsed = proofTypeSchema.safeParse(request.body.proofType);
    if (!parsed.success) {
      response.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "proofType must be DELIVERY_PHOTO, CASH_OVER_BILL, or ONLINE_PAYMENT" } });
      return;
    }
    response.status(201).json({ success: true, data: await uploadDeliveryProof(request.user?.userId as string, request.params.deliveryId as string, parsed.data, request.file) });
  } catch (error) { next(error); }
};

export const listAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listAdminDeliveries(request.query as unknown as AdminDeliveryListQuery) }); } catch (error) { next(error); }
};

export const getAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getAdminDelivery(request.params.deliveryId as string) }); } catch (error) { next(error); }
};