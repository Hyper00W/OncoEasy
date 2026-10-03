import { Prisma } from "@prisma/client";

import { prisma } from "../database/prisma";
import { createLogger } from "./logger";
import { getRequestContext } from "./request-context";
import type { AnalyticsWriter } from "../modules/analytics/analytics.events";
import type { AuditEventType } from "@prisma/client";

const logger = createLogger("audit");

export type AuditWriter = Pick<Prisma.TransactionClient, "auditEvent">;

export type AuditEventInput = {
  eventType: AuditEventType;
  actorUserId?: string | null;
  actorRole?: string | null;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Keys that must never be persisted in audit metadata. Metadata holds only
 * operational context (statuses, counts, categories) — never credentials,
 * OTPs, tokens, reasons containing free text, or document contents.
 */
const FORBIDDEN_METADATA_KEYS = [
  "password",
  "otp",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "secret",
  "apikey",
  "credential",
  "signature",
  "notes",
  "reason",
  "reviewreason",
  "cancellationreason",
  "failuremessage",
  "documentname",
  "storagekey",
  "checksum",
  "applicationdata",
  "patientnotes",
  "content",
  "story",
  "description",
  "email",
  "phone",
  "fullname",
  "addressdata"
];

const FORBIDDEN_KEY_SET = new Set(FORBIDDEN_METADATA_KEYS);

function scrubMetadataValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (depth >= 3) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => scrubMetadataValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = scrubMetadataValue(item, depth + 1);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result;
  }
  if (typeof value === "string" && value.length > 200) {
    return `${value.slice(0, 200)}…`;
  }
  return value;
}

/**
 * Removes forbidden keys entirely (not just masked) so sensitive values can
 * never reach the audit table even when a caller mistakenly passes them.
 */
function scrubMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const scrubbed = scrubMetadataValue(metadata, 0);
  return scrubbed && typeof scrubbed === "object" ? (scrubbed as Record<string, unknown>) : {};
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(record).length > 0 ? record : undefined;
}

/**
 * Records an audit event inside an existing transaction (service-layer use).
 * Correlation fields default to the active request context. Callers pass only
 * safe operational metadata; forbidden keys are stripped defensively.
 */
export async function recordAuditEvent(
  client: AuditWriter,
  input: AuditEventInput
): Promise<void> {
  const context = getRequestContext();
  const metadata = compactRecord(scrubMetadata(input.metadata ?? {}));

  await client.auditEvent.create({
    data: {
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? context?.actor?.userId ?? null,
      actorRole: input.actorRole ?? context?.actor?.role ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      requestId: context?.requestId ?? null,
      metadata: metadata as Prisma.InputJsonValue | undefined
    }
  });
}

/**
 * Fire-and-forget audit write for paths without a transaction (or where a
 * failed audit write must not fail the primary action). Failures are logged
 * with correlation but never propagate.
 */
export async function recordAuditEventSafe(input: AuditEventInput): Promise<void> {
  try {
    await recordAuditEvent(prisma, input);
  } catch (error) {
    logger.warn("audit_write_failed", {
      eventType: input.eventType,
      resourceType: input.resourceType,
      ...errorToFieldsForLog(error)
    });
  }
}

function errorToFieldsForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorMessage: error.message };
  }
  return { errorMessage: String(error) };
}

export { FORBIDDEN_METADATA_KEYS, scrubMetadata };
