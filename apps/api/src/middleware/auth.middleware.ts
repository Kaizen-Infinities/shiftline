import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import { ApiError } from "../utils/ApiError";
import { logger } from "../lib/logger";
import { env } from "../config/env";
import { JwtPayload } from "../types/auth.types";
import { prisma } from "../config/prisma";
import { tenantStorage, withoutTenant } from "../lib/tenant-context";
import { enforceTenantApiCap } from "../lib/tenant-rate-limit";
import { impersonationService } from "../modules/platform/impersonation.service";

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return next(new ApiError(401, "Access token is required"));
    }

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    if (!decoded?.userId || !Array.isArray(decoded?.permissions) || !decoded?.sessionId) {
      return next(new ApiError(401, "Invalid token payload"));
    }

    const isAdmin = decoded.userId.startsWith("admin_");
    // An impersonation token names a tenant user but rides on the admin's session (P1-02).
    const impersonating = Boolean(decoded.impersonatedBy && decoded.impersonationId);
    const sessionOwner = impersonating ? decoded.impersonatedBy! : decoded.userId;
    const ownerIsAdmin = sessionOwner.startsWith("admin_");

    // Session, account and permission checks read across tenants (the tenant is not known yet).
    const resolved = await withoutTenant(async () => {
      // Verify the specific session is still active
      const session = await prisma.userSession.findFirst({
        where: {
          id: decoded.sessionId,
          ...(ownerIsAdmin
            ? { adminId: BigInt(sessionOwner.replace("admin_", "")) }
            : { userId: sessionOwner }),
          isActive: true,
          expiresAt: { gt: new Date() },
        },
      });

      if (!session) {
        throw new ApiError(401, "Session expired or invalid");
      }
      // A refresh token bound to a device only serves requests from that device (P1-02 B1).
      if (session.deviceId && req.header("x-device-id") !== session.deviceId) {
        throw new ApiError(401, "This session belongs to another device", "DEVICE_MISMATCH");
      }
      let companyId: string | null = null;

      if (impersonating) {
        const live = await impersonationService.active(decoded.impersonationId!, sessionOwner);
        if (!live || live.userId !== decoded.userId) {
          throw new ApiError(401, "Impersonation has ended", "IMPERSONATION_ENDED");
        }
        const admin = await prisma.admin.findUnique({
          where: { id: live.adminId },
          select: { status: true },
        });
        if (!admin || admin.status !== "active") {
          throw new ApiError(401, "Admin account is suspended or inactive");
        }
      }

      // Verify user/admin account is still active
      if (isAdmin) {
        const adminId = BigInt(decoded.userId.replace("admin_", ""));
        const admin = await prisma.admin.findUnique({
          where: { id: adminId },
          select: { status: true },
        });
        if (!admin || admin.status !== "active") {
          throw new ApiError(401, "Admin account is suspended or inactive");
        }
        // Platform admins act on a tenant only when they name one.
        const header = req.header("x-company-id");
        if (header) {
          const company = await prisma.company.findUnique({
            where: { id: header },
            select: { id: true },
          });
          if (!company) throw new ApiError(400, "Unknown company in X-Company-Id");
          companyId = company.id;
        }
      } else {
        const user = await prisma.user.findUnique({
          where: { userId: decoded.userId },
          select: {
            status: true,
            roleId: true,
            companyId: true,
            company: { select: { isActive: true } },
            // One query for the account and its role grants (hot path). Rows are re-checked
            // against the user's own company below because this read runs across tenants.
            role: {
              select: {
                companyId: true,
                status: true,
                rolePermissions: {
                  select: { companyId: true, permission: { select: { key: true } } },
                },
              },
            },
          },
        });

        if (!user || user.status !== "active") {
          throw new ApiError(401, "Account is suspended or inactive");
        }
        // A suspended tenant keeps its data but nobody in it can sign in (P1-02 console).
        if (user.company && !user.company.isActive) {
          throw new ApiError(
            403,
            "This company is suspended; contact Shiftline",
            "TENANT_SUSPENDED"
          );
        }
        companyId = user.companyId;

        // Fail closed (JWT-01): whatever the token claims, a tenant user's effective permissions
        // start empty and come only from an active role and grants of the user's own company.
        const role = user.role;
        decoded.permissions =
          role && role.status === "active" && role.companyId === user.companyId
            ? role.rolePermissions
                .filter((rp) => rp.companyId === user.companyId)
                .map((rp) => rp.permission.key)
            : [];
      }
      return { companyId };
    });

    decoded.companyId = resolved.companyId;
    req.user = decoded;

    // Everything downstream runs inside the tenant context.
    return tenantStorage.run(
      {
        companyId: resolved.companyId,
        userId: decoded.userId,
        isSuperAdmin: !!decoded.isSuperAdmin,
        ...(impersonating && { impersonatedBy: decoded.impersonatedBy }),
      },
      () => {
        // Plan API cap (P1-01) counts every authenticated request of the tenant.
        enforceTenantApiCap(req, res).then(() => next(), next);
      }
    );
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    // A bad or expired JWT is the normal case; anything else is worth a line in the log.
    if (!(err instanceof Error) || !/jwt|token/i.test(err.name + err.message)) {
      logger.warn({ err }, "auth middleware failed");
    }
    return next(new ApiError(401, "Invalid or Expired Token"));
  }
};
