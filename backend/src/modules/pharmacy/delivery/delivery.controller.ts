import type { RequestHandler } from "express";

import {
  setPatientDeliveryPincode,
  validatePatientDelivery
} from "./delivery.service";
import type { DeliveryPincodeInput } from "./delivery.schemas";

export const updateDeliveryPincode: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await setPatientDeliveryPincode(
        request.user?.userId as string,
        request.params.orderId as string,
        (request.body as DeliveryPincodeInput).pincode
      )
    });
  } catch (error) {
    next(error);
  }
};

export const validateDelivery: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await validatePatientDelivery(
        request.user?.userId as string,
        request.params.orderId as string
      )
    });
  } catch (error) {
    next(error);
  }
};