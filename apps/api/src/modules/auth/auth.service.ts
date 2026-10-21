import { DEFAULT_LOCALE, toLocale } from "@shiftline/shared";
import { withoutTenant } from "../../lib/tenant-context";
import crypto from "crypto";

import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { sendResendEmail } from "../../utils/resend";
import { generatePasswordResetEmail } from "../../templates/passwordResetEmailTemplate";
import { ApiError } from "../../utils/ApiError";
import { entitlementService } from "../entitlements/entitlement.service";
import { authRepository } from "./auth.repository";
import { assertTenantRole } from "../role-permissions/role-permission.service";
import { hashPassword, comparePassword } from "../../utils/hashPassword";
import { generateAccessToken } from "../../utils/generateAccessToken";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  SESSION_MAX_DAYS,
  hashToken,
  newRefreshToken,
  refreshTtlMs,
  reuseGraceMs,
} from "./refresh-token";
import {
  AccessTokenPayload,
  AuthResult,
  AuthTokens,
  LoginDto,
  RegisterDto,
  UserResponseDto,
  ProfileResponseDto,
  UserStatus,
} from "../../types/auth.types";

const ACCOUNT_LOCK_THRESHOLD = 5;
const ACCOUNT_LOCK_DURATION_MINUTES = 30;
const RATE_LIMIT_THRESHOLD = 10;
const SITE_RATE_LIMIT_THRESHOLD = 100;
const RATE_LIMIT_WINDOW_MINUTES = 15;

export class AuthService {
  // ============================================================
  // AUTHENTICATION
  // ============================================================

  async register(
    payload: RegisterDto,
    ipAddress?: string,
    userAgent?: string
  ): Promise<UserResponseDto> {
    // Check email uniqueness
    const existingEmailUser = await authRepository.findUserByEmail(payload.email);
    if (existingEmailUser) {
      throw new ApiError(409, "Email already registered");
    }

    // Check username uniqueness
    const existingUsernameUser = await authRepository.findUserByUsername(payload.username);
    if (existingUsernameUser) {
      throw new ApiError(409, "Username already taken");
    }

    // Same guards as UserService.create: the role is this tenant's (F01) and a seat is free.
    if (payload.roleId !== undefined && payload.roleId !== null && payload.roleId !== "") {
      await assertTenantRole(Number(payload.roleId));
    }
    await entitlementService.assertSeatAvailable();

    const passwordHash = await hashPassword(payload.password);

    const user = await authRepository.createUser({
      fullName: payload.fullName,
      email: payload.email,
      username: payload.username,
      passwordHash,
      roleId: payload.roleId,
      createdBy: payload.createdBy,
    });
    entitlementService.invalidate();

    await authRepository.createAuditLog({
      entityName: "User",
      entityId: user.userId,
      action: "USER_CREATED",
      newValues: {
        email: user.email,
        username: user.username,
        roleId: user.roleId,
      },
      changedBy: payload.createdBy,
      ipAddress,
      userAgent,
    });

    return this.formatUserResponse(user);
  }

  /** Login runs before any tenant is known, so it reads users across tenants. */
  async login(
    payload: LoginDto,
    ipAddress?: string,
    userAgent?: string,
    deviceId?: string
  ): Promise<AuthResult> {
    return withoutTenant(() => this.loginInner(payload, ipAddress, userAgent, deviceId));
  }

  private async loginInner(
    payload: LoginDto,
    ipAddress?: string,
    userAgent?: string,
    deviceId?: string
  ): Promise<AuthResult> {
    let isAdminLogin = false;
    let admin = await authRepository.findAdminByEmail(payload.email);
    if (!admin) {
      admin = await authRepository.findAdminByUsername(payload.email);
    }

    let user: any = null;
    if (admin) {
      isAdminLogin = true;
      user = {
        userId: "admin_" + admin.id.toString(),
        email: admin.email,
        username: admin.username,
        passwordHash: admin.passwordHash,
        fullName: admin.fullName,
        status: admin.status || "active",
        roleId: admin.roleId || null,
        role: admin.role || null,
        failedAttempts: 0,
        lockedUntil: null,
      };
    } else {
      user = await authRepository.findUserByEmail(payload.email);
      if (!user) {
        user = await authRepository.findUserByUsername(payload.email);
      }
    }

    // Rate limiting: per account from one address (a typo-ing user), plus a larger ceiling per
    // address so one factory network is not locked out by a few people.
    if (ipAddress) {
      const [forAccount, forSite] = await Promise.all([
        authRepository.getRecentFailedAttempts(ipAddress, RATE_LIMIT_WINDOW_MINUTES, payload.email),
        authRepository.getRecentFailedAttempts(ipAddress, RATE_LIMIT_WINDOW_MINUTES),
      ]);

      if (forAccount >= RATE_LIMIT_THRESHOLD || forSite >= SITE_RATE_LIMIT_THRESHOLD) {
        await authRepository.recordLoginAttempt({
          username: payload.email,
          ipAddress,
          success: false,
          failureReason: "rate_limit_exceeded",
          userAgent,
        });

        throw new ApiError(
          429,
          "Too many sign-in attempts. Please wait a few minutes and try again.",
          "RATE_LIMITED",
          { retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 }
        );
      }
    }

    // A suspended tenant refuses every login with the tenant code (P1-02 console).
    if (user && !isAdminLogin && user.companyId) {
      const company = await prisma.company.findUnique({
        where: { id: user.companyId },
        select: { isActive: true },
      });
      if (company && !company.isActive) {
        throw new ApiError(403, "This company is suspended; contact Shiftline", "TENANT_SUSPENDED");
      }
    }

    if (user && user.status === UserStatus.LOCKED) {
      const lockedUntil: Date | null = user.lockedUntil ?? null;
      if (lockedUntil && lockedUntil.getTime() <= Date.now()) {
        // The lock window has passed: unlock and let this attempt proceed.
        await authRepository.unlockUser(user.userId);
        user.status = UserStatus.ACTIVE;
      } else {
        await authRepository.recordLoginAttempt({
          username: payload.email,
          ipAddress: ipAddress ?? "unknown",
          success: false,
          failureReason: "account_locked",
          userAgent,
        });
        throw new ApiError(
          423,
          "This account is temporarily locked after too many failed sign-in attempts. Try again later or ask your administrator to reset it.",
          "ACCOUNT_LOCKED"
        );
      }
    }

    if (!user || user.status !== UserStatus.ACTIVE) {
      await authRepository.recordLoginAttempt({
        username: payload.email,
        ipAddress: ipAddress ?? "unknown",
        success: false,
        failureReason: "invalid_user",
        userAgent,
      });

      throw new ApiError(401, "Invalid email or password");
    }

    // Verify password
    const passwordMatches = await comparePassword(payload.password, user.passwordHash);

    if (!passwordMatches) {
      if (!isAdminLogin) {
        await authRepository.incrementFailedAttempts(
          user.userId,
          ACCOUNT_LOCK_THRESHOLD,
          ACCOUNT_LOCK_DURATION_MINUTES
        );
      }

      // SEC-01: every failed attempt is recorded, admin logins included, so the
      // IP-based rate limiter above sees them.
      await authRepository.recordLoginAttempt({
        username: payload.email,
        ...(isAdminLogin ? { adminId: admin!.id } : { userId: user.userId }),
        ipAddress: ipAddress ?? "unknown",
        success: false,
        failureReason: "invalid_password",
        userAgent,
      });

      await authRepository.createAuditLog({
        entityName: isAdminLogin ? "Admin" : "User",
        entityId: isAdminLogin ? admin!.id.toString() : user.userId,
        action: "LOGIN_FAILED",
        newValues: { reason: "invalid_password" },
        changedBy: isAdminLogin ? undefined : user.userId,
        changedByAdmin: isAdminLogin ? admin!.id : undefined,
        ipAddress,
        userAgent,
      });

      throw new ApiError(401, "Invalid email or password");
    }

    // Successful login
    const permissions = await authRepository.findPermissionsByRole(
      user.roleId,
      isAdminLogin ? undefined : user.companyId
    );
    const roleCode = user.role?.code ?? (user.roleId !== null ? user.roleId.toString() : "");

    // The refresh token is the session secret; only its hash is stored.
    const refreshToken = newRefreshToken();

    // Create session first (automatically manages 4-device limit)
    const session = await authRepository.createUserSession({
      userId: isAdminLogin ? undefined : user.userId,
      adminId: isAdminLogin ? admin!.id : undefined,
      sessionToken: hashToken(refreshToken),
      ipAddress,
      userAgent,
      deviceLabel: this.extractDeviceLabel(userAgent),
      // Native clients bind the session to their device (P1-02 B1).
      deviceId: deviceId?.slice(0, 120),
    });

    // Use the database session ID in the JWT payload
    const accessPayload: AccessTokenPayload = {
      userId: user.userId,
      email: user.email!,
      roleId: roleCode,
      permissions,
      isSuperAdmin: isAdminLogin,
      companyId: isAdminLogin ? null : (user.companyId as string),
      sessionId: session.id, // Use the actual database session ID
    };

    const accessToken = generateAccessToken(accessPayload);

    // Update user
    if (isAdminLogin) {
      await prisma.admin.update({
        where: { id: admin!.id },
        data: { lastLoginAt: new Date() },
      });
    } else {
      await authRepository.updateLastLogin(user.userId, ipAddress);

      await authRepository.recordLoginAttempt({
        username: payload.email,
        userId: user.userId,
        ipAddress: ipAddress ?? "unknown",
        success: true,
        userAgent,
      });
    }

    await authRepository.createAuditLog({
      entityName: isAdminLogin ? "Admin" : "User",
      entityId: isAdminLogin ? admin!.id.toString() : user.userId,
      action: "LOGIN_SUCCESS",
      ipAddress,
      userAgent,
    });

    return {
      user: this.formatUserResponse(user, isAdminLogin),
      tokens: {
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
        refreshToken,
        refreshTokenExpiresAt: session.expiresAt,
      },
      sessionInfo: {
        deviceLabel: session.deviceLabel || "Unknown Device",
        loginAt: session.loginAt,
        expiresAt: session.expiresAt,
      },
    };
  }

  /**
   * Rotates the refresh token and issues a fresh access token with the
   * account's current role and permissions. A token that was already rotated
   * away is a replay: inside the grace window it is treated as a concurrent
   * tab and rotated again; beyond it the whole session is revoked.
   */
  async refresh(
    rawToken: string,
    ipAddress?: string,
    userAgent?: string,
    deviceId?: string
  ): Promise<AuthResult> {
    return withoutTenant(() => this.refreshInner(rawToken, ipAddress, userAgent, deviceId, 0));
  }

  private async refreshInner(
    rawToken: string,
    ipAddress: string | undefined,
    userAgent: string | undefined,
    deviceId: string | undefined,
    attempt: number
  ): Promise<AuthResult> {
    const now = new Date();
    const hash = hashToken(rawToken);
    let session = await prisma.userSession.findFirst({
      where: { sessionToken: hash, isActive: true, expiresAt: { gt: now } },
    });
    // True when this request presents the previous token inside the grace window.
    let graceReplay = false;

    if (!session) {
      const replayed = await prisma.userSession.findFirst({
        where: { prevTokenHash: hash, isActive: true },
      });
      if (!replayed) throw new ApiError(401, "Session expired or invalid");
      const withinGrace =
        replayed.rotatedAt !== null &&
        now.getTime() - replayed.rotatedAt.getTime() <= reuseGraceMs();
      if (!withinGrace) {
        await authRepository.logoutSession(replayed.id);
        await authRepository.createAuditLog({
          entityName: replayed.adminId ? "Admin" : "User",
          entityId: replayed.adminId ? replayed.adminId.toString() : (replayed.userId ?? ""),
          action: "LOGOUT",
          newValues: { reason: "refresh_token_reuse", sessionId: replayed.id },
          changedBy: replayed.userId ?? undefined,
          changedByAdmin: replayed.adminId ?? undefined,
          ipAddress,
          userAgent,
        });
        throw new ApiError(401, "Session revoked: refresh token reuse detected");
      }
      session = replayed;
      graceReplay = true;
    }

    // Device-bound sessions (P1-02 B1): the device must be the same and not revoked.
    if (session.deviceId) {
      if (deviceId !== session.deviceId) {
        throw new ApiError(401, "This session belongs to another device", "DEVICE_MISMATCH");
      }
      if (session.userId) {
        const revoked = await prisma.mobileDevice.findFirst({
          where: { deviceId: session.deviceId, userId: session.userId, revokedAt: { not: null } },
          select: { id: true },
        });
        if (revoked) {
          await authRepository.logoutSession(session.id);
          throw new ApiError(
            403,
            "This device has been revoked; sign out and wipe",
            "DEVICE_REVOKED"
          );
        }
      }
    }

    const isAdminLogin = session.adminId !== null;
    // Same shape login builds, so the token and the profile response match.
    let user: any = null;
    if (isAdminLogin) {
      const admin = await authRepository.findAdminById(session.adminId!);
      if (!admin || (admin.status || "active") !== "active") {
        throw new ApiError(401, "Admin account is not active");
      }
      user = {
        userId: "admin_" + admin.id.toString(),
        email: admin.email,
        username: admin.username,
        fullName: admin.fullName,
        status: admin.status || "active",
        roleId: admin.roleId || null,
        role: admin.role || null,
      };
    } else {
      user = await authRepository.findUserById(session.userId!);
      if (!user || String(user.status) !== String(UserStatus.ACTIVE)) {
        throw new ApiError(401, "Account is not active");
      }
    }

    const permissions = await authRepository.findPermissionsByRole(
      user.roleId,
      session.adminId ? undefined : user.companyId
    );
    const roleCode = user.role?.code ?? (user.roleId !== null ? String(user.roleId) : "");

    const nextRaw = newRefreshToken();
    const absoluteMax = new Date(
      session.loginAt.getTime() + SESSION_MAX_DAYS * 24 * 60 * 60 * 1000
    );
    const sliding = new Date(now.getTime() + refreshTtlMs());
    // Rotation is a compare-and-swap on the token we read, so two requests can never both
    // rotate from the same state. Rule for the grace window (concurrent tabs): the previous
    // token may be replayed exactly once. That use rotates again and clears `rotatedAt`, so any
    // further replay of the old token is outside the grace window and revokes the session.
    // A request that loses the swap (count 0) re-reads the session once: a fresh token that
    // was just rotated away is then handled as a grace replay, a consumed one as reuse.
    const swapped = await prisma.userSession.updateMany({
      where: {
        id: session.id,
        sessionToken: session.sessionToken,
        ...(graceReplay ? { prevTokenHash: hash, rotatedAt: { not: null } } : {}),
      },
      data: {
        sessionToken: hashToken(nextRaw),
        prevTokenHash: hash,
        rotatedAt: graceReplay ? null : now,
        lastUsedAt: now,
        expiresAt: sliding < absoluteMax ? sliding : absoluteMax,
        ...(ipAddress ? { ipAddress } : {}),
      },
    });
    if (swapped.count === 0) {
      if (attempt >= 2) throw new ApiError(401, "Session expired or invalid");
      return this.refreshInner(rawToken, ipAddress, userAgent, deviceId, attempt + 1);
    }

    const accessToken = generateAccessToken({
      userId: user.userId,
      email: user.email!,
      roleId: roleCode,
      permissions,
      isSuperAdmin: isAdminLogin,
      companyId: isAdminLogin ? null : (user.companyId as string),
      sessionId: session.id,
    });

    return {
      user: this.formatUserResponse(user, isAdminLogin),
      tokens: {
        accessToken,
        accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
        refreshToken: nextRaw,
        refreshTokenExpiresAt: sliding < absoluteMax ? sliding : absoluteMax,
      },
      sessionInfo: {
        deviceLabel: session.deviceLabel || "Unknown Device",
        loginAt: session.loginAt,
        expiresAt: sliding < absoluteMax ? sliding : absoluteMax,
      },
    };
  }

  async logout(
    userId: string,
    sessionId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const isAdmin = userId.startsWith("admin_");

    if (sessionId) {
      // Look up the specific session by sessionId (UUID from JWT)
      const session = await prisma.userSession.findFirst({
        where: {
          id: sessionId, // Use the sessionId from JWT to find the exact session
          ...(isAdmin ? { adminId: BigInt(userId.replace("admin_", "")) } : { userId }),
          isActive: true,
        },
      });

      if (session) {
        await authRepository.logoutSession(session.id);
      }
    } else {
      // Fallback: logout all active sessions for this user
      if (isAdmin) {
        const adminId = BigInt(userId.replace("admin_", ""));
        await authRepository.logoutAllUserSessions(undefined, adminId);
      } else {
        await authRepository.logoutAllUserSessions(userId);
      }
    }

    await authRepository.createAuditLog({
      entityName: isAdmin ? "Admin" : "User",
      entityId: isAdmin ? userId.replace("admin_", "") : userId,
      action: "LOGOUT",
      changedBy: isAdmin ? undefined : userId, // Don't pass admin userId to changedBy
      changedByAdmin: isAdmin ? BigInt(userId.replace("admin_", "")) : undefined,
      ipAddress,
      userAgent,
    });
  }

  async logoutAllSessions(userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const isAdmin = userId.startsWith("admin_");

    if (isAdmin) {
      const adminId = BigInt(userId.replace("admin_", ""));
      await authRepository.logoutAllUserSessions(undefined, adminId);
    } else {
      await authRepository.logoutAllUserSessions(userId);
    }

    await authRepository.createAuditLog({
      entityName: isAdmin ? "Admin" : "User",
      entityId: isAdmin ? userId.replace("admin_", "") : userId,
      action: "LOGOUT_ALL_SESSIONS",
      changedBy: isAdmin ? undefined : userId, // Don't pass admin userId to changedBy
      changedByAdmin: isAdmin ? BigInt(userId.replace("admin_", "")) : undefined,
      ipAddress,
      userAgent,
    });
  }

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  async getActiveSessions(userId: string): Promise<any[]> {
    const isAdmin = userId.startsWith("admin_");

    if (isAdmin) {
      const adminId = BigInt(userId.replace("admin_", ""));
      return authRepository.getActiveSessions(undefined, adminId);
    } else {
      return authRepository.getActiveSessions(userId);
    }
  }

  // ============================================================
  // PASSWORD MANAGEMENT
  // ============================================================

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
    ipAddress?: string,
    userAgent?: string,
    currentSessionId?: string
  ): Promise<void> {
    const user = await authRepository.findUserById(userId);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    const passwordMatches = await comparePassword(oldPassword, user.passwordHash);

    if (!passwordMatches) {
      await authRepository.createAuditLog({
        entityName: "User",
        entityId: userId,
        action: "PASSWORD_CHANGE_FAILED",
        newValues: { reason: "invalid_current_password" },
        changedBy: userId,
        ipAddress,
        userAgent,
      });

      throw new ApiError(401, "Current password is incorrect");
    }

    const passwordHash = await hashPassword(newPassword);
    await authRepository.updatePassword(userId, passwordHash);

    // Invalidate all password reset tokens
    await authRepository.invalidatePasswordResetTokens(userId);

    // JWT-02: a new password ends every other session; the caller's own stays signed in.
    await authRepository.logoutOtherUserSessions(userId, currentSessionId);

    await authRepository.createAuditLog({
      entityName: "User",
      entityId: userId,
      action: "PASSWORD_CHANGED",
      changedBy: userId,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Creates a reset token for a real account and emails the link. Returns nothing so callers
   * cannot leak the token; the email goes out after the caller has responded.
   */
  async requestPasswordReset(email: string, ipAddress?: string): Promise<void> {
    return withoutTenant(() => this.requestPasswordResetInner(email, ipAddress));
  }

  private async requestPasswordResetInner(email: string, ipAddress?: string): Promise<void> {
    const user = await authRepository.findUserByEmail(email);

    // Don't reveal if user exists
    if (!user) return;

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(resetToken);

    await authRepository.createPasswordResetToken({
      userId: user.userId,
      tokenHash,
      requestedIp: ipAddress,
    });

    await authRepository.createAuditLog({
      entityName: "User",
      entityId: user.userId,
      action: "PASSWORD_RESET_REQUESTED",
      ipAddress,
    });

    if (!user.email) return;
    const resetUrl = `${env.FRONTEND_URL.replace(/\/+$/, "")}/reset?token=${resetToken}`;
    const mail = generatePasswordResetEmail(resetUrl);
    // Fire and forget: the response must not depend on (or reveal) the send.
    void sendResendEmail({ to: user.email, ...mail }).catch((err) =>
      logger.error({ err }, "Password reset email failed")
    );
  }

  async resetPassword(token: string, newPassword: string, ipAddress?: string): Promise<void> {
    return withoutTenant(() => this.resetPasswordInner(token, newPassword, ipAddress));
  }

  private async resetPasswordInner(
    token: string,
    newPassword: string,
    ipAddress?: string
  ): Promise<void> {
    const tokenHash = this.hashToken(token);
    const resetToken = await authRepository.findPasswordResetToken(tokenHash);

    if (!resetToken || resetToken.usedAt || new Date(resetToken.expiresAt) < new Date()) {
      throw new ApiError(401, "Invalid or expired password reset token");
    }

    const passwordHash = await hashPassword(newPassword);

    if (resetToken.userId) {
      await authRepository.updatePassword(resetToken.userId, passwordHash);
      await authRepository.logoutAllUserSessions(resetToken.userId);
    } else if (resetToken.adminId) {
      await authRepository.updateAdminPassword(resetToken.adminId, passwordHash);
      await authRepository.logoutAllUserSessions(undefined, resetToken.adminId);
    }

    await authRepository.markPasswordResetTokenAsUsed(resetToken.id);

    await authRepository.createAuditLog({
      entityName: resetToken.userId ? "User" : "Admin",
      entityId: resetToken.userId || resetToken.adminId?.toString() || "",
      action: "PASSWORD_RESET_COMPLETED",
      ipAddress,
    });
  }

  // ============================================================
  // USER PROFILE
  // ============================================================

  async getProfile(userId: string): Promise<ProfileResponseDto> {
    if (userId.startsWith("admin_")) {
      const adminId = BigInt(userId.replace("admin_", ""));
      const admin = await authRepository.findAdminById(adminId);
      if (!admin) {
        throw new ApiError(404, "Admin not found");
      }

      const mockedUser = {
        userId: userId,
        email: admin.email,
        username: admin.username,
        fullName: admin.fullName,
        status: admin.status || "active",
        roleId: null,
        role: null,
      };

      return {
        user: this.formatUserResponse(mockedUser, true),
        permissions: [],
        isSuperAdmin: true,
      };
    }

    const user = await authRepository.findUserById(userId);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    const permissions = await authRepository.findPermissionsByRole(user.roleId, user.companyId);

    return {
      user: this.formatUserResponse(user, false),
      permissions,
      isSuperAdmin: false,
      entitlements: await entitlementService.resolve(),
    };
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  private formatUserResponse(user: any, isSuperAdmin: boolean = false): UserResponseDto {
    return {
      userId: user.userId,
      fullName: user.fullName,
      email: user.email,
      username: user.username,
      roleId:
        user.role?.name ??
        (user.roleId !== undefined && user.roleId !== null ? user.roleId.toString() : null),
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: user.mfaEnabled || false,
      avatarUrl:
        user.avatarUrl || user.profilePicture || user.photoUrl || user.employee?.photoUrl || null,
      isSuperAdmin,
      locale: isSuperAdmin ? DEFAULT_LOCALE : toLocale(user.locale),
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private extractDeviceLabel(userAgent?: string): string {
    if (!userAgent) return "Unknown Device";

    if (userAgent.includes("Chrome")) return "Chrome";
    if (userAgent.includes("Firefox")) return "Firefox";
    if (userAgent.includes("Safari")) return "Safari";
    if (userAgent.includes("Edge")) return "Edge";
    if (userAgent.includes("Mobile")) return "Mobile";
    if (userAgent.includes("Tablet")) return "Tablet";

    return "Unknown Device";
  }

  private getLoginFailureReason(user: any | null, fallback?: string): string {
    if (!user) return "invalid_user";
    if (user.status === UserStatus.LOCKED) return "account_locked";
    if (user.status === UserStatus.SUSPENDED) return "account_suspended";
    return fallback || "invalid_credentials";
  }
}

export const authService = new AuthService();
