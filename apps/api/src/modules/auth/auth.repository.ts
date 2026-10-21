import { prisma } from "../../config/prisma";
import { AuditAction, Prisma } from "@prisma/client";
import { disconnectSession } from "../../lib/realtime";
import { serializeBigInt } from "../../utils/serializeBigInt";
import { UserStatus, CreateAuditLogDto, LoginAttemptDto } from "../../types/auth.types";

interface PrismaUser {
  userId: string;
  companyId: string;
  username: string;
  email: string | null;
  passwordHash: string;
  fullName: string;
  status: UserStatus;
  mustChangePw: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  roleId: number | null;
  role?: {
    code: string;
    name: string;
  } | null;
  createdBy: string | null;
  createdOn: Date;
  updatedOn: Date;
}

export class AuthRepository {
  // ============================================================
  // USER OPERATIONS
  // ============================================================

  async findUserByEmail(email: string): Promise<PrismaUser | null> {
    return prisma.user.findFirst({
      where: { email },
      include: {
        role: { select: { code: true, name: true } },
        employee: { select: { photoUrl: true } },
      },
    }) as Promise<PrismaUser | null>;
  }

  async findUserByUsername(username: string): Promise<PrismaUser | null> {
    return prisma.user.findUnique({
      where: { username },
      include: {
        role: { select: { code: true, name: true } },
        employee: { select: { photoUrl: true } },
      },
    }) as Promise<PrismaUser | null>;
  }

  async findUserById(userId: string): Promise<PrismaUser | null> {
    return prisma.user.findUnique({
      where: { userId },
      include: {
        role: { select: { code: true, name: true } },
        employee: { select: { photoUrl: true } },
      },
    }) as Promise<PrismaUser | null>;
  }

  // ============================================================
  // ADMIN OPERATIONS
  // ============================================================

  async findAdminByEmail(email: string) {
    return prisma.admin.findFirst({
      where: { email },
      include: { role: { select: { code: true, name: true } } },
    });
  }

  async findAdminByUsername(username: string) {
    return prisma.admin.findUnique({
      where: { username },
      include: { role: { select: { code: true, name: true } } },
    });
  }

  async findAdminById(id: bigint) {
    return prisma.admin.findUnique({
      where: { id },
      include: { role: { select: { code: true, name: true } } },
    });
  }

  async updateAdminLastLogin(id: bigint) {
    return prisma.admin.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async createUser(payload: {
    fullName: string;
    email: string;
    username: string;
    passwordHash: string;
    roleId?: string | number;
    employeeId?: bigint;
    createdBy?: string;
  }): Promise<PrismaUser> {
    return prisma.user.create({
      data: {
        fullName: payload.fullName,
        email: payload.email,
        username: payload.username,
        passwordHash: payload.passwordHash,
        roleId: payload.roleId !== undefined ? Number(payload.roleId) : undefined,
        createdBy: payload.createdBy,
      },
      include: { role: { select: { code: true, name: true } } },
    }) as Promise<PrismaUser>;
  }

  // ============================================================
  // ACCOUNT SECURITY
  // ============================================================

  async updateLastLogin(userId: string, ipAddress?: string): Promise<PrismaUser> {
    return prisma.user.update({
      where: { userId },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
        failedAttempts: 0,
      },
    }) as Promise<PrismaUser>;
  }

  async incrementFailedAttempts(
    userId: string,
    lockThreshold = 5,
    lockMinutes = 30
  ): Promise<PrismaUser> {
    const user = await this.findUserById(userId);
    if (!user) throw new Error("User not found");

    const newFailedAttempts = user.failedAttempts + 1;
    const shouldLock = newFailedAttempts >= lockThreshold;

    return prisma.user.update({
      where: { userId },
      data: {
        failedAttempts: newFailedAttempts,
        ...(shouldLock
          ? {
              status: UserStatus.LOCKED,
              lockedUntil: new Date(Date.now() + lockMinutes * 60 * 1000),
            }
          : {}),
      },
    }) as Promise<PrismaUser>;
  }

  async resetFailedAttempts(userId: string): Promise<PrismaUser> {
    return prisma.user.update({
      where: { userId },
      data: { failedAttempts: 0 },
    }) as Promise<PrismaUser>;
  }

  async unlockUser(userId: string): Promise<PrismaUser> {
    return prisma.user.update({
      where: { userId },
      data: {
        status: UserStatus.ACTIVE,
        lockedUntil: null,
        failedAttempts: 0,
      },
    }) as Promise<PrismaUser>;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<PrismaUser> {
    return prisma.user.update({
      where: { userId },
      data: {
        passwordHash,
        mustChangePw: false,
      },
    }) as Promise<PrismaUser>;
  }

  async updateAdminPassword(adminId: bigint, passwordHash: string): Promise<any> {
    return prisma.admin.update({
      where: { id: adminId },
      data: {
        passwordHash,
      },
    });
  }

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  /**
   * Creates a new user session with automatic device limit management.
   * Maximum 4 active sessions per user/admin.
   * Oldest session is automatically removed when limit is exceeded.
   */
  async createUserSession(payload: {
    userId?: string;
    adminId?: bigint;
    sessionToken: string;
    ipAddress?: string;
    userAgent?: string;
    deviceLabel?: string;
    deviceId?: string;
  }): Promise<any> {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const MAX_SESSIONS = 4;

    return prisma.$transaction(async (tx) => {
      // Get all active sessions for this user/admin
      const existingSessions = await tx.userSession.findMany({
        where: {
          ...(payload.userId ? { userId: payload.userId } : {}),
          ...(payload.adminId ? { adminId: payload.adminId } : {}),
          isActive: true,
        },
        orderBy: { loginAt: "asc" }, // Oldest first
      });

      // If at limit, remove the oldest session
      if (existingSessions.length >= MAX_SESSIONS) {
        const sessionsToRemove = existingSessions.slice(
          0,
          existingSessions.length - MAX_SESSIONS + 1
        );
        await tx.userSession.deleteMany({
          where: {
            id: {
              in: sessionsToRemove.map((s) => s.id),
            },
          },
        });
      }

      // Create the new session
      return tx.userSession.create({
        data: {
          userId: payload.userId,
          adminId: payload.adminId,
          sessionToken: payload.sessionToken,
          ipAddress: payload.ipAddress,
          userAgent: payload.userAgent,
          deviceLabel: payload.deviceLabel,
          deviceId: payload.deviceId ?? null,
          loginAt: new Date(),
          expiresAt,
          isActive: true,
        },
      });
    });
  }

  async findUserSession(sessionId: string): Promise<any | null> {
    return prisma.userSession.findUnique({
      where: { id: sessionId, isActive: true },
    });
  }

  async findUserSessionByToken(sessionToken: string): Promise<any | null> {
    return prisma.userSession.findUnique({
      where: { sessionToken, isActive: true },
    });
  }

  async updateSessionLastActivity(sessionId: string): Promise<any> {
    return prisma.userSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  async logoutSession(sessionId: string): Promise<any> {
    const updated = await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        logoutAt: new Date(),
        isActive: false,
      },
    });
    disconnectSession(sessionId);
    return updated;
  }

  /**
   * Ends the matching active sessions and drops the sockets opened with exactly those sessions
   * (the ids are read first so a session that was never revoked keeps its socket).
   */
  private async revokeActiveSessions(where: Prisma.UserSessionWhereInput): Promise<number> {
    const live = await prisma.userSession.findMany({
      where: { ...where, isActive: true },
      select: { id: true },
    });
    if (live.length === 0) return 0;
    const ids = live.map((s) => s.id);
    const result = await prisma.userSession.updateMany({
      where: { id: { in: ids }, isActive: true },
      data: { logoutAt: new Date(), isActive: false },
    });
    for (const id of ids) disconnectSession(id);
    return result.count;
  }

  async logoutAllUserSessions(userId?: string, adminId?: bigint): Promise<number> {
    return this.revokeActiveSessions({
      ...(userId ? { userId } : {}),
      ...(adminId ? { adminId } : {}),
    });
  }

  /** Ends every active session of the user except `keepSessionId` (password change). */
  async logoutOtherUserSessions(userId: string, keepSessionId?: string): Promise<number> {
    return this.revokeActiveSessions({
      userId,
      ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
    });
  }

  async getActiveSessions(userId?: string, adminId?: bigint): Promise<any[]> {
    return prisma.userSession.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(adminId ? { adminId } : {}),
        isActive: true,
      },
      orderBy: { loginAt: "desc" },
    });
  }

  async cleanupExpiredSessions(): Promise<number> {
    const result = await prisma.userSession.updateMany({
      where: {
        expiresAt: { lt: new Date() },
        isActive: true,
      },
      data: {
        isActive: false,
        logoutAt: new Date(),
      },
    });
    return result.count;
  }

  // ============================================================
  // PASSWORD RESET
  // ============================================================

  async createPasswordResetToken(payload: {
    userId?: string;
    adminId?: bigint;
    tokenHash: string;
    requestedIp?: string;
  }): Promise<any> {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    return prisma.passwordResetToken.create({
      data: {
        userId: payload.userId,
        adminId: payload.adminId,
        tokenHash: payload.tokenHash,
        expiresAt,
        requestedIp: payload.requestedIp,
      },
    });
  }

  async findPasswordResetToken(tokenHash: string): Promise<any | null> {
    return prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
  }

  async markPasswordResetTokenAsUsed(tokenId: string): Promise<any> {
    return prisma.passwordResetToken.update({
      where: { id: tokenId },
      data: { usedAt: new Date() },
    });
  }

  async invalidatePasswordResetTokens(userId?: string, adminId?: bigint): Promise<number> {
    const result = await prisma.passwordResetToken.updateMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(adminId ? { adminId } : {}),
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: { usedAt: new Date() },
    });
    return result.count;
  }

  // ============================================================
  // LOGIN ATTEMPTS
  // ============================================================

  async recordLoginAttempt(attempt: LoginAttemptDto): Promise<any> {
    return prisma.loginAttempt.create({
      data: {
        username: attempt.username,
        userId: attempt.userId,
        adminId: attempt.adminId,
        ipAddress: attempt.ipAddress,
        success: attempt.success,
        failureReason: attempt.failureReason,
        userAgent: attempt.userAgent,
      },
    });
  }

  async getRecentFailedAttempts(
    ipAddress: string,
    minutes: number = 15,
    username?: string
  ): Promise<number> {
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const result = await prisma.loginAttempt.count({
      where: {
        ipAddress,
        success: false,
        // Blocked attempts are not failures: counting them would extend the window forever.
        failureReason: { notIn: ["rate_limit_exceeded", "account_locked"] },
        ...(username ? { username: { equals: username, mode: "insensitive" as const } } : {}),
        attemptedAt: {
          gte: since,
        },
      },
    });

    return result;
  }

  // ============================================================
  // PERMISSIONS
  // ============================================================

  /**
   * With `companyId` (every tenant user) only grants of an active role of that company count,
   * so a row planted by another tenant never reaches a token (F01). Platform admins pass none.
   */
  async findPermissionsByRole(roleId?: number | null, companyId?: string): Promise<string[]> {
    if (roleId === undefined || roleId === null) {
      return [];
    }

    const permissions = await prisma.rolePermission.findMany({
      where: {
        roleId,
        ...(companyId ? { companyId, role: { companyId, status: "active" as const } } : {}),
      },
      select: { permission: { select: { key: true } } },
    });

    return permissions.map((p) => p.permission.key);
  }

  // ============================================================
  // AUDIT LOGGING
  // ============================================================

  async createAuditLog(entry: CreateAuditLogDto): Promise<any> {
    return prisma.auditLog.create({
      data: {
        entityName: entry.entityName,
        entityId: entry.entityId,
        action: entry.action as AuditAction,
        oldValues: entry.oldValues ? serializeBigInt(entry.oldValues) : undefined,
        newValues: entry.newValues ? serializeBigInt(entry.newValues) : undefined,
        changedBy: entry.changedBy,
        changedByAdmin: entry.changedByAdmin,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }

  async getAuditLogs(
    filters: {
      entityName?: string;
      entityId?: string;
      action?: string;
      changedBy?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<any[]> {
    const { entityName, entityId, action, changedBy, limit = 100, offset = 0 } = filters;

    return prisma.auditLog.findMany({
      where: {
        ...(entityName && { entityName }),
        ...(entityId && { entityId }),
        ...(action && { action: action as AuditAction }),
        ...(changedBy && { changedBy }),
      },
      orderBy: { changedAt: "desc" },
      take: limit,
      skip: offset,
    });
  }
}

export const authRepository = new AuthRepository();
