/**
 * WatermelonDB-compatible sync endpoint implementation.
 *
 *  pull(lastPulledAt) → { changes: { <table>: { created, updated, deleted } }, timestamp }
 *  push(changes)      → applies device-created visits / collections / orders
 *
 * Server-owned tables (customers, invoices, products, routes, route_customers)
 * are pull-only. Device-owned tables round-trip: the device pushes them, the
 * server posts them into the ERP and echoes the result (receipt/order numbers,
 * status, errors) back on the next pull. See mobile.types.ts for the conflict
 * policy this file enforces.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { receivableService } from "../accounts/receivable.service";
import {
  collectionToRaw,
  customerToRaw,
  failedCollectionToRaw,
  invoiceBalance,
  invoiceToRaw,
  num,
  orderToRaw,
  productToRaw,
  routeCustomerToRaw,
  routeToRaw,
  visitToRaw,
} from "./mobile.mappers";
import { mobileCollectionService } from "./mobile.collection.service";
import { mobileOrderService } from "./mobile.order.service";
import { mobileVisitService, tombstoneCutoff } from "./mobile.visit.service";
import {
  APPEND_ONLY_TABLES,
  AgentContext,
  DeviceInfo,
  PullResponse,
  PushBody,
  PushResults,
  SERVER_OWNED_TABLES,
  SyncRejection,
  SyncWarning,
  TableChanges,
} from "./mobile.types";

const empty = <T>(): TableChanges<T> => ({ created: [], updated: [], deleted: [] });
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Incremental pulls older than this are treated as full pulls (keeps balances honest). */
const FULL_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const OPEN_INVOICE_HISTORY_DAYS = 180;
const VISIT_HISTORY_DAYS = 30;
const COLLECTION_HISTORY_DAYS = 90;

type Changed = { created?: unknown[]; updated?: unknown[]; deleted?: unknown[] };
const idsOf = (c: Changed | undefined): string[] => {
  if (!c) return [];
  const out: string[] = [];
  for (const row of [...(c.created ?? []), ...(c.updated ?? [])]) {
    const id = (row as { id?: unknown })?.id;
    if (typeof id === "string") out.push(id);
  }
  for (const id of c.deleted ?? []) if (typeof id === "string") out.push(id);
  return out;
};
const hasChanges = (c: Changed | undefined) =>
  !!c && (c.created?.length || c.updated?.length || c.deleted?.length);

class MobileSyncService {
  async pull(
    agent: AgentContext,
    lastPulledAt: number | null,
    forceFull = false
  ): Promise<PullResponse> {
    const timestamp = Date.now();
    const full = forceFull || !lastPulledAt || timestamp - lastPulledAt > FULL_REFRESH_AFTER_MS;
    const since = full ? null : new Date(lastPulledAt as number);
    const agentId = agent.userId.slice(0, 36);

    await mobileVisitService.ensureAutoPlanned(agentId);

    const [customers, invoices, products, routes, routeCustomers, visits, collections, orders] =
      await Promise.all([
        this.pullCustomers(since),
        this.pullInvoices(since),
        this.pullProducts(since),
        prisma.route.findMany({ orderBy: { routeCode: "asc" } }),
        this.pullRouteCustomers(since),
        this.pullVisits(agentId, since),
        this.pullCollections(agentId, since),
        this.pullOrders(agentId, since),
      ]);

    return {
      changes: {
        customers,
        invoices,
        products,
        routes: { created: [], updated: routes.map(routeToRaw), deleted: [] },
        route_customers: routeCustomers,
        visits,
        collections,
        orders,
      },
      timestamp,
      full,
    };
  }

  // ─── Customers ─────────────────────────────────────────────────────────────

  private async pullCustomers(since: Date | null) {
    const include = {
      addresses: true,
      customerGrade: { select: { name: true } },
      customerType: { select: { name: true } },
    } as const;

    type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof include }>;
    let rows: CustomerRow[];
    if (!since) {
      rows = await prisma.customer.findMany({ where: { deletedAt: null }, include });
    } else {
      // Balances move without the customer row changing: include customers whose
      // invoices / receipts / ledger entries changed since the last pull.
      const ids = new Set<string>();
      const [changed, invs, cols, vouchers] = await Promise.all([
        prisma.customer.findMany({ where: { updatedAt: { gt: since } }, select: { id: true } }),
        prisma.salesInvoice.findMany({
          where: { updatedAt: { gt: since } },
          select: { customerId: true },
        }),
        prisma.mobileCollection.findMany({
          where: { updatedAt: { gt: since } },
          select: { customerId: true },
        }),
        prisma.voucher.findMany({
          where: { createdAt: { gt: since } },
          select: {
            items: {
              select: {
                debitLedger: { select: { customerId: true } },
                creditLedger: { select: { customerId: true } },
              },
            },
          },
        }),
      ]);
      changed.forEach((c) => ids.add(c.id));
      invs.forEach((i) => ids.add(i.customerId));
      cols.forEach((c) => ids.add(c.customerId));
      vouchers.forEach((v) =>
        v.items.forEach((it) => {
          if (it.debitLedger?.customerId) ids.add(it.debitLedger.customerId);
          if (it.creditLedger?.customerId) ids.add(it.creditLedger.customerId);
        })
      );
      rows = ids.size
        ? await prisma.customer.findMany({ where: { id: { in: [...ids] } }, include })
        : [];
    }

    const balances = await this.customerBalances(
      rows.map((r) => r.id),
      !since
    );
    const out = empty<ReturnType<typeof customerToRaw>>();
    for (const c of rows) {
      if (c.deletedAt) out.deleted.push(c.id);
      else out.updated.push(customerToRaw(c, balances.get(c.id) ?? this.fallbackBalance(c)));
    }
    return out;
  }

  /** Ledger-based net balance per customer (same figure the web Receivable page shows). */
  private async customerBalances(ids: string[], all: boolean) {
    const map = new Map<string, number>();
    if (ids.length === 0) return map;
    try {
      if (all || ids.length > 25) {
        const summaries = await receivableService.getReceivableSummaries({});
        summaries.forEach((s) => map.set(s.customerId, s.netBalance));
      } else {
        await Promise.all(
          ids.map(async (id) => {
            const s = await receivableService.getReceivableSummaries({ customerId: id });
            if (s[0]) map.set(id, s[0].netBalance);
          })
        );
      }
    } catch {
      // Fall back to invoice-based balances below.
    }
    return map;
  }

  private fallbackBalance(c: {
    openingBalance: Prisma.Decimal | number | null;
    openingBalanceType: string | null;
    outstandingAmount: Prisma.Decimal | number | null;
  }) {
    const opBal = num(c.openingBalance);
    const signed =
      String(c.openingBalanceType || "DEBIT").toUpperCase() === "CREDIT" ? -opBal : opBal;
    return signed + num(c.outstandingAmount);
  }

  // ─── Invoices ──────────────────────────────────────────────────────────────

  private async pullInvoices(since: Date | null) {
    const where: Prisma.SalesInvoiceWhereInput = since
      ? { updatedAt: { gt: since } }
      : {
          OR: [
            { status: { not: "PAID" } },
            { invoiceDate: { gte: daysAgo(OPEN_INVOICE_HISTORY_DAYS) } },
          ],
        };
    const rows = await prisma.salesInvoice.findMany({
      where,
      select: {
        id: true,
        invoiceNo: true,
        customerId: true,
        invoiceDate: true,
        dueDate: true,
        grandTotal: true,
        subTotal: true,
        payments: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const out = empty<ReturnType<typeof invoiceToRaw>>();
    for (const inv of rows) {
      const { balance } = invoiceBalance(inv);
      // Fully-settled old invoices drop off the device on a full refresh.
      if (!since && balance <= 0 && inv.invoiceDate < daysAgo(OPEN_INVOICE_HISTORY_DAYS)) continue;
      out.updated.push(invoiceToRaw(inv));
    }
    return out;
  }

  // ─── Products ──────────────────────────────────────────────────────────────

  private async pullProducts(since: Date | null) {
    const rows = await prisma.product.findMany({
      where: since ? { updatedAt: { gt: since } } : { isActive: true },
      select: {
        id: true,
        productCode: true,
        productName: true,
        rate: true,
        gradeRates: true,
        isActive: true,
        updatedAt: true,
        uom: { select: { uomName: true, uomCode: true } },
        category: { select: { name: true } },
      },
    });
    const out = empty<ReturnType<typeof productToRaw>>();
    for (const p of rows) {
      if (!p.isActive) out.deleted.push(String(p.id));
      else out.updated.push(productToRaw(p));
    }
    return out;
  }

  // ─── Route customers (with tombstones) ─────────────────────────────────────

  private async pullRouteCustomers(since: Date | null) {
    const rows = await prisma.mobileRouteCustomer.findMany({
      where: since
        ? { OR: [{ deletedAt: null }, { deletedAt: { gte: since } }] }
        : { OR: [{ deletedAt: null }, { deletedAt: { gte: tombstoneCutoff() } }] },
      orderBy: { sequence: "asc" },
    });
    const out = empty<ReturnType<typeof routeCustomerToRaw>>();
    for (const rc of rows) {
      if (rc.deletedAt) out.deleted.push(rc.id);
      else out.updated.push(routeCustomerToRaw(rc));
    }
    return out;
  }

  // ─── Visits / collections / orders (agent-scoped) ──────────────────────────

  private async pullVisits(agentId: string, since: Date | null) {
    const rows = await prisma.mobileVisit.findMany({
      where: since
        ? { agentUserId: agentId, updatedAt: { gt: since } }
        : {
            agentUserId: agentId,
            OR: [
              { deletedAt: null, plannedDate: { gte: daysAgo(VISIT_HISTORY_DAYS) } },
              { deletedAt: { gte: tombstoneCutoff() } },
            ],
          },
      orderBy: [{ plannedDate: "asc" }, { sequence: "asc" }],
    });
    const out = empty<ReturnType<typeof visitToRaw>>();
    for (const v of rows) {
      if (v.deletedAt) out.deleted.push(v.id);
      else out.updated.push(visitToRaw(v));
    }
    return out;
  }

  private async pullCollections(agentId: string, since: Date | null) {
    const rows = await prisma.mobileCollection.findMany({
      where: since
        ? { agentUserId: agentId, updatedAt: { gt: since } }
        : { agentUserId: agentId, collectedAt: { gte: daysAgo(COLLECTION_HISTORY_DAYS) } },
      orderBy: { collectedAt: "desc" },
    });
    // Failures that never produced a row (unknown customer) live only in the sync map.
    const failed = await prisma.mobileSyncRecord.findMany({
      where: {
        agentUserId: agentId,
        entityType: "COLLECTION",
        status: "FAILED",
        payload: { not: Prisma.DbNull },
        ...(since
          ? { updatedAt: { gt: since } }
          : { createdAt: { gte: daysAgo(COLLECTION_HISTORY_DAYS) } }),
      },
    });
    const have = new Set(rows.map((r) => r.id));
    const updated = [
      ...rows.map(collectionToRaw),
      ...failed.filter((f) => !have.has(f.clientId)).map(failedCollectionToRaw),
    ];
    return { created: [], updated, deleted: [] as string[] };
  }

  private async pullOrders(agentId: string, since: Date | null) {
    const records = await prisma.mobileSyncRecord.findMany({
      where: {
        agentUserId: agentId,
        entityType: "ORDER",
        createdAt: { gte: daysAgo(COLLECTION_HISTORY_DAYS) },
      },
    });
    if (records.length === 0) return empty<ReturnType<typeof orderToRaw>>();

    const serverIds = records
      .map((r) => Number(r.serverId))
      .filter((n) => Number.isFinite(n) && n > 0);
    const orders = serverIds.length
      ? await prisma.salesOrder.findMany({
          where: { id: { in: serverIds } },
          select: {
            id: true,
            orderNo: true,
            status: true,
            netAmount: true,
            orderDate: true,
            customerId: true,
            updatedAt: true,
          },
        })
      : [];
    const byId = new Map(orders.map((o) => [String(o.id), o]));

    const out = empty<ReturnType<typeof orderToRaw>>();
    for (const r of records) {
      const order = r.serverId ? (byId.get(r.serverId) ?? null) : null;
      if (since) {
        const changed = r.updatedAt > since || (order && order.updatedAt > since);
        if (!changed) continue;
      }
      out.updated.push(orderToRaw(r, order));
    }
    return out;
  }

  // ─── Push ──────────────────────────────────────────────────────────────────

  async push(
    agent: AgentContext,
    body: PushBody,
    device: DeviceInfo | null,
    warnings: SyncWarning[] = []
  ): Promise<PushResults> {
    const companyId = requireTenantId();
    const results: PushResults = {
      visits: { ok: 0, merged: [], failed: [] },
      collections: [],
      orders: [],
      rejected: [],
      warnings,
      serverTime: Date.now(),
    };
    const reject = (table: string, reason: SyncRejection["reason"], ids: string[]) => {
      if (ids.length === 0) return;
      results.rejected.push({ table, reason, ids });
    };

    // Server-owned tables never accept device changes.
    for (const table of SERVER_OWNED_TABLES) {
      const c = body.changes[table] as Changed | undefined;
      if (hasChanges(c)) reject(table, "server-owned", idsOf(c));
    }
    // Device-created documents are append-only.
    for (const table of APPEND_ONLY_TABLES) {
      const c = body.changes[table];
      if (!c) continue;
      const ids = [...c.updated.map((r) => r.id), ...c.deleted];
      reject(table, "append-only", ids);
    }

    const visits = body.changes.visits;
    if (visits) {
      const pushed = [...visits.created, ...visits.updated];
      const refs = pushed.length ? await mobileVisitService.knownRefs(pushed) : undefined;
      for (const v of pushed) {
        try {
          const { merged } = await mobileVisitService.upsertFromDevice(agent, v, refs);
          results.visits.ok++;
          if (merged) results.visits.merged.push(v.id);
        } catch (err: unknown) {
          results.visits.failed.push({
            id: v.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const notOwned = await mobileVisitService.softDeleteFromDevice(agent, visits.deleted);
      reject("visits", "not-owner", notOwned);
    }

    const collections = body.changes.collections;
    if (collections) {
      for (const c of collections.created) {
        const seen = await prisma.mobileSyncRecord.findUnique({
          where: { companyId_clientId: { companyId, clientId: c.id } },
        });
        if (seen?.status === "OK") {
          results.collections.push({ id: c.id, status: "SKIPPED" });
          continue;
        }
        try {
          const posted = await mobileCollectionService.post(agent, c, device);
          results.collections.push({ id: c.id, status: "POSTED", receiptNo: posted.receiptNo });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await mobileCollectionService.recordFailure(agent, c, message, device);
          results.collections.push({ id: c.id, status: "FAILED", error: message });
        }
      }
    }

    const orders = body.changes.orders;
    if (orders) {
      for (const o of orders.created) {
        const seen = await prisma.mobileSyncRecord.findUnique({
          where: { companyId_clientId: { companyId, clientId: o.id } },
        });
        if (seen?.status === "OK") {
          results.orders.push({ id: o.id, status: "SKIPPED" });
          continue;
        }
        try {
          const order = await mobileOrderService.create(agent, o, device);
          results.orders.push({ id: o.id, status: "CREATED", orderNo: order?.orderNo });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await mobileOrderService.recordFailure(agent, o, message, device);
          results.orders.push({ id: o.id, status: "FAILED", error: message });
        }
      }
    }

    return results;
  }
}

export const mobileSyncService = new MobileSyncService();
