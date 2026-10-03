import { z } from "zod";

import { prisma } from "../database/prisma";
import { AppError } from "../errors/app-error";

export const auditEventTypes = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "OTP_REQUESTED",
  "OTP_VERIFICATION_FAILED",
  "LOGOUT",
  "REFRESH_TOKEN_ROTATED",
  "REFRESH_TOKEN_REJECTED",
  "SESSIONS_REVOKED",
  "PRESCRIPTION_SUBMITTED",
  "PRESCRIPTION_VERIFIED",
  "PRESCRIPTION_REJECTED",
  "PRESCRIPTION_QUERIED",
  "ORDER_CREATED",
  "PAYMENT_INITIATED",
  "PAYMENT_VERIFIED",
  "DELIVERY_ASSIGNED",
  "DELIVERY_COMPLETED",
  "DELIVERY_FAILED",
  "REFERRAL_CREATED",
  "REFERRAL_STATUS_CHANGED",
  "APPOINTMENT_CREATED",
  "APPOINTMENT_STATUS_CHANGED",
  "LAB_BOOKING_CREATED",
  "LAB_BOOKING_STATUS_CHANGED",
  "LAB_REPORT_UPLOADED",
  "PAP_APPLICATION_CREATED",
  "PAP_STATUS_CHANGED",
  "TESTIMONIAL_CREATED",
  "TESTIMONIAL_UPDATED",
  "TESTIMONIAL_PUBLISHED",
  "TESTIMONIAL_UNPUBLISHED",
  "TESTIMONIAL_MEDIA_REPLACED",
  "TESTIMONIAL_DELETED",
  "TRIAL_CREATED",
  "TRIAL_UPDATED",
  "TRIAL_PUBLISHED",
  "TRIAL_INTEREST_STATUS_CHANGED",
  "STORY_CREATED",
  "STORY_UPDATED",
  "STORY_STATUS_CHANGED",
  "STORY_PUBLISHED",
  "STORY_PHOTO_REPLACED",
  "KNOWLEDGE_ARTICLE_CREATED",
  "KNOWLEDGE_ARTICLE_UPDATED",
  "KNOWLEDGE_ARTICLE_PUBLISHED",
  "PRODUCT_IMPORT_COMPLETED"
] as const;

export type AuditEventTypeValue = (typeof auditEventTypes)[number];

export const AUDIT_RESOURCE_TYPES = [
  "USER",
  "SESSION",
  "PRESCRIPTION",
  "ORDER",
  "PAYMENT",
  "DELIVERY",
  "REFERRAL",
  "APPOINTMENT",
  "LAB_BOOKING",
  "PAP_APPLICATION",
  "TESTIMONIAL",
  "CLINICAL_TRIAL",
  "TRIAL_INTEREST",
  "PATIENT_STORY",
  "KNOWLEDGE_ARTICLE",
  "PRODUCT_IMPORT_JOB"
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export function assertAuditEventType(value: string): asserts value is AuditEventTypeValue {
  if (!(auditEventTypes as readonly string[]).includes(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "Unknown audit event type");
  }
}

export function assertAuditResourceType(value: string): asserts value is AuditResourceType {
  if (!(AUDIT_RESOURCE_TYPES as readonly string[]).includes(value)) {
    throw new AppError(400, "VALIDATION_ERROR", "Unknown audit resource type");
  }
}

const uuidSchema = z.string().uuid();

export const auditEventListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    eventType: z.string().optional(),
    resourceType: z.string().optional(),
    resourceId: uuidSchema.optional(),
    actorUserId: uuidSchema.optional(),
    requestId: z.string().trim().min(1).max(64).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export type AuditEventListQuery = z.infer<typeof auditEventListQuerySchema>;

const auditEventSelect = {
  id: true,
  eventType: true,
  actorUserId: true,
  actorRole: true,
  resourceType: true,
  resourceId: true,
  requestId: true,
  metadata: true,
  createdAt: true
} as const;

/**
 * Read-only audit event listing for OPS_ADMIN. Filterable by event type,
 * resource, actor, and request correlation ID. Audit records are never
 * mutable through this API — there is no create, update, or delete path.
 */
export async function listAuditEvents(query: AuditEventListQuery) {
  const where = {
    ...(query.eventType
      ? { eventType: (assertAuditEventType(query.eventType), query.eventType as AuditEventTypeValue) }
      : {}),
    ...(query.resourceType
      ? { resourceType: (assertAuditResourceType(query.resourceType), query.resourceType as AuditResourceType) }
      : {}),
    ...(query.resourceId ? { resourceId: query.resourceId } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.requestId ? { requestId: query.requestId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {})
          }
        }
      : {})
  };

  const skip = (query.page - 1) * query.pageSize;
  const [total, events] = await prisma.$transaction([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: query.pageSize,
      select: auditEventSelect
    })
  ]);

  return {
    items: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      actorRole: event.actorRole,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      requestId: event.requestId,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString()
    })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize)
    }
  };
}
