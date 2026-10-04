import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { withoutTenant } from "../lib/tenant-context";
import { AccessTokenPayload } from "../types/auth.types";
import { impersonationService } from "../modules/platform/impersonation.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SocketIdentity {
  user: AccessTokenPayload;
  companyId: string | null;
  sessionId: string;
  deviceId: string | null;
  impersonationId: string | null;
  /** Token expiry in epoch milliseconds. */
  expiresAtMs: number;
}

export class SocketAuthError extends Error {}

const reject = (): never => {
  // One message for every cause: the client learns nothing about which check failed.
  throw new SocketAuthError("Unauthorized");
};

/**
 * Applies the checks of `authMiddleware` to a socket handshake (F05): a verified token, an
 * active unexpired session owned by the token's subject, device binding, an active account,
 * a company that is not suspended, a live impersonation, and admin tokens as the HTTP path
 * treats them. The session, its owner and the company are read in one query.
 */
export const authenticateSocket = async (input: {
  token: string | undefined;
  deviceId: string | undefined;
  requestedCompanyId: string | undefined;
}): Promise<SocketIdentity> => {
  if (!input.token) return reject();
  let decoded: AccessTokenPayload & { exp?: number };
  try {
    decoded = jwt.verify(input.token, env.JWT_ACCESS_SECRET) as AccessTokenPayload & {
      exp?: number;
    };
  } catch {
    return reject();
  }
  if (!decoded?.userId || !Array.isArray(decoded.permissions) || !decoded.sessionId) {
    return reject();
  }

  const isAdmin = decoded.userId.startsWith("admin_");
  const impersonating = Boolean(decoded.impersonatedBy && decoded.impersonationId);
  const sessionOwner = impersonating ? decoded.impersonatedBy! : decoded.userId;
  const ownerIsAdmin = sessionOwner.startsWith("admin_");

  let ownerAdminId: bigint | undefined;
  if (ownerIsAdmin) {
    try {
      ownerAdminId = BigInt(sessionOwner.slice("admin_".length));
    } catch {
      return reject();
    }
  }

  let companyId: string | null = null;

  await withoutTenant(async () => {
    const session = await prisma.userSession.findFirst({
      where: {
        id: decoded.sessionId,
        ...(ownerIsAdmin ? { adminId: ownerAdminId } : { userId: sessionOwner }),
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      select: {
        deviceId: true,
        admin: { select: { status: true } },
        user: {
          select: { status: true, companyId: true, company: { select: { isActive: true } } },
        },
      },
    });
    if (!session) return reject();
    if (session.deviceId && input.deviceId !== session.deviceId) return reject();

    if (ownerIsAdmin && session.admin?.status !== "active") return reject();

    if (impersonating) {
      const live = await impersonationService.active(decoded.impersonationId!, sessionOwner);
      if (!live || live.userId !== decoded.userId) return reject();
    }

    if (isAdmin) {
      // A platform admin acts on a tenant only when it names one that exists.
      if (input.requestedCompanyId && UUID_RE.test(input.requestedCompanyId)) {
        const company = await prisma.company.findUnique({
          where: { id: input.requestedCompanyId },
          select: { id: true },
        });
        if (company) companyId = company.id;
      }
      return;
    }

    // The tenant user: the session's own row when the token is the user's, a lookup when an
    // admin is impersonating (the session then belongs to the admin).
    const user = impersonating
      ? await prisma.user.findUnique({
          where: { userId: decoded.userId },
          select: { status: true, companyId: true, company: { select: { isActive: true } } },
        })
      : session.user;
    if (!user || user.status !== "active") return reject();
    if (user.company && !user.company.isActive) return reject();
    companyId = user.companyId;
  });

  return {
    user: decoded,
    companyId,
    sessionId: decoded.sessionId,
    deviceId: input.deviceId ?? null,
    impersonationId: impersonating ? decoded.impersonationId! : null,
    expiresAtMs: (decoded.exp ?? 0) * 1000,
  };
};
