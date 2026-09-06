/**
 * Device registry for the Field app. Every sync, push and position call
 * identifies its device; the first call registers it, later calls refresh
 * `lastSeenAt`. Revoking a device (lost phone) makes the app's next call fail
 * with 403 DEVICE_REVOKED so it can wipe its local database. Device-bound
 * refresh tokens and remote wipe arrive with P1-02.
 */
import type { Request } from "express";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import {
  AgentContext,
  CLOCK_SKEW_TOLERANCE_MS,
  DeviceInfo,
  SyncWarning,
  deviceHeadersSchema,
} from "./mobile.types";

export const DEVICE_REVOKED = "DEVICE_REVOKED";

class MobileDeviceService {
  /** Reads the device headers; throws 400 when `required` and no device id was sent. */
  fromRequest(req: Request, required: boolean): DeviceInfo | null {
    const h = deviceHeadersSchema.parse({
      "x-device-id": req.header("x-device-id"),
      "x-app-version": req.header("x-app-version"),
      "x-device-platform": req.header("x-device-platform"),
      "x-device-model": req.header("x-device-model"),
      "x-device-time": req.header("x-device-time"),
    });
    const deviceId = h["x-device-id"];
    if (!deviceId) {
      if (required) throw new ApiError(400, "x-device-id header is required");
      return null;
    }
    return {
      deviceId,
      appVersion: h["x-app-version"],
      platform: h["x-device-platform"],
      model: h["x-device-model"],
      deviceTime: h["x-device-time"],
    };
  }

  /**
   * Registers or refreshes the device for this agent and refuses revoked ones.
   * A device previously used by another agent of the same tenant is re-bound
   * to the caller (phones get handed over); the change is visible in the list.
   */
  async touch(agent: AgentContext, info: DeviceInfo, opts: { sync?: boolean } = {}) {
    const companyId = requireTenantId();
    const userId = agent.userId.slice(0, 36);
    const now = new Date();
    const device = await prisma.mobileDevice.upsert({
      where: { companyId_deviceId: { companyId, deviceId: info.deviceId } },
      create: {
        companyId,
        deviceId: info.deviceId,
        userId,
        appVersion: info.appVersion ?? null,
        platform: info.platform ?? null,
        model: info.model ?? null,
        lastSeenAt: now,
        lastSyncAt: opts.sync ? now : null,
      },
      update: {
        userId,
        lastSeenAt: now,
        ...(info.appVersion ? { appVersion: info.appVersion } : {}),
        ...(info.platform ? { platform: info.platform } : {}),
        ...(info.model ? { model: info.model } : {}),
        ...(opts.sync ? { lastSyncAt: now } : {}),
      },
    });
    if (device.revokedAt) {
      throw new ApiError(403, DEVICE_REVOKED);
    }
    return device;
  }

  /** CLOCK_SKEW when the device clock is more than five minutes off. */
  clockSkewWarning(info: DeviceInfo | null, serverTime = Date.now()): SyncWarning | null {
    if (!info?.deviceTime) return null;
    const skewMs = info.deviceTime - serverTime;
    if (Math.abs(skewMs) <= CLOCK_SKEW_TOLERANCE_MS) return null;
    const minutes = Math.round(Math.abs(skewMs) / 60000);
    return {
      code: "CLOCK_SKEW",
      skewMs,
      message: `Device clock is ${minutes} min ${skewMs > 0 ? "ahead of" : "behind"} the server; timestamps are stored as sent.`,
    };
  }

  // ─── Office / admin ────────────────────────────────────────────────────────

  async list(q: { userId?: string; includeRevoked?: boolean }) {
    const rows = await prisma.mobileDevice.findMany({
      where: {
        ...(q.userId ? { userId: q.userId.slice(0, 36) } : {}),
        ...(q.includeRevoked ? {} : { revokedAt: null }),
      },
      orderBy: { lastSeenAt: "desc" },
    });
    const userIds = [...new Set(rows.map((r) => r.userId))].filter(
      (id) => !id.startsWith("admin_")
    );
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, fullName: true, username: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.userId, u]));
    return rows.map((r) => ({
      ...r,
      agentName:
        byId.get(r.userId)?.fullName ??
        (r.userId.startsWith("admin_") ? "Platform admin" : r.userId),
      agentUsername: byId.get(r.userId)?.username ?? null,
    }));
  }

  async revoke(id: string, revokedBy: string | undefined) {
    const device = await prisma.mobileDevice.findUnique({ where: { id } });
    if (!device) throw new ApiError(404, "Device not found");
    if (device.revokedAt) return device;
    return prisma.mobileDevice.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy: revokedBy?.slice(0, 36) ?? null },
    });
  }

  async restore(id: string) {
    const device = await prisma.mobileDevice.findUnique({ where: { id } });
    if (!device) throw new ApiError(404, "Device not found");
    return prisma.mobileDevice.update({
      where: { id },
      data: { revokedAt: null, revokedBy: null },
    });
  }
}

export const mobileDeviceService = new MobileDeviceService();
