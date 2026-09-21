import { Router } from "express";

import { validateRequest } from "../../../middleware/validate-request";
import { getCategories, getProductById, getProducts } from "./catalog.controller";
import { productListQuerySchema, productParamsSchema } from "./catalog.schemas";

export const catalogRouter = Router();

catalogRouter.get("/categories", getCategories);
catalogRouter.get(
  "/products",
  validateRequest({ query: productListQuerySchema }),
  getProducts
);
catalogRouter.get(
  "/products/:productId",
  validateRequest({ params: productParamsSchema }),
  getProductById
);