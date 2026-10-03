import { UserRole } from "@prisma/client";
import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import { create, getPublished, listAdmin, listPublished, publish, update } from "./knowledge.controller";
import { createKnowledgeArticleSchema, knowledgeIdParamsSchema, knowledgeListQuerySchema, knowledgeSlugParamsSchema, publishKnowledgeArticleSchema, updateKnowledgeArticleSchema } from "./knowledge.schemas";

export const knowledgeRouter = Router();
knowledgeRouter.use(authenticate, requireRole(UserRole.PATIENT));
knowledgeRouter.get("/articles", validateRequest({ query: knowledgeListQuerySchema }), listPublished);
knowledgeRouter.get("/articles/:slug", validateRequest({ params: knowledgeSlugParamsSchema }), getPublished);

export const adminKnowledgeRouter = Router();
adminKnowledgeRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN, UserRole.OWNER));
adminKnowledgeRouter.get("/articles", validateRequest({ query: knowledgeListQuerySchema }), listAdmin);
adminKnowledgeRouter.post("/articles", validateRequest({ body: createKnowledgeArticleSchema }), create);
adminKnowledgeRouter.patch("/articles/:articleId", validateRequest({ params: knowledgeIdParamsSchema, body: updateKnowledgeArticleSchema }), update);
adminKnowledgeRouter.patch("/articles/:articleId/publish", validateRequest({ params: knowledgeIdParamsSchema, body: publishKnowledgeArticleSchema }), publish);
