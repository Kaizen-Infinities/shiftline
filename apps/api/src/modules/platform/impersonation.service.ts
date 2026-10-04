import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../config/prisma";
import { tenantStorage, withoutTenant } from "../../lib/tenant-context";
import { logger } from "../../lib/logger";
import { disconnectImpersonation } from "../../lib/realtime";
import { ApiError } from "../../utils/ApiError";
import { generateAccessToken } from "../../utils/generateAccessToken";
import { authRepository } from "../auth/auth.repository";

/**
 * Impersonation (P1-02): a platform admin acts as one tenant user for at most thirty minutes,
 * with a stated reason. The token carries the admin as `impersonatedBy`, so the tenant context,
 * every audit row and the request log name both people; the tenant sees the admin's actions as
 * that user's, marked. There is no refresh: when the window closes the admin is an admin again.
 */
export const IMPERSONATION_MAX_MINUTES = 30;
export const IMPERSONATION_TTL = `${IMPERSONATION_MAX_MINUTES}m`;

export const impersonateSchema = z.object({
  body: z.object({
    userId: z.string().uuid().optional(),
    reason: z.string().trim().min(5, "Say why you are impersonating").max(255),
  }),
  params: z.object({ id: z.string().uuid() }),
});
export const impersonationListSchema = z.object({
  query: z.object({
    companyId: z.string().uuid().optional(),
    active: z.enum(["true", "false"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
});

const adminIdOf = (userId: string): bigint => {
  if (!userId.startsWith("admin_")) throw new ApiError(403, "Only platform admins impersonate");
  return BigInt(userId.slice("admin_".length));
};

class ImpersonationService {
  /** Starts a session and mints the user's token with the admin as `impersonatedBy`. */
  async start(input: {
    adminUserId: string;
    adminSessionId: string;
    companyId: string;
    userId?: string;
    reason: string;
    ipAddress?: string;
  }) {
    const adminId = adminIdOf(input.adminUserId);
    return withoutTenant(async () => {
      const company = await prisma.company.findUnique({
        where: { id: input.companyId },
        select: { id: true, companyName: true, isActive: true },
      });
      if (!company) throw new ApiError(404, "Tenant not found");
      const where: Prisma.UserWhereInput = input.userId
        ? { userId: input.userId, companyId: company.id }
        : { companyId: company.id, status: "active", role: { code: "OWNER" } };
      const user = await prisma.user.findFirst({
        where,
        include: { role: { select: { code: true, name: true } } },
        orderBy: { createdOn: "asc" },
      });
      if (!user) throw new ApiError(404, "No such user in that tenant");
      if (user.status !== "active") throw new ApiError(409, "That user is not active");

      const now = new Date();
      const expiresAt = new Date(now.getTime() + IMPERSONATION_MAX_MINUTES * 60 * 1000);
      const row = await prisma.impersonationSession.create({
        data: {
          adminId,
          adminSessionId: input.adminSessionId,
          companyId: company.id,
          userId: user.userId,
          reason: input.reason,
          startedAt: now,
          expiresAt,
          ipAddress: input.ipAddress ?? null,
        },
      });
      const permissions = await authRepository.findPermissionsByRole(user.roleId);
      const accessToken = generateAccessToken(
        {
          userId: user.userId,
          email: user.email ?? "",
          roleId: user.role?.code ?? (user.roleId !== null ? String(user.roleId) : ""),
          permissions,
          isSuperAdmin: false,
          companyId: company.id,
          sessionId: input.adminSessionId,
          impersonatedBy: input.adminUserId,
          impersonationId: row.id,
        },
        { expiresIn: IMPERSONATION_TTL }
      );
      logger.info(
        {
          impersonationId: row.id,
          adminId: String(adminId),
          companyId: company.id,
          userId: user.userId,
        },
        "impersonation started"
      );
      return {
        accessToken,
        accessTokenExpiresAt: expiresAt,
        impersonation: {
          id: row.id,
          reason: row.reason,
          startedAt: row.startedAt,
          expiresAt: row.expiresAt,
          impersonatedBy: input.adminUserId,
        },
        user: {
          userId: user.userId,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
          roleId: user.role?.name ?? null,
        },
        company: { id: company.id, companyName: company.companyName },
      };
    });
  }

  /**
   * The live session behind a token, or null when it has ended or expired. Runs as the admin
   * with the RLS bypass: the table is row-secured like every tenant table, and the auth
   * middleware asks before any request context exists.
   */
  async active(id: string, actor: string) {
    return tenantStorage.run(
      { companyId: null, userId: actor, isSuperAdmin: true, bypass: true },
      async () => {
        const row = await prisma.impersonationSession.findUnique({ where: { id } });
        if (!row || row.endedAt || row.expiresAt <= new Date()) return null;
        return row;
      }
    );
  }

  /** Ends a session; `by` is the admin (from the console) or the impersonated token itself. */
  async end(id: string, by: { adminUserId?: string; reason: string }) {
    return withoutTenant(async () => {
      const row = await prisma.impersonationSession.findUnique({ where: { id } });
      if (!row) throw new ApiError(404, "Impersonation session not found");
      if (by.adminUserId && adminIdOf(by.adminUserId) !== row.adminId) {
        throw new ApiError(403, "Another admin started that session");
      }
      if (row.endedAt) return row;
      const ended = await prisma.impersonationSession.update({
        where: { id },
        data: { endedAt: new Date(), endedReason: by.reason },
      });
      disconnectImpersonation(id);
      logger.info({ impersonationId: id, reason: by.reason }, "impersonation ended");
      return ended;
    });
  }

  async list(q: { companyId?: string; active?: boolean; limit: number }) {
    return withoutTenant(async () => {
      const now = new Date();
      const rows = await prisma.impersonationSession.findMany({
        where: {
          ...(q.companyId && { companyId: q.companyId }),
          ...(q.active === true && { endedAt: null, expiresAt: { gt: now } }),
          ...(q.active === false && {
            OR: [{ endedAt: { not: null } }, { expiresAt: { lte: now } }],
          }),
        },
        orderBy: { startedAt: "desc" },
        take: q.limit,
      });
      const adminIds = [...new Set(rows.map((r) => r.adminId))];
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const companyIds = [...new Set(rows.map((r) => r.companyId))];
      const [admins, users, companies] = await Promise.all([
        prisma.admin.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, fullName: true, username: true },
        }),
        prisma.user.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, fullName: true, username: true },
        }),
        prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, companyName: true },
        }),
      ]);
      const adminBy = new Map(admins.map((a) => [a.id.toString(), a]));
      const userBy = new Map(users.map((u) => [u.userId, u]));
      const companyBy = new Map(companies.map((c) => [c.id, c]));
      return rows.map((r) => ({
        id: r.id,
        admin: adminBy.get(r.adminId.toString()) ?? {
          id: r.adminId,
          fullName: null,
          username: null,
        },
        adminId: `admin_${r.adminId}`,
        company: companyBy.get(r.companyId) ?? { id: r.companyId, companyName: null },
        user: userBy.get(r.userId) ?? { userId: r.userId, fullName: null, username: null },
        reason: r.reason,
        startedAt: r.startedAt,
        expiresAt: r.expiresAt,
        endedAt: r.endedAt,
        endedReason: r.endedReason,
        active: !r.endedAt && r.expiresAt > now,
      }));
    });
  }
}

export const impersonationService = new ImpersonationService();
