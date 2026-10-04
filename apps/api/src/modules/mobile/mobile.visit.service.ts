/**
 * Route planning and visits.
 *  - Agents create/update visits on the device (pushed via sync).
 *  - The office plans visits from the web (admin endpoints) or, when nothing
 *    is planned for a day, visits are auto-generated from the route(s)
 *    assigned to the agent for that weekday.
 *
 * Conflict rule for visits (A2): the office owns the planning fields
 * (customer, route, date, time, sequence), the agent owns the execution
 * fields (status, outcome, check-in/out, position, notes). A device update of
 * an existing visit never carries planning fields, whatever cursor it sends;
 * planning is only taken when the device creates a visit that did not exist.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { AgentContext, TOMBSTONE_DAYS, VisitRaw } from "./mobile.types";

const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const todayYmd = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
export const tombstoneCutoff = () => new Date(Date.now() - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000);

const executionData = (raw: VisitRaw) => ({
  status: raw.status,
  outcome: raw.outcome ?? null,
  checkInAt: raw.check_in_at ? new Date(raw.check_in_at) : null,
  checkOutAt: raw.check_out_at ? new Date(raw.check_out_at) : null,
  latitude: raw.latitude == null ? null : new Prisma.Decimal(raw.latitude),
  longitude: raw.longitude == null ? null : new Prisma.Decimal(raw.longitude),
  notes: raw.notes ?? null,
});

const planningData = (raw: VisitRaw) => ({
  customerId: raw.customer_id,
  routeId: raw.route_id ?? null,
  plannedDate: dateOnly(raw.planned_date),
  plannedTime: raw.planned_time ?? null,
  sequence: raw.sequence ?? 0,
});

/** Ids in `ids` that no tenant row matches (one query; the tenant-scoped client hides foreign rows). */
const missing = (ids: Iterable<string>, found: { id: string }[]) => {
  const have = new Set(found.map((r) => r.id));
  return [...new Set(ids)].filter((id) => !have.has(id));
};

class MobileVisitService {
  /** 404 unless every customer id belongs to this tenant. One query. */
  async assertCustomersExist(customerIds: Iterable<string>) {
    const ids = [...new Set(customerIds)];
    if (ids.length === 0) return;
    const found = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (missing(ids, found).length > 0) throw new ApiError(404, "Customer not found");
  }

  /** 404 unless every user id is a user of this tenant. One query. */
  async assertAgentsExist(userIds: Iterable<string>) {
    const ids = [...new Set([...userIds].map((u) => u.slice(0, 36)))];
    if (ids.length === 0) return;
    const found = await prisma.user.findMany({
      where: { userId: { in: ids } },
      select: { userId: true },
    });
    const have = new Set(found.map((u) => u.userId));
    if (ids.some((id) => !have.has(id))) throw new ApiError(404, "Agent not found");
  }

  /**
   * For a push: which customer and route ids on the device's visits exist in this tenant.
   * Two queries at most, whatever the number of visits.
   */
  async knownRefs(visits: VisitRaw[]) {
    const customerIds = [...new Set(visits.map((v) => v.customer_id))];
    const routeIds = [...new Set(visits.map((v) => v.route_id).filter((r): r is string => !!r))];
    const [customers, routes] = await Promise.all([
      customerIds.length
        ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true } })
        : [],
      routeIds.length
        ? prisma.route.findMany({ where: { id: { in: routeIds } }, select: { id: true } })
        : [],
    ]);
    return {
      customers: new Set(customers.map((c) => c.id)),
      routes: new Set(routes.map((r) => r.id)),
    };
  }

  /**
   * Device → server. Only the owning agent may change a visit. Returns whether
   * the device's planning fields were ignored because the office owns them.
   * `refs` (from `knownRefs`) vets the customer and route of a visit being created.
   */
  async upsertFromDevice(
    agent: AgentContext,
    raw: VisitRaw,
    refs?: { customers: Set<string>; routes: Set<string> }
  ): Promise<{ merged: boolean }> {
    const agentId = agent.userId.slice(0, 36);
    const existing = await prisma.mobileVisit.findUnique({ where: { id: raw.id } });
    if (existing && existing.agentUserId !== agentId && !agent.isSuperAdmin) {
      throw new ApiError(403, `Visit ${raw.id} belongs to another agent`);
    }

    if (!existing) {
      if (refs && !refs.customers.has(raw.customer_id)) {
        throw new ApiError(404, `Customer for visit ${raw.id} not found`);
      }
      if (refs && raw.route_id && !refs.routes.has(raw.route_id)) {
        throw new ApiError(404, `Route for visit ${raw.id} not found`);
      }
      await prisma.mobileVisit.create({
        data: {
          id: raw.id,
          agentUserId: agentId,
          ...planningData(raw),
          ...executionData(raw),
          deletedAt: null,
        },
      });
      return { merged: false };
    }

    // Planning fields are office-owned: a device update only ever carries execution fields,
    // so a null, stale or future cursor cannot be used to overwrite the plan.
    const planningDiffers =
      existing.customerId !== raw.customer_id ||
      (existing.routeId ?? null) !== (raw.route_id ?? null) ||
      existing.plannedDate.getTime() !== dateOnly(raw.planned_date).getTime() ||
      (existing.plannedTime ?? null) !== (raw.planned_time ?? null) ||
      existing.sequence !== (raw.sequence ?? 0);
    await prisma.mobileVisit.update({
      where: { id: raw.id },
      data: { ...executionData(raw), deletedAt: null },
    });
    return { merged: planningDiffers };
  }

  /** Soft-deletes the agent's own visits; returns ids that were not theirs. */
  async softDeleteFromDevice(agent: AgentContext, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const agentId = agent.userId.slice(0, 36);
    const owned = await prisma.mobileVisit.findMany({
      where: { id: { in: ids }, agentUserId: agentId },
      select: { id: true },
    });
    const ownedIds = owned.map((v) => v.id);
    if (ownedIds.length > 0) {
      await prisma.mobileVisit.updateMany({
        where: { id: { in: ownedIds } },
        data: { deletedAt: new Date() },
      });
    }
    return ids.filter((id) => !ownedIds.includes(id));
  }

  /**
   * If the agent has no visits for a date but a route is assigned for that
   * weekday, materialise the route into visits (once).
   */
  async ensureAutoPlanned(agentUserId: string, dates: string[] = [todayYmd(0), todayYmd(1)]) {
    const agentId = agentUserId.slice(0, 36);
    const assignments = await prisma.mobileRouteAssignment.findMany({
      where: { agentUserId: agentId, isActive: true },
      include: {
        route: {
          include: {
            mobileRouteCustomers: { where: { deletedAt: null }, orderBy: { sequence: "asc" } },
          },
        },
      },
    });
    if (assignments.length === 0) return;

    for (const ymd of dates) {
      const date = dateOnly(ymd);
      const dow = date.getUTCDay();
      const todays = assignments.filter((a) => a.dayOfWeek === null || a.dayOfWeek === dow);
      if (todays.length === 0) continue;

      const count = await prisma.mobileVisit.count({
        where: { agentUserId: agentId, plannedDate: date, deletedAt: null },
      });
      if (count > 0) continue;

      const rows: Prisma.MobileVisitCreateManyInput[] = [];
      const seen = new Set<string>();
      let seq = 0;
      for (const a of todays) {
        for (const rc of a.route.mobileRouteCustomers) {
          if (seen.has(rc.customerId)) continue;
          seen.add(rc.customerId);
          rows.push({
            id: crypto.randomUUID(),
            agentUserId: agentId,
            customerId: rc.customerId,
            routeId: a.routeId,
            plannedDate: date,
            plannedTime: rc.plannedTime ?? null,
            sequence: rc.sequence || ++seq,
            status: "PLANNED",
          });
        }
      }
      if (rows.length > 0)
        await prisma.mobileVisit.createMany({ data: rows, skipDuplicates: true });
    }
  }

  // ─── Office / admin ────────────────────────────────────────────────────────

  async listRoutes() {
    return prisma.route.findMany({
      orderBy: { routeCode: "asc" },
      include: {
        mobileRouteCustomers: {
          where: { deletedAt: null },
          orderBy: { sequence: "asc" },
          include: {
            customer: { select: { id: true, customerCode: true, firmName: true, status: true } },
          },
        },
        mobileRouteAssignments: true,
      },
    });
  }

  async createRoute(data: { routeCode: string; routeName: string }) {
    return prisma.route.create({ data });
  }

  /**
   * Replaces the route's customer list. Removed customers are soft-deleted so
   * devices receive a tombstone on their next pull.
   */
  async setRouteCustomers(
    routeId: string,
    customers: { customerId: string; sequence: number; plannedTime?: string | null }[]
  ) {
    const route = await prisma.route.findUnique({ where: { id: routeId } });
    if (!route) throw new ApiError(404, "Route not found");
    await this.assertCustomersExist(customers.map((c) => c.customerId));
    await prisma.$transaction(async (tx) => {
      const keep = new Set(customers.map((c) => c.customerId));
      await tx.mobileRouteCustomer.updateMany({
        where: { routeId, customerId: { notIn: [...keep] }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      for (const [idx, c] of customers.entries()) {
        await tx.mobileRouteCustomer.upsert({
          where: { routeId_customerId: { routeId, customerId: c.customerId } },
          create: {
            routeId,
            customerId: c.customerId,
            sequence: c.sequence ?? idx + 1,
            plannedTime: c.plannedTime ?? null,
          },
          update: {
            sequence: c.sequence ?? idx + 1,
            plannedTime: c.plannedTime ?? null,
            deletedAt: null,
          },
        });
      }
    });
    return prisma.mobileRouteCustomer.findMany({
      where: { routeId, deletedAt: null },
      orderBy: { sequence: "asc" },
    });
  }

  async setRouteAssignments(
    routeId: string,
    assignments: { agentUserId: string; dayOfWeek?: number | null }[]
  ) {
    const route = await prisma.route.findUnique({ where: { id: routeId } });
    if (!route) throw new ApiError(404, "Route not found");
    await this.assertAgentsExist(assignments.map((a) => a.agentUserId));
    await prisma.$transaction(async (tx) => {
      await tx.mobileRouteAssignment.deleteMany({ where: { routeId } });
      if (assignments.length > 0) {
        await tx.mobileRouteAssignment.createMany({
          data: assignments.map((a) => ({
            routeId,
            agentUserId: a.agentUserId.slice(0, 36),
            dayOfWeek: a.dayOfWeek ?? null,
          })),
        });
      }
    });
    return prisma.mobileRouteAssignment.findMany({ where: { routeId } });
  }

  async planVisits(input: {
    agentUserId: string;
    plannedDate: string;
    visits: {
      customerId: string;
      plannedTime?: string | null;
      sequence?: number;
      notes?: string | null;
    }[];
  }) {
    const date = dateOnly(input.plannedDate);
    const agentId = input.agentUserId.slice(0, 36);
    await Promise.all([
      this.assertAgentsExist([agentId]),
      this.assertCustomersExist(input.visits.map((v) => v.customerId)),
    ]);
    const existing = await prisma.mobileVisit.findMany({
      where: { agentUserId: agentId, plannedDate: date, deletedAt: null },
      select: { customerId: true, sequence: true },
    });
    const have = new Set(existing.map((e) => e.customerId));
    let seq = existing.reduce((m, e) => Math.max(m, e.sequence), 0);
    const rows = input.visits
      .filter((v) => !have.has(v.customerId))
      .map((v) => ({
        id: crypto.randomUUID(),
        agentUserId: agentId,
        customerId: v.customerId,
        plannedDate: date,
        plannedTime: v.plannedTime ?? null,
        sequence: v.sequence ?? ++seq,
        notes: v.notes ?? null,
        status: "PLANNED",
      }));
    if (rows.length > 0) await prisma.mobileVisit.createMany({ data: rows });
    return prisma.mobileVisit.findMany({
      where: { agentUserId: agentId, plannedDate: date, deletedAt: null },
      orderBy: [{ sequence: "asc" }, { plannedTime: "asc" }],
      include: { customer: { select: { id: true, customerCode: true, firmName: true } } },
    });
  }

  async listVisits(q: { agentUserId?: string; date?: string; from?: string; to?: string }) {
    const where: Prisma.MobileVisitWhereInput = { deletedAt: null };
    if (q.agentUserId) where.agentUserId = q.agentUserId.slice(0, 36);
    if (q.date) where.plannedDate = dateOnly(q.date);
    else if (q.from || q.to) {
      where.plannedDate = {
        ...(q.from ? { gte: dateOnly(q.from) } : {}),
        ...(q.to ? { lte: dateOnly(q.to) } : {}),
      };
    }
    return prisma.mobileVisit.findMany({
      where,
      orderBy: [{ plannedDate: "asc" }, { sequence: "asc" }],
      include: {
        customer: { select: { id: true, customerCode: true, firmName: true, displayName: true } },
        route: { select: { id: true, routeCode: true, routeName: true } },
      },
    });
  }

  /** Users whose role grants the Field app permission (the field team). */
  async listAgents() {
    return prisma.user.findMany({
      where: {
        status: "active",
        role: { rolePermissions: { some: { permission: { key: "mobile-app.view" } } } },
      },
      select: {
        userId: true,
        fullName: true,
        email: true,
        username: true,
        employeeId: true,
        role: { select: { name: true } },
        employee: { select: { empCode: true, mobile: true } },
      },
      orderBy: { fullName: "asc" },
    });
  }
}

export const mobileVisitService = new MobileVisitService();
