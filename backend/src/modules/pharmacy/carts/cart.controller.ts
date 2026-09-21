import type { RequestHandler } from "express";

import {
  addCartItem,
  clearActiveCart,
  getActiveCart,
  removeCartItem,
  updateCartItem
} from "./cart.service";
import type { CartItemInput, CartItemQuantityInput } from "./cart.schemas";

function patientId(request: Parameters<RequestHandler>[0]) {
  return request.user?.userId as string;
}

export const getCart: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await getActiveCart(patientId(request)) });
  } catch (error) {
    next(error);
  }
};

export const addItem: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await addCartItem(patientId(request), request.body as CartItemInput)
    });
  } catch (error) {
    next(error);
  }
};

export const updateItem: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await updateCartItem(
        patientId(request),
        request.params.productId as string,
        request.body as CartItemQuantityInput
      )
    });
  } catch (error) {
    next(error);
  }
};

export const removeItem: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await removeCartItem(patientId(request), request.params.productId as string)
    });
  } catch (error) {
    next(error);
  }
};

export const clearCart: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await clearActiveCart(patientId(request))
    });
  } catch (error) {
    next(error);
  }
};