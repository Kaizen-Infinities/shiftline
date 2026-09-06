import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";
import { JwtPayload } from "../types/auth.types";
import { prisma } from "../config/prisma";
import { tenantStorage, withoutTenant } from "../lib/tenant-context";

export const authMiddleware = async (req: Request, _res: Response, next: NextFunction) => {
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

    // Session, account and permission checks read across tenants (the tenant is not known yet).
    const resolved = await withoutTenant(async () => {
      // Verify the specific session is still active
      const session = await prisma.userSession.findFirst({
        where: {
          id: decoded.sessionId,
          ...(isAdmin
            ? { adminId: BigInt(decoded.userId.replace("admin_", "")) }
            : { userId: decoded.userId }),
          isActive: true,
          expiresAt: { gt: new Date() },
        },
      });

      if (!session) {
        throw new ApiError(401, "Session expired or invalid");
      }
      let companyId: string | null = null;

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
          select: { status: true, roleId: true, companyId: true },
        });

        if (!user || user.status !== "active") {
          throw new ApiError(401, "Account is suspended or inactive");
        }
        companyId = user.companyId;

        if (user.roleId) {
          const rolePermissions = await prisma.rolePermission.findMany({
            where: { roleId: user.roleId },
            select: { permission: { select: { key: true } } },
          });
          decoded.permissions = rolePermissions.map((p) => p.permission.key);
        }
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
      },
      () => next()
    );
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    return next(new ApiError(401, "Invalid or Expired Token"));
  }
};
