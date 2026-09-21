import type { RequestHandler } from "express";

import { createArticle, getPublishedArticle, listAdminArticles, listPublishedArticles, setArticlePublished, updateArticle } from "./knowledge.service";
import type { CreateKnowledgeArticleInput, KnowledgeListQuery, PublishKnowledgeArticleInput, UpdateKnowledgeArticleInput } from "./knowledge.schemas";

export const listPublished: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listPublishedArticles(request.query as unknown as KnowledgeListQuery) }); } catch (error) { next(error); }
};

export const getPublished: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await getPublishedArticle(request.params.slug as string) }); } catch (error) { next(error); }
};

export const listAdmin: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await listAdminArticles(request.query as unknown as KnowledgeListQuery) }); } catch (error) { next(error); }
};

export const create: RequestHandler = async (request, response, next) => {
  try { response.status(201).json({ success: true, data: await createArticle(request.user?.userId as string, request.body as CreateKnowledgeArticleInput) }); } catch (error) { next(error); }
};

export const update: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await updateArticle(request.user?.userId as string, request.params.articleId as string, request.body as UpdateKnowledgeArticleInput) }); } catch (error) { next(error); }
};

export const publish: RequestHandler = async (request, response, next) => {
  try { response.status(200).json({ success: true, data: await setArticlePublished(request.user?.userId as string, request.params.articleId as string, (request.body as PublishKnowledgeArticleInput).isPublished) }); } catch (error) { next(error); }
};
