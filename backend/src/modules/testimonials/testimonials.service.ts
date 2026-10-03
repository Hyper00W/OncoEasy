import { createHash } from "node:crypto";
import { Prisma, TestimonialType, UserRole } from "@prisma/client";

import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { createPrivateTemporaryAccess, deletePrivateObject, isBrowserLoadableReference, readPrivateObject, uploadPrivateFile } from "../../storage/private-storage";
import { normalizeTestimonialMediaName, validateTestimonialMedia } from "./testimonials.storage";
import { recordAuditEvent } from "../../observability/audit";
import { toAdminTestimonial, toPublicTestimonial } from "./testimonials.mapper";
import type { TestimonialRecord, MediaAccess } from "./testimonials.mapper";
import type { CreateTestimonialInput, TestimonialListQuery, UpdateTestimonialInput } from "./testimonials.schemas";

const adminSelect = {
  id: true,
  type: true,
  title: true,
  description: true,
  displayName: true,
  displayOrder: true,
  published: true,
  publishedAt: true,
  mediaStorageKey: true,
  mediaDocumentName: true,
  mediaMimeType: true,
  mediaChecksum: true,
  mediaUploadedAt: true,
  createdAt: true,
  updatedAt: true
} as const satisfies Prisma.TestimonialSelect;

export async function listPublishedTestimonials(query: TestimonialListQuery) {
  const where: Prisma.TestimonialWhereInput = { published: true };
  if (query.type) where.type = query.type as TestimonialType;
  return listTestimonials(where, query, true);
}

export async function listAdminTestimonials(query: TestimonialListQuery) {
  const where: Prisma.TestimonialWhereInput = {};
  if (query.type) where.type = query.type as TestimonialType;
  if (query.published !== undefined) where.published = query.published;
  return listTestimonials(where, query, false);
}

export async function getAdminTestimonial(testimonialId: string) {
  const testimonial = await prisma.testimonial.findUnique({ where: { id: testimonialId }, select: adminSelect });
  if (!testimonial) throw new AppError(404, "TESTIMONIAL_NOT_FOUND", "Testimonial was not found");
  return toAdminTestimonial(testimonial);
}

export async function createTestimonial(adminId: string, input: CreateTestimonialInput) {
  await assertAdmin(adminId);
  // Media can only arrive via the upload endpoint, so a testimonial can never be
  // published at creation time.
  if (input.published) throw new AppError(409, "TESTIMONIAL_MEDIA_REQUIRED", "A testimonial must have media uploaded before it can be published");
  const testimonial = await prisma.testimonial.create({
    data: {
      type: input.type as TestimonialType,
      title: input.title,
      description: input.description,
      displayName: input.displayName,
      displayOrder: input.displayOrder,
      published: input.published,
      publishedAt: input.published ? new Date() : null
    },
    select: adminSelect
  });
  await recordAuditEvent(prisma, {
    eventType: "TESTIMONIAL_CREATED",
    actorUserId: adminId,
    actorRole: "OPS_ADMIN",
    resourceType: "TESTIMONIAL",
    resourceId: testimonial.id
  });
  return toAdminTestimonial(testimonial);
}

export async function updateTestimonial(adminId: string, testimonialId: string, input: UpdateTestimonialInput) {
  await assertAdmin(adminId);
  const existing = await prisma.testimonial.findUnique({ where: { id: testimonialId }, select: { id: true, published: true, mediaStorageKey: true } });
  if (!existing) throw new AppError(404, "TESTIMONIAL_NOT_FOUND", "Testimonial was not found");
  if (input.published && !existing.mediaStorageKey) {
    throw new AppError(409, "TESTIMONIAL_MEDIA_REQUIRED", "A testimonial must have media uploaded before it can be published");
  }

  const testimonial = await prisma.testimonial.update({
    where: { id: testimonialId },
    data: {
      ...(input.type ? { type: input.type as TestimonialType } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
      ...(input.published === undefined ? {} : { published: input.published, publishedAt: input.published ? (await prisma.testimonial.findUnique({ where: { id: testimonialId }, select: { publishedAt: true } }))?.publishedAt ?? new Date() : null })
    },
    select: adminSelect
  });
  await recordAuditEvent(prisma, {
    eventType: input.published === undefined
      ? "TESTIMONIAL_UPDATED"
      : input.published
        ? "TESTIMONIAL_PUBLISHED"
        : "TESTIMONIAL_UNPUBLISHED",
    actorUserId: adminId,
    actorRole: "OPS_ADMIN",
    resourceType: "TESTIMONIAL",
    resourceId: testimonialId
  });
  return toAdminTestimonial(testimonial);
}

export async function deleteTestimonial(adminId: string, testimonialId: string) {
  await assertAdmin(adminId);
  const existing = await prisma.testimonial.findUnique({ where: { id: testimonialId }, select: { id: true, mediaStorageKey: true } });
  if (!existing) throw new AppError(404, "TESTIMONIAL_NOT_FOUND", "Testimonial was not found");
  await prisma.testimonial.delete({ where: { id: testimonialId } });
  if (existing.mediaStorageKey) await deletePrivateObject(existing.mediaStorageKey);
  await recordAuditEvent(prisma, {
    eventType: "TESTIMONIAL_DELETED",
    actorUserId: adminId,
    actorRole: "OPS_ADMIN",
    resourceType: "TESTIMONIAL",
    resourceId: testimonialId
  });
  return { deleted: true };
}

export async function uploadTestimonialMedia(adminId: string, testimonialId: string, type: "IMAGE" | "VIDEO", file: Express.Multer.File | undefined) {
  await assertAdmin(adminId);
  if (!file) throw new AppError(400, "FILE_REQUIRED", "A testimonial media file is required");
  const mediaType = validateTestimonialMedia(file, type);
  const existing = await prisma.testimonial.findUnique({ where: { id: testimonialId }, select: { id: true, type: true, mediaStorageKey: true } });
  if (!existing) throw new AppError(404, "TESTIMONIAL_NOT_FOUND", "Testimonial was not found");
  if (existing.type !== type) {
    throw new AppError(409, "TESTIMONIAL_TYPE_MISMATCH", `This testimonial expects ${existing.type === "IMAGE" ? "an image" : "a video"} file`);
  }

  const uploaded = await uploadPrivateFile("testimonials", { extension: mediaType.extension, contentType: mediaType.mimeType, body: file.buffer });
  try {
    const testimonial = await prisma.testimonial.update({
      where: { id: testimonialId },
      data: {
        mediaStorageKey: uploaded.key,
        mediaDocumentName: normalizeTestimonialMediaName(file.originalname),
        mediaMimeType: mediaType.mimeType,
        mediaChecksum: createHash("sha256").update(file.buffer).digest("hex"),
        mediaUploadedAt: new Date()
      },
      select: adminSelect
    });
    if (existing.mediaStorageKey) await deletePrivateObject(existing.mediaStorageKey);
    // Media replacement is a content change; the storage key and document
    // name stay out of audit metadata.
    await recordAuditEvent(prisma, {
      eventType: "TESTIMONIAL_MEDIA_REPLACED",
      actorUserId: adminId,
      actorRole: "OPS_ADMIN",
      resourceType: "TESTIMONIAL",
      resourceId: testimonialId
    });
    return toAdminTestimonial(testimonial);
  } catch (error) {
    await deletePrivateObject(uploaded.key);
    throw error;
  }
}

async function listTestimonials(where: Prisma.TestimonialWhereInput, query: TestimonialListQuery, publicList: boolean) {
  const skip = (query.page - 1) * query.pageSize;
  const [total, testimonials] = await prisma.$transaction([
    prisma.testimonial.count({ where }),
    prisma.testimonial.findMany({
      where,
      // Public listing: displayOrder, then createdAt, then id — so equal display
      // orders still render in a stable, deterministic order. Admin keeps newest edits first.
      orderBy: publicList ? [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take: query.pageSize,
      select: adminSelect
    })
  ]);

  const items = await Promise.all(testimonials.map(async (testimonial) =>
    publicList ? toPublicTestimonial(testimonial, await mediaAccess(testimonial)) : toAdminTestimonial(testimonial)
  ));
  return { items, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}

// A missing or unreachable object must not fail the whole listing: the public
// media delivery endpoint (with its per-card fallback) covers that case.
async function mediaAccess(testimonial: Pick<TestimonialRecord, "mediaStorageKey">): Promise<MediaAccess | undefined> {
  if (!testimonial.mediaStorageKey) return undefined;
  try {
    return await createPrivateTemporaryAccess(testimonial.mediaStorageKey);
  } catch (_error) {
    return undefined;
  }
}

export type TestimonialMediaDelivery =
  | { kind: "redirect"; url: string }
  | { kind: "stream"; body: Buffer; contentType: string; documentName: string };

/**
 * Resolves testimonial media for browser delivery without ever exposing storage
 * credentials or object keys:
 *  - production (S3): redirect to the short-lived signed URL the provider issues;
 *  - development (in-memory): stream the bytes through the backend, because
 *    `private://` references are intentionally not browser-loadable.
 */
export async function getTestimonialMedia(testimonialId: string, options: { publicOnly: boolean }): Promise<TestimonialMediaDelivery> {
  const testimonial = await prisma.testimonial.findUnique({
    where: { id: testimonialId },
    select: { published: true, mediaStorageKey: true, mediaDocumentName: true }
  });

  // Unpublished media is never reachable through the public flow, and unknown ids
  // are indistinguishable from unpublished ones.
  if (!testimonial?.mediaStorageKey || (options.publicOnly && !testimonial.published)) {
    throw new AppError(404, "TESTIMONIAL_MEDIA_NOT_FOUND", "Testimonial media was not found");
  }

  try {
    const access = await createPrivateTemporaryAccess(testimonial.mediaStorageKey);
    if (isBrowserLoadableReference(access.reference)) {
      return { kind: "redirect", url: access.reference };
    }
  } catch (_error) {
    // Fall through to server-side streaming below.
  }

  const object = await readPrivateObject(testimonial.mediaStorageKey);
  return {
    kind: "stream",
    body: object.body,
    contentType: object.contentType,
    documentName: normalizeTestimonialMediaName(testimonial.mediaDocumentName ?? "testimonial-media")
  };
}

async function assertAdmin(id: string) {
  const user = await prisma.user.findFirst({ where: { id, role: UserRole.OPS_ADMIN, isActive: true }, select: { id: true } });
  if (!user) throw new AppError(403, "ADMIN_NOT_AUTHORIZED", "Admin access is not authorized");
}
