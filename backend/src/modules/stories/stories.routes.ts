import { UserRole } from "@prisma/client";
import multer from "multer";
import { Router } from "express";

import { env } from "../../config/env";
import { AppError } from "../../errors/app-error";
import { authenticate } from "../../middleware/authenticate";
import { requireRole } from "../../middleware/require-role";
import { validateRequest } from "../../middleware/validate-request";
import { create, getAdmin, getPublished, listAdmin, listPublished, publish, status, update, uploadPhoto } from "./stories.controller";
import { createStorySchema, publishStorySchema, storyIdParamsSchema, storyListQuerySchema, updateStorySchema, updateStoryStatusSchema } from "./stories.schemas";
import { allowedStoryPhotoTypes } from "./stories.storage";

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.DELIVERY_PROOF_MAX_FILE_SIZE_BYTES }, fileFilter: (_request, file, callback) => { if (file.mimetype in allowedStoryPhotoTypes) callback(null, true); else callback(new AppError(400, "UNSUPPORTED_FILE_TYPE", "Story photo type is not supported")); } });
function parsePhoto(request: Parameters<typeof uploadPhoto>[0], response: Parameters<typeof uploadPhoto>[1], next: Parameters<typeof uploadPhoto>[2]) { photoUpload.single("file")(request, response, (error) => { if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") { next(new AppError(413, "FILE_TOO_LARGE", "Story photo is too large")); return; } next(error); }); }

export const storiesRouter = Router();
storiesRouter.use(authenticate, requireRole(UserRole.PATIENT));
storiesRouter.get("/", validateRequest({ query: storyListQuerySchema }), listPublished);
storiesRouter.get("/:storyId", validateRequest({ params: storyIdParamsSchema }), getPublished);

export const adminStoriesRouter = Router();
adminStoriesRouter.use(authenticate, requireRole(UserRole.OPS_ADMIN));
adminStoriesRouter.get("/", validateRequest({ query: storyListQuerySchema }), listAdmin);
adminStoriesRouter.get("/:storyId", validateRequest({ params: storyIdParamsSchema }), getAdmin);
adminStoriesRouter.post("/", validateRequest({ body: createStorySchema }), create);
adminStoriesRouter.patch("/:storyId", validateRequest({ params: storyIdParamsSchema, body: updateStorySchema }), update);
adminStoriesRouter.patch("/:storyId/status", validateRequest({ params: storyIdParamsSchema, body: updateStoryStatusSchema }), status);
adminStoriesRouter.patch("/:storyId/publish", validateRequest({ params: storyIdParamsSchema, body: publishStorySchema }), publish);
adminStoriesRouter.post("/:storyId/photo", validateRequest({ params: storyIdParamsSchema }), parsePhoto, uploadPhoto);
