import { createHash } from "node:crypto";
import { PatientStoryStatus, Prisma, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { createPrivateTemporaryAccess, deletePrivateObject, uploadPrivateFile } from "../../storage/private-storage";
import { toAdminStory, toPublicStory } from "./stories.mapper";
import { normalizeStoryPhotoName, validateStoryPhoto } from "./stories.storage";
import type { CreateStoryInput, StoryListQuery, UpdateStoryInput, UpdateStoryStatusInput } from "./stories.schemas";
import { recordAnalyticsEvent } from "../analytics/analytics.events";
import { recordAuditEvent } from "../../observability/audit";

const publicSelect = { id: true, displayName: true, story: true, photoStorageKey: true, photoDocumentName: true, photoMimeType: true, consentGiven: true, status: true, isPublished: true, publishedAt: true, createdAt: true, updatedAt: true } as const;
const adminInclude = { createdBy: { select: { id: true, fullName: true } }, updatedBy: { select: { id: true, fullName: true } } } as const;
const adminSelect = { ...publicSelect, consentTextVersion: true, createdById: true, updatedById: true } as const;

export async function listPublishedStories(query: StoryListQuery) {
  const where = { isPublished: true, consentGiven: true, status: PatientStoryStatus.APPROVED };
  return listStories(where, query, false);
}

export async function getPublishedStory(storyId: string) {
  const story = await prisma.patientStory.findFirst({ where: { id: storyId, isPublished: true }, select: publicSelect });
  if (!story) throw new AppError(404, "PATIENT_STORY_NOT_FOUND", "Patient story was not found");
  return toPublicStory(story, await photoAccess(story));
}

export async function listAdminStories(query: StoryListQuery) {
  const where = { ...(query.status ? { status: query.status as PatientStoryStatus } : {}), ...(query.isPublished === undefined ? {} : { isPublished: query.isPublished }) };
  return listStories(where, query, true);
}

export async function getAdminStory(storyId: string) {
  const story = await prisma.patientStory.findUnique({ where: { id: storyId }, include: adminInclude });
  if (!story) throw new AppError(404, "PATIENT_STORY_NOT_FOUND", "Patient story was not found");
  return toAdminStory(story);
}

export async function createStory(adminId: string, input: CreateStoryInput) {
  await assertAdmin(adminId);
  if (input.isPublished && (!input.consentGiven || input.status !== "APPROVED")) throw new AppError(409, "STORY_PUBLICATION_REQUIRES_APPROVAL", "A story must have consent and approval before publication");
  const story = await prisma.patientStory.create({ data: { ...input, publishedAt: input.isPublished ? new Date() : null, createdById: adminId, updatedById: adminId }, include: adminInclude });
  return toAdminStory(story);
}

export async function updateStory(adminId: string, storyId: string, input: UpdateStoryInput) {
  await assertAdmin(adminId);
  const existing = await prisma.patientStory.findUnique({ where: { id: storyId }, select: { id: true } });
  if (!existing) throw new AppError(404, "PATIENT_STORY_NOT_FOUND", "Patient story was not found");
  const current = await prisma.patientStory.findUnique({ where: { id: storyId }, select: { isPublished: true, consentGiven: true, status: true } });
  if (current?.isPublished && input.consentGiven === false) throw new AppError(409, "STORY_PUBLICATION_REQUIRES_APPROVAL", "Published stories must retain consent");
  const story = await prisma.patientStory.update({ where: { id: storyId }, data: { ...input, ...(input.consentGiven === false ? { isPublished: false, publishedAt: null } : {}), updatedById: adminId }, include: adminInclude });
  return toAdminStory(story);
}

export async function updateStoryStatus(adminId: string, storyId: string, input: UpdateStoryStatusInput) {
  await assertAdmin(adminId);
  const existing = await prisma.patientStory.findUnique({ where: { id: storyId }, select: { status: true } });
  if (!existing) throw new AppError(404, "PATIENT_STORY_NOT_FOUND", "Patient story was not found");
  assertTransition(existing.status, input.status);
  // Conditional transition: only a row still in the source status is updated,
  // so concurrent admins cannot interleave contradictory statuses.
  const transitioned = await prisma.patientStory.updateMany({
    where: { id: storyId, status: existing.status },
    data: { status: input.status, updatedById: adminId, ...(input.status !== PatientStoryStatus.APPROVED ? { isPublished: false, publishedAt: null } : {}) }
  });
  if (transitioned.count === 0) throw new AppError(409, "PATIENT_STORY_STATUS_CONFLICT", "Patient story status transition is not valid");
  const story = await prisma.patientStory.findUniqueOrThrow({ where: { id: storyId }, include: adminInclude });
  await recordAuditEvent(prisma, {
    eventType: "STORY_STATUS_CHANGED",
    actorUserId: adminId,
    actorRole: "OPS_ADMIN",
    resourceType: "PATIENT_STORY",
    resourceId: storyId,
    metadata: { from: existing.status, to: input.status }
  });
  return toAdminStory(story);
}

export async function publishStory(adminId: string, storyId: string, isPublished: boolean) {
  await assertAdmin(adminId);
  const existing = await prisma.patientStory.findUnique({ where: { id: storyId }, select: { consentGiven: true, status: true } });
  if (!existing) throw new AppError(404, "PATIENT_STORY_NOT_FOUND", "Patient story was not found");
  if (isPublished && (!existing.consentGiven || existing.status !== PatientStoryStatus.APPROVED)) throw new AppError(409, "STORY_PUBLICATION_REQUIRES_APPROVAL", "A story must have consent and approval before publication");
  const story = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.patientStory.update({ where: { id: storyId }, data: { isPublished, publishedAt: isPublished ? new Date() : null, updatedById: adminId }, include: adminInclude });
    if (isPublished) await recordAnalyticsEvent(transaction, "PATIENT_STORY_PUBLISHED", { userId: adminId, entityType: "PATIENT_STORY", entityId: storyId });
    await recordAuditEvent(transaction, {
      eventType: isPublished ? "STORY_PUBLISHED" : "STORY_UPDATED",
      actorUserId: adminId,
      actorRole: "OPS_ADMIN",
      resourceType: "PATIENT_STORY",
      resourceId: storyId
    });
    return updated;
  });
  return toAdminStory(story);
}

export async function uploadStoryPhoto(adminId: string, storyId: string, file: Express.Multer.File | undefined) {
  await assertAdmin(adminId);
  if (!file) throw new AppError(400, "FILE_REQUIRED", "A story photo is required");
  const type = validateStoryPhoto(file);
  const existing = await prisma.patientStory.findUnique({ where: { id: storyId }, select: { id: true, photoStorageKey: true } });
  if (!existing) throw new AppError(404, "PATIENT_STORY_NOT_FOUND", "Patient story was not found");
  const uploaded = await uploadPrivateFile("patient-stories", { extension: type.extension, contentType: type.mimeType, body: file.buffer });
  try {
    const story = await prisma.patientStory.update({ where: { id: storyId }, data: { photoStorageKey: uploaded.key, photoDocumentName: normalizeStoryPhotoName(file.originalname), photoMimeType: type.mimeType, photoChecksum: createHash("sha256").update(file.buffer).digest("hex"), photoUploadedAt: new Date(), updatedById: adminId }, include: adminInclude });
    if (existing.photoStorageKey) await deletePrivateObject(existing.photoStorageKey);
    await recordAuditEvent(prisma, {
      eventType: "STORY_PHOTO_REPLACED",
      actorUserId: adminId,
      actorRole: "OPS_ADMIN",
      resourceType: "PATIENT_STORY",
      resourceId: storyId
    });
    return toAdminStory(story);
  } catch (error) { await deletePrivateObject(uploaded.key); throw error; }
}

async function listStories(where: Prisma.PatientStoryWhereInput, query: StoryListQuery, admin: boolean) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, stories] = await prisma.$transaction([prisma.patientStory.count({ where }), admin ? prisma.patientStory.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, include: adminInclude }) : prisma.patientStory.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip, take: query.pageSize, select: publicSelect })]);
  return { items: await Promise.all(stories.map(async (story) => admin ? toAdminStory(story) : toPublicStory(story, await photoAccess(story)))), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

async function photoAccess(story: { photoStorageKey: string | null }) { return story.photoStorageKey ? createPrivateTemporaryAccess(story.photoStorageKey) : undefined; }
async function assertAdmin(id: string) { const user = await prisma.user.findFirst({ where: { id, role: UserRole.OPS_ADMIN, isActive: true }, select: { id: true } }); if (!user) throw new AppError(403, "ADMIN_NOT_AUTHORIZED", "Admin access is not authorized"); }
function assertTransition(current: PatientStoryStatus, next: PatientStoryStatus) { const allowed: Record<PatientStoryStatus, PatientStoryStatus[]> = { DRAFT: [PatientStoryStatus.UNDER_REVIEW], UNDER_REVIEW: [PatientStoryStatus.APPROVED, PatientStoryStatus.REJECTED, PatientStoryStatus.DRAFT], APPROVED: [PatientStoryStatus.REJECTED], REJECTED: [PatientStoryStatus.DRAFT, PatientStoryStatus.UNDER_REVIEW] }; if (!allowed[current].includes(next)) throw new AppError(409, "PATIENT_STORY_STATUS_CONFLICT", "Patient story status transition is not valid"); }
