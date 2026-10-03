import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Request correlation context (Phase 4.7).
 *
 * A tiny AsyncLocalStorage carries the requestId (plus the authenticated
 * actor when known) through the whole async chain of one request, so any
 * module — services, integrations, storage — can log with correlation without
 * threading parameters through every call signature.
 *
 * Request IDs:
 * - opaque UUIDs generated server-side by default
 * - an incoming `X-Request-Id` header is honored only when it is a short,
 *   printable, PII-free opaque token (up to 64 chars of [A-Za-z0-9._-]);
 *   anything else is replaced by a server-generated UUID
 * - user IDs, phone numbers, emails, JWTs, etc. are therefore never accepted
 *   as request IDs
 */

const REQUEST_ID_HEADER = "x-request-id";

export const REQUEST_ID_HEADER_NAME = "X-Request-Id";

export type RequestActor = {
  userId: string | null;
  role: string | null;
};

export type RequestContext = {
  requestId: string;
  actor: RequestActor | null;
  route: string | null;
  method: string | null;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Opaque, printable, PII-free request ID check. Deliberately restrictive:
 * UUIDs, short hex/base64url tokens, and simple dotted identifiers pass;
 * emails, phone numbers, JWTs, and free text do not.
 */
export function isSafeRequestId(candidate: string): boolean {
  return candidate.length > 0 && candidate.length <= 64 && /^[A-Za-z0-9._-]+$/.test(candidate);
}

export function extractIncomingRequestId(headers: { get(name: string): string | null } | Record<string, unknown>): string | null {
  const raw =
    typeof (headers as { get?: (name: string) => string | null }).get === "function"
      ? (headers as { get: (name: string) => string | null }).get(REQUEST_ID_HEADER)
      : (headers as Record<string, unknown>)[REQUEST_ID_HEADER];

  if (typeof raw !== "string") {
    return null;
  }
  const candidate = raw.trim();
  return isSafeRequestId(candidate) ? candidate : null;
}

export function generateRequestId(): string {
  return randomUUID();
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStorage.run(context, callback);
}

/** Current request context, or null when logging outside a request. */
export function getRequestContext(): RequestContext | null {
  return requestContextStorage.getStore() ?? null;
}

/** Correlated log fields for the active request, when any. */
export function requestLogFields(): { requestId?: string; actorUserId?: string; actorRole?: string } {
  const context = requestContextStorage.getStore();
  if (!context) {
    return {};
  }
  const fields: { requestId?: string; actorUserId?: string; actorRole?: string } = {
    requestId: context.requestId
  };
  if (context.actor) {
    if (context.actor.userId) fields.actorUserId = context.actor.userId;
    if (context.actor.role) fields.actorRole = context.actor.role;
  }
  return fields;
}

export function setRequestActor(actor: RequestActor): void {
  const context = requestContextStorage.getStore();
  if (context) {
    context.actor = actor;
  }
}
