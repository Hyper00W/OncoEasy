import type { RequestHandler } from "express";

import { getProduct, listCategories, listProducts } from "./catalog.service";
import type { ProductListQuery } from "./catalog.schemas";

export const getCategories: RequestHandler = async (_request, response, next) => {
  try {
    response.status(200).json({ success: true, data: await listCategories() });
  } catch (error) {
    next(error);
  }
};

export const getProducts: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await listProducts(request.query as unknown as ProductListQuery)
    });
  } catch (error) {
    next(error);
  }
};

export const getProductById: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json({
      success: true,
      data: await getProduct(request.params.productId as string)
    });
  } catch (error) {
    next(error);
  }
};