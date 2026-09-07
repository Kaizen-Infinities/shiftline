import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ageingService } from "../accounts/ageing.service";
import { accountsService } from "../accounts/accounts.service";
import { getTvSummary, type TvSummary } from "../dashboard/dashboard.tv.service";
import { mobilePositionService } from "../mobile/mobile.position.service";

/**
 * Read-only aggregations for the companion app, the TV wall and integrations (P1-05, B3).
 * Every answer is computed from the tenant's own rows and cached for 60 seconds per tenant
 * and endpoint, so a wall of screens polling every few seconds costs one query set a minute.
 */
export const INSIGHTS_TTL_MS = 60 * 1000;

interface Entry {
  value: unknown;
  expiresAt: number;
}
const cache = new Map<string, Entry>();

/** Test hook: forget every cached answer. */
export const resetInsightsCache = () => cache.clear();

export interface Cached<T> {
  value: T;
  hit: boolean;
  /** Seconds until the cached answer is recomputed. */
  ttl: number;
}

const cached = async <T>(key: string, compute: () => Promise<T>): Promise<Cached<T>> => {
  const k = `${requireTenantId()}:${key}`;
  const now = Date.now();
  const hitEntry = cache.get(k);
  if (hitEntry && hitEntry.expiresAt > now) {
    return {
      value: hitEntry.value as T,
      hit: true,
      ttl: Math.ceil((hitEntry.expiresAt - now) / 1000),
    };
  }
  const value = await compute();
  cache.set(k, { value, expiresAt: now + INSIGHTS_TTL_MS });
  return { value, hit: false, ttl: INSIGHTS_TTL_MS / 1000 };
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => Number(v ?? 0) || 0;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const tv = () => cached("tv", getTvSummary);
const receivable = () => cached("ageing.receivable", () => ageingService.receivable({}));
const payable = () => cached("ageing.payable", () => ageingService.payable({}));

const OPEN_PRODUCTION = [
  "CREATED",
  "WAITING_FOR_MATERIAL",
  "READY_FOR_PLANNING",
  "PENDING_PLANNING",
  "PLANNED",
  "IN_PROGRESS",
  "IN_PRODUCTION",
];

class InsightsService {
  /** The TV wall's four scenes in one payload. */
  summary() {
    return cached("summary", async () => {
      const t = (await tv()).value;
      return {
        generatedAt: t.generatedAt,
        sales: t.sales,
        orders: t.orders,
        production: {
          planned: t.production.planned,
          produced: t.production.produced,
          pending: t.production.pending,
          achievement: t.production.achievement,
        },
        pipeline: t.pipeline,
        inventory: {
          healthyPct: t.inventory.healthyPct,
          criticalCount: t.inventory.criticalCount,
          lowCount: t.inventory.lowCount,
          skuTotal: t.inventory.skuTotal,
          finishedUnits: t.inventory.finishedUnits,
        },
        finance: t.finance,
        alerts: t.alerts,
      };
    });
  }

  /** Cash and bank, receivable and payable totals, overdue exposure. */
  accounts() {
    return cached("accounts", async () => {
      const [bank, rec, pay] = await Promise.all([
        accountsService.getBankAccounts(),
        receivable(),
        payable(),
      ]);
      const accounts = (bank.accounts as { name?: string; balance?: unknown }[]).map((a) => ({
        name: a.name ?? "",
        balance: round2(num(a.balance)),
      }));
      return {
        asOnDate: rec.value.asOnDate,
        cashAndBank: { total: round2(num(bank.totalBalance)), accounts },
        receivable: {
          total: rec.value.totals.total,
          overdue: rec.value.totals.overdue,
          parties: rec.value.rows.length,
          overdueParties: rec.value.rows.filter((r) => r.overdue > 0).length,
        },
        payable: {
          total: pay.value.totals.total,
          overdue: pay.value.totals.overdue,
          parties: pay.value.rows.length,
          overdueParties: pay.value.rows.filter((r) => r.overdue > 0).length,
        },
      };
    });
  }

  /** Ageing buckets for both sides with the five largest overdue parties each. */
  ageing() {
    return cached("ageing", async () => {
      const [rec, pay] = await Promise.all([receivable(), payable()]);
      const top = (rows: typeof rec.value.rows) =>
        [...rows]
          .filter((r) => r.overdue > 0)
          .sort((a, b) => b.overdue - a.overdue)
          .slice(0, 5)
          .map((r) => ({
            partyId: r.partyId,
            name: r.name,
            overdue: r.overdue,
            oldestDueDate: r.oldestDueDate,
          }));
      return {
        asOnDate: rec.value.asOnDate,
        buckets: rec.value.buckets,
        receivable: { totals: rec.value.totals, topOverdue: top(rec.value.rows) },
        payable: { totals: pay.value.totals, topOverdue: top(pay.value.rows) },
      };
    });
  }

  /** Who is out, what they have done today, and which devices are quiet. */
  fieldTeam() {
    return cached("field-team", async () => {
      const today = startOfToday();
      const staleBefore = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const [live, devices, staleDevices, visits, collections] = await Promise.all([
        mobilePositionService.latest(30),
        prisma.mobileDevice.count({ where: { revokedAt: null } }),
        prisma.mobileDevice.count({
          where: { revokedAt: null, lastSeenAt: { lt: staleBefore } },
        }),
        prisma.mobileVisit.groupBy({
          by: ["status"],
          where: { plannedDate: { gte: today }, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.mobileCollection.aggregate({
          where: { collectedAt: { gte: today }, deletedAt: null, status: "POSTED" },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);
      return {
        agentsLive: live.length,
        agents: live.map((a) => ({
          userId: a.agentUserId,
          name: a.agentName,
          recordedAt: a.recordedAt,
          latitude: a.latitude,
          longitude: a.longitude,
          batteryPct: a.batteryPct,
        })),
        devices: { active: devices, quietForThreeDays: staleDevices },
        visitsToday: Object.fromEntries(visits.map((v) => [v.status, v._count._all])),
        collectionsToday: {
          count: collections._count._all,
          amount: round2(num(collections._sum.amount)),
        },
      };
    });
  }

  /** Machines by state and production orders by status, with today's output. */
  plant() {
    return cached("plant", async () => {
      const now = new Date();
      const [machines, orders, overdue, t] = await Promise.all([
        prisma.machine.groupBy({
          by: ["machineStatus"],
          where: { isActive: true },
          _count: { _all: true },
        }),
        prisma.productionOrder.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.productionOrder.count({
          where: { status: { in: OPEN_PRODUCTION }, dueDate: { lt: now } },
        }),
        tv(),
      ]);
      return {
        machines: Object.fromEntries(machines.map((m) => [m.machineStatus, m._count._all])),
        productionOrders: {
          byStatus: Object.fromEntries(orders.map((o) => [o.status, o._count._all])),
          open: orders
            .filter((o) => OPEN_PRODUCTION.includes(o.status))
            .reduce((s, o) => s + o._count._all, 0),
          pastDue: overdue,
        },
        today: {
          planned: t.value.production.planned,
          produced: t.value.production.produced,
          achievement: t.value.production.achievement,
          lines: t.value.production.lines,
        },
        downtime: t.value.downtime,
      };
    });
  }

  /** Everything that wants a decision today, ranked. */
  attention() {
    return cached("attention", async () => {
      const staleBefore = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const [t, rec, filings, breakdown, quietDevices] = await Promise.all([
        tv(),
        receivable(),
        prisma.filingApproval.count({ where: { status: "PENDING" } }),
        prisma.machine.count({ where: { isActive: true, machineStatus: "BREAKDOWN" } }),
        prisma.mobileDevice.count({ where: { revokedAt: null, lastSeenAt: { lt: staleBefore } } }),
      ]);
      const items: {
        level: "CRITICAL" | "HIGH" | "MEDIUM";
        key: string;
        text: string;
        count: number;
      }[] = [];
      if (breakdown > 0) {
        items.push({
          level: "CRITICAL",
          key: "machines.breakdown",
          text: `${breakdown} machine${breakdown > 1 ? "s" : ""} in breakdown`,
          count: breakdown,
        });
      }
      if (filings > 0) {
        items.push({
          level: "HIGH",
          key: "filings.pending",
          text: `${filings} filing${filings > 1 ? "s" : ""} awaiting approval`,
          count: filings,
        });
      }
      const overdueParties = rec.value.rows.filter((r) => r.overdue > 0).length;
      if (overdueParties > 0) {
        items.push({
          level: "HIGH",
          key: "receivable.overdue",
          text: `${overdueParties} customer${overdueParties > 1 ? "s" : ""} past due`,
          count: overdueParties,
        });
      }
      if (quietDevices > 0) {
        items.push({
          level: "MEDIUM",
          key: "devices.quiet",
          text: `${quietDevices} field device${quietDevices > 1 ? "s" : ""} silent for three days`,
          count: quietDevices,
        });
      }
      for (const a of t.value.alerts as TvSummary["alerts"]) {
        items.push({ level: a.level, key: "tv.alert", text: a.text, count: 1 });
      }
      const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
      items.sort((a, b) => rank[a.level] - rank[b.level]);
      return { generatedAt: new Date().toISOString(), items };
    });
  }
}

export const insightsService = new InsightsService();
