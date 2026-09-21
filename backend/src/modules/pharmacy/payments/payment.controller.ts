import type { RequestHandler } from "express";

import { getPatientPayment, initiatePatientPayment, verifyPatientPayment } from "./payment.service";
import type { InitiatePaymentInput, VerifyPaymentInput } from "./payment.schemas";

export const initiatePayment: RequestHandler = async (request, response, next) => {
  try {
    response.status(201).json({
      success: true,
      data: await initiatePatientPayment(
        request.user?.userId as string,
        request.params.orderId as string,
        request.body as InitiatePaymentInput
      )
    });
  } catch (error) {
    next(error);
  }
};

export const verifyPayment: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await verifyPatientPayment(
        request.user?.userId as string,
        request.params.orderId as string,
        request.body as VerifyPaymentInput
      )
    });
  } catch (error) {
    next(error);
  }
};

export const getPayment: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await getPatientPayment(
        request.user?.userId as string,
        request.params.orderId as string
      )
    });
  } catch (error) {
    next(error);
  }
};