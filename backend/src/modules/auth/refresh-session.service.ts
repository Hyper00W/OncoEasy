import { createHash, randomBytes } from "node:crypto";

import { env } from "../../config/env";
import { prisma } from "../../database/prisma";
import { AppError } from "../../errors/app-error";
import { recordAuditEventSafe } from "../../observability/audit";
import { generateAccessToken, isOpaqueRefreshToken } from "../../services/jwt";

/**
 * Refresh session lifecycle (Phase 4.6)
 *
 * Refresh tokens are opaque 256-bit random values. Each token maps to a
 * session row that stores a SHA-256 hash of the token value — never the token
 * itself — plus the owning user, an expiry, and a revocation timestamp. This
 * gives us:
 *
 * - server-side revocation (logout, deactivation) without access-token blacklisting
 * - replay detection: rotation atomically revokes the old row, so a reused
 *   token 401s and can never mint a second session
 * - no plaintext refresh tokens at rest
 *
 * Rotation is atomic: the row is claimed (revoked) and the replacement session
 * is created inside one transaction, so two concurrent requests presenting the
 * same token can never both succeed.
 */

type RotatedRefreshResult = {
  userId: string;
  accessToken: string;
  refreshToken: string;
};

export type RefreshResult = {
  accessToken: string;
  refreshToken: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshSessionTtlMs(): number {
  // Parse the existing JWT_REFRESH_EXPIRES_IN (e.g. "7d", "12h", "30m").
  const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_EXPIRES_IN.trim());
  if (!match) {
    // Fall back to 7 days if the configured value is not a simple unit form.
    return 7 * 24 * 60 * 60 * 1000;
  }

  const value = Number(match[1]);
  const unitMultipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return value * unitMultipliers[match[2]];
}

/**
 * Creates a refresh session for a freshly authenticated user and returns the
 * opaque refresh token to hand to the client.
 */
export async function issueRefreshSession(userId: string, _role: string): Promise<string> {
  const token = randomBytes(48).toString("base64url");

  await prisma.refreshSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + refreshSessionTtlMs())
    }
  });

  return token;
}

/**
 * Exchanges a refresh token for a new access token plus a rotated refresh
 * token. Fails with 401 (no detail leaked) for: unknown, malformed, expired,
 * or revoked tokens, deleted users, and deactivated accounts.
 */
export async function rotateRefreshToken(refreshToken: string): Promise<RefreshResult> {
  const tokenHash = hashToken(refreshToken);

  // The credential must look like a current opaque refresh token. Signed
  // formats (access JWTs, legacy stateless refresh JWTs, arbitrary junk) can
  // never match a session row and are rejected with the same 401.
  if (!isOpaqueRefreshToken(refreshToken)) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Please sign in again.");
  }

  const rotated: RotatedRefreshResult = await prisma.$transaction(async (tx) => {
    // Atomic claim: only the first caller revokes the row; concurrent replays
    // update zero rows and are rejected below.
    const claimed = await tx.refreshSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      data: {
        revokedAt: new Date()
      }
    });

    if (claimed.count === 0) {
      // Replay or stale-token attempt: audited as a category only. The token
      // value and its hash are never recorded.
      await recordAuditEventSafe({
        eventType: "REFRESH_TOKEN_REJECTED",
        resourceType: "SESSION"
      });
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Please sign in again.");
    }

    // The claimed row binds this token to its owner.
    const session = await tx.refreshSession.findFirst({
      where: { tokenHash },
      select: { userId: true }
    });

    // The account must still exist and be active. The access token is minted
    // with the role currently stored on the user record — never a role
    // carried by the credential — so RBAC stays authoritative from backend
    // data and role changes take effect at the next refresh.
    const user = session
      ? await tx.user.findUnique({ where: { id: session.userId } })
      : null;

    if (!user || !user.isActive) {
      await recordAuditEventSafe({
        eventType: "REFRESH_TOKEN_REJECTED",
        actorUserId: session?.userId ?? null,
        resourceType: "SESSION"
      });
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Please sign in again.");
    }

    // Issue the replacement session for the rotation.
    const nextToken = randomBytes(48).toString("base64url");
    await tx.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(nextToken),
        expiresAt: new Date(Date.now() + refreshSessionTtlMs())
      }
    });

    return {
      userId: user.id,
      accessToken: generateAccessToken({ userId: user.id, role: user.role }),
      refreshToken: nextToken
    };
  });

  await recordAuditEventSafe({
    eventType: "REFRESH_TOKEN_ROTATED",
    actorUserId: rotated.userId,
    resourceType: "SESSION"
  });

  return { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken } as RefreshResult;
}

/** Revokes a single refresh session (used by logout). Idempotent. */
export async function revokeRefreshSession(refreshToken: string): Promise<void> {
  const existing = await prisma.refreshSession.findFirst({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    select: { userId: true }
  });

  await prisma.refreshSession.updateMany({
    where: {
      tokenHash: hashToken(refreshToken),
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });

  if (existing) {
    await recordAuditEventSafe({
      eventType: "LOGOUT",
      actorUserId: existing.userId,
      resourceType: "SESSION"
    });
  }
}

/** Revokes every active session for a user (used when an account is deactivated). */
export async function revokeAllRefreshSessions(userId: string): Promise<number> {
  const result = await prisma.refreshSession.updateMany({
    where: {
      userId,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });

  if (result.count > 0) {
    await recordAuditEventSafe({
      eventType: "SESSIONS_REVOKED",
      actorUserId: userId,
      resourceType: "USER",
      resourceId: userId,
      metadata: { revokedCount: result.count }
    });
  }

  return result.count;
}

/** Best-effort cleanup of fully expired sessions; safe to call opportunistically. */
export async function pruneExpiredRefreshSessions(): Promise<number> {
  const result = await prisma.refreshSession.deleteMany({
    where: {
      expiresAt: { lte: new Date() }
    }
  });

  return result.count;
}


