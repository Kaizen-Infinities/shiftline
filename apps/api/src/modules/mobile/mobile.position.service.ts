/**
 * Field-agent position feed (A5). The app buffers GPS points offline and
 * sends them in batches; the office map and the TV wall read the latest point
 * per agent. Positions are personal data: the AGENT_POSITIONS retention class
 * purges them after 90 days by default.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { emitToTenant } from "../../lib/realtime";
import { AgentContext, DeviceInfo, PositionRaw } from "./mobile.types";

export interface LatestPosition {
  agentUserId: string;
  agentName: string;
  deviceId: string | null;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedKmh: number | null;
  heading: number | null;
  batteryPct: number | null;
  recordedAt: string;
  receivedAt: string;
  today: {
    plannedVisits: number;
    completedVisits: number;
    orders: number;
    collections: number;
    collectedAmount: number;
  };
}

const dec = (n: number | null | undefined) => (n == null ? null : new Prisma.Decimal(n));
const num = (v: unknown): number | null => (v == null ? null : Number(v));

class MobilePositionService {
  /** Stores a batch of points and broadcasts the newest one to the tenant's sockets. */
  async record(agent: AgentContext, device: DeviceInfo, points: PositionRaw[]) {
    const agentUserId = agent.userId.slice(0, 36);
    const rows = points.map((p) => ({
      agentUserId,
      deviceId: device.deviceId,
      latitude: new Prisma.Decimal(p.latitude),
      longitude: new Prisma.Decimal(p.longitude),
      accuracyM: dec(p.accuracy_m),
      speedKmh: dec(p.speed_kmh),
      heading: dec(p.heading),
      batteryPct: p.battery_pct ?? null,
      recordedAt: new Date(p.recorded_at),
    }));
    const { count } = await prisma.agentPosition.createMany({ data: rows });

    const newest = points.reduce((a, b) => (b.recorded_at > a.recorded_at ? b : a));
    emitToTenant("agentPosition:updated", {
      agentUserId,
      deviceId: device.deviceId,
      latitude: newest.latitude,
      longitude: newest.longitude,
      speedKmh: newest.speed_kmh ?? null,
      batteryPct: newest.battery_pct ?? null,
      recordedAt: new Date(newest.recorded_at).toISOString(),
    });
    return { stored: count };
  }

  /**
   * Latest point per agent seen within `withinMinutes`, with today's field
   * counters. Raw SQL runs inside the tenant transaction so RLS scopes it.
   */
  async latest(withinMinutes: number): Promise<LatestPosition[]> {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return prisma.$transaction(async (tx) => {
      const points = await tx.$queryRaw<
        {
          agent_user_id: string;
          device_id: string | null;
          latitude: Prisma.Decimal;
          longitude: Prisma.Decimal;
          accuracy_m: Prisma.Decimal | null;
          speed_kmh: Prisma.Decimal | null;
          heading: Prisma.Decimal | null;
          battery_pct: number | null;
          recorded_at: Date;
          received_at: Date;
        }[]
      >`
        SELECT DISTINCT ON (agent_user_id)
          agent_user_id, device_id, latitude, longitude, accuracy_m, speed_kmh, heading,
          battery_pct, recorded_at, received_at
        FROM agent_positions
        WHERE recorded_at >= ${since}
        ORDER BY agent_user_id, recorded_at DESC
      `;
      if (points.length === 0) return [];

      const agentIds = points.map((p) => p.agent_user_id);
      const [users, visits, orders, collections] = await Promise.all([
        tx.user.findMany({
          where: { userId: { in: agentIds } },
          select: { userId: true, fullName: true },
        }),
        tx.mobileVisit.groupBy({
          by: ["agentUserId", "status"],
          where: {
            agentUserId: { in: agentIds },
            plannedDate: { gte: startOfDay },
            deletedAt: null,
          },
          _count: { _all: true },
        }),
        tx.mobileSyncRecord.groupBy({
          by: ["agentUserId"],
          where: {
            agentUserId: { in: agentIds },
            entityType: "ORDER",
            status: "OK",
            createdAt: { gte: startOfDay },
          },
          _count: { _all: true },
        }),
        tx.mobileCollection.groupBy({
          by: ["agentUserId"],
          where: {
            agentUserId: { in: agentIds },
            status: "POSTED",
            collectedAt: { gte: startOfDay },
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);

      const name = new Map(users.map((u) => [u.userId, u.fullName]));
      const planned = new Map<string, number>();
      const completed = new Map<string, number>();
      for (const v of visits) {
        planned.set(v.agentUserId, (planned.get(v.agentUserId) ?? 0) + v._count._all);
        if (v.status === "COMPLETED") completed.set(v.agentUserId, v._count._all);
      }
      const orderCount = new Map(orders.map((o) => [o.agentUserId, o._count._all]));
      const coll = new Map(collections.map((c) => [c.agentUserId, c]));

      return points.map((p) => ({
        agentUserId: p.agent_user_id,
        agentName: name.get(p.agent_user_id) ?? p.agent_user_id,
        deviceId: p.device_id,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        accuracyM: num(p.accuracy_m),
        speedKmh: num(p.speed_kmh),
        heading: num(p.heading),
        batteryPct: p.battery_pct,
        recordedAt: p.recorded_at.toISOString(),
        receivedAt: p.received_at.toISOString(),
        today: {
          plannedVisits: planned.get(p.agent_user_id) ?? 0,
          completedVisits: completed.get(p.agent_user_id) ?? 0,
          orders: orderCount.get(p.agent_user_id) ?? 0,
          collections: coll.get(p.agent_user_id)?._count._all ?? 0,
          collectedAmount: Number(coll.get(p.agent_user_id)?._sum.amount ?? 0),
        },
      }));
    });
  }
}

export const mobilePositionService = new MobilePositionService();
