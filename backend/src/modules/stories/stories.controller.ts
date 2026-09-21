import type { RequestHandler } from "express";

import { createStory, getAdminStory, getPublishedStory, listAdminStories, listPublishedStories, publishStory, updateStory, updateStoryStatus, uploadStoryPhoto } from "./stories.service";
import type { CreateStoryInput, StoryListQuery, UpdateStoryInput, UpdateStoryStatusInput } from "./stories.schemas";

export const listPublished: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listPublishedStories(request.query as unknown as StoryListQuery) }); } catch (error) { next(error); } };
export const getPublished: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getPublishedStory(request.params.storyId as string) }); } catch (error) { next(error); } };
export const listAdmin: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await listAdminStories(request.query as unknown as StoryListQuery) }); } catch (error) { next(error); } };
export const getAdmin: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await getAdminStory(request.params.storyId as string) }); } catch (error) { next(error); } };
export const create: RequestHandler = async (request, response, next) => { try { response.status(201).json({ success: true, data: await createStory(request.user?.userId as string, request.body as CreateStoryInput) }); } catch (error) { next(error); } };
export const update: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await updateStory(request.user?.userId as string, request.params.storyId as string, request.body as UpdateStoryInput) }); } catch (error) { next(error); } };
export const status: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await updateStoryStatus(request.user?.userId as string, request.params.storyId as string, request.body as UpdateStoryStatusInput) }); } catch (error) { next(error); } };
export const publish: RequestHandler = async (request, response, next) => { try { response.status(200).json({ success: true, data: await publishStory(request.user?.userId as string, request.params.storyId as string, request.body.isPublished) }); } catch (error) { next(error); } };
export const uploadPhoto: RequestHandler = async (request, response, next) => { try { response.status(201).json({ success: true, data: await uploadStoryPhoto(request.user?.userId as string, request.params.storyId as string, request.file) }); } catch (error) { next(error); } };
