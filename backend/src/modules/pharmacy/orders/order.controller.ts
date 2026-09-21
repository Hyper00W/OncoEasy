import type { RequestHandler } from "express";

import { createPatientOrder, getAdminOrder, getPatientOrder, listAdminOrders, listPatientOrders } from "./order.service";
import type { AdminOrderListQuery, CreateOrderInput } from "./order.schemas";

export const createOrder: RequestHandler = async (request, response, next) => {
  try {
    response.status(201).json({
      success: true,
      data: await createPatientOrder(request.user?.userId as string, request.body as CreateOrderInput)
    });
  } catch (error) {
    next(error);
  }
};

export const listOrders: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await listPatientOrders(request.user?.userId as string) });
  } catch (error) {
    next(error);
  }
};

export const getOrder: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await getPatientOrder(request.user?.userId as string, request.params.orderId as string)
    });
  } catch (error) {
    next(error);
  }
};

export const listAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listAdminOrders(request.query as unknown as AdminOrderListQuery) }); } catch (error) { next(error); }
};

export const getAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getAdminOrder(request.params.orderId as string) }); } catch (error) { next(error); }
};