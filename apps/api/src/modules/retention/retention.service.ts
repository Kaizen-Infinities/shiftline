import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createGzip } from "node:zlib";
import { once } from "node:events";
import { Prisma, RetentionAction, RetentionDataClass } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { RETENTION_CLASSES, RETENTION_DATA_CLASSES } from "./retention.policy";
import type { RunSweepInput, UpsertPolicyInput } from "./retention.validation";

type Tx = Prisma.TransactionClient;
type Row = { id: string | bigint | number } & Record<string, unknown>;

export interface EffectivePolicy {
  dataClass: RetentionDataClass;
  retentionDays: number;
  action: RetentionAction;
  isActive: boolean;
  minDays: number;
  defaultDays: number;
  purgeable: boolean;
  description: string;
  source: "default" | "custom";
  updatedAt?: Date;
  updatedBy?: string | null;
}

export interface SweepResult {
  dataClass: RetentionDataClass;
  action: RetentionAction;
  dryRun: boolean;
  cutoff: Date;
  matched: number;
  affected: number;
  archivePath: string | null;
  error: string | null;
}

/**
 * Per-class data access. Every query runs inside the tenant transaction the
 * sweep opens, so `app.company_id` is set and the tenant tables are scoped by
 * RLS. The two global tables (sessions, login attempts) are scoped explicitly
 * through the `user` relation (`user.companyId`), which RLS filters as well;
 * a bare `user: { isNot: null }` would compile to a null check on the FK and
 * bypass the join entirely.
 */
interface ClassOps {
  count(tx: Tx, cutoff: Date, companyId: string): Promise<number>;
  /** Oldest `take` matching rows; absent when the class is report-only. */
  fetch?(tx: Tx, cutoff: Date, take: number, companyId: string): Promise<Row[]>;
  remove?(tx: Tx, ids: Row["id"][]): Promise<number>;
}

const sessionWhere = (cutoff: Date, companyId: string): Prisma.UserSessionWhereInput => ({
  user: { companyId },
  OR: [{ expiresAt: { lt: cutoff } }, { isActive: false, updatedAt: { lt: cutoff } }],
});
const loginAttemptWhere = (cutoff: Date, companyId: string): Prisma.LoginAttemptWhereInput => ({
  user: { companyId },
  attemptedAt: { lt: cutoff },
});

const CLASS_OPS: Record<RetentionDataClass, ClassOps> = {
  BOOKS: {
    count: (tx, cutoff) => tx.voucher.count({ where: { date: { lt: cutoff } } }),
  },
  FILINGS: {
    count: async () => 0,
  },
  PAYROLL: {
    count: (tx, cutoff) => tx.payrollRun.count({ where: { createdAt: { lt: cutoff } } }),
  },
  AUDIT_LOGS: {
    count: (tx, cutoff) => tx.auditLog.count({ where: { changedAt: { lt: cutoff } } }),
    fetch: (tx, cutoff, take) =>
      tx.auditLog.findMany({ where: { changedAt: { lt: cutoff } }, orderBy: { id: "asc" }, take }),
    remove: async (tx, ids) => {
      // audit_log is append-only; only the retention sweep may delete, and only past the floor.
      await tx.$executeRaw`SELECT set_config('app.retention_sweep', 'on', TRUE)`;
      return (await tx.auditLog.deleteMany({ where: { id: { in: ids as bigint[] } } })).count;
    },
  },
  EOD_SNAPSHOTS: {
    count: (tx, cutoff) => tx.eodStockSnapshot.count({ where: { snapshotDate: { lt: cutoff } } }),
    fetch: (tx, cutoff, take) =>
      tx.eodStockSnapshot.findMany({
        where: { snapshotDate: { lt: cutoff } },
        orderBy: { id: "asc" },
        take,
      }),
    remove: async (tx, ids) =>
      (await tx.eodStockSnapshot.deleteMany({ where: { id: { in: ids as bigint[] } } })).count,
  },
  SESSIONS: {
    count: (tx, cutoff, cid) => tx.userSession.count({ where: sessionWhere(cutoff, cid) }),
    fetch: (tx, cutoff, take, cid) =>
      tx.userSession.findMany({
        where: sessionWhere(cutoff, cid),
        orderBy: { loginAt: "asc" },
        take,
      }),
    remove: async (tx, ids) =>
      (await tx.userSession.deleteMany({ where: { id: { in: ids as string[] } } })).count,
  },
  LOGIN_ATTEMPTS: {
    count: (tx, cutoff, cid) => tx.loginAttempt.count({ where: loginAttemptWhere(cutoff, cid) }),
    fetch: (tx, cutoff, take, cid) =>
      tx.loginAttempt.findMany({
        where: loginAttemptWhere(cutoff, cid),
        orderBy: { id: "asc" },
        take,
      }),
    remove: async (tx, ids) =>
      (await tx.loginAttempt.deleteMany({ where: { id: { in: ids as bigint[] } } })).count,
  },
  SYNC_TOMBSTONES: {
    count: async (tx, cutoff) => {
      const [a, b, c, d] = await Promise.all([
        tx.mobileSyncRecord.count({ where: { createdAt: { lt: cutoff } } }),
        tx.mobileVisit.count({ where: { deletedAt: { lt: cutoff } } }),
        tx.mobileCollection.count({ where: { deletedAt: { lt: cutoff } } }),
        tx.mobileRouteCustomer.count({ where: { deletedAt: { lt: cutoff } } }),
      ]);
      return a + b + c + d;
    },
    fetch: async (tx, cutoff, take) => {
      const parts: Row[] = [];
      const push = (rows: Row[], table: string) =>
        parts.push(...rows.map((r) => ({ ...r, __table: table })));
      push(
        await tx.mobileSyncRecord.findMany({
          where: { createdAt: { lt: cutoff } },
          orderBy: { createdAt: "asc" },
          take,
        }),
        "mobile_sync_records"
      );
      if (parts.length < take) {
        push(
          await tx.mobileVisit.findMany({
            where: { deletedAt: { lt: cutoff } },
            take: take - parts.length,
          }),
          "mobile_visits"
        );
      }
      if (parts.length < take) {
        push(
          await tx.mobileCollection.findMany({
            where: { deletedAt: { lt: cutoff } },
            take: take - parts.length,
          }),
          "mobile_collections"
        );
      }
      if (parts.length < take) {
        push(
          await tx.mobileRouteCustomer.findMany({
            where: { deletedAt: { lt: cutoff } },
            take: take - parts.length,
          }),
          "mobile_route_customers"
        );
      }
      return parts;
    },
    remove: async (tx, ids) => {
      const list = ids as string[];
      const [a, b, c, d] = await Promise.all([
        tx.mobileSyncRecord.deleteMany({ where: { id: { in: list } } }),
        tx.mobileVisit.deleteMany({ where: { id: { in: list }, deletedAt: { not: null } } }),
        tx.mobileCollection.deleteMany({ where: { id: { in: list }, deletedAt: { not: null } } }),
        tx.mobileRouteCustomer.deleteMany({
          where: { id: { in: list }, deletedAt: { not: null } },
        }),
      ]);
      return a.count + b.count + c.count + d.count;
    },
  },
  AGENT_POSITIONS: {
    count: (tx, cutoff) => tx.agentPosition.count({ where: { recordedAt: { lt: cutoff } } }),
    fetch: (tx, cutoff, take) =>
      tx.agentPosition.findMany({
        where: { recordedAt: { lt: cutoff } },
        orderBy: { id: "asc" },
        take,
      }),
    remove: async (tx, ids) =>
      (await tx.agentPosition.deleteMany({ where: { id: { in: ids as bigint[] } } })).count,
  },
  NOTIFICATIONS: {
    count: (tx, cutoff) => tx.notification.count({ where: { createdAt: { lt: cutoff } } }),
    fetch: (tx, cutoff, take) =>
      tx.notification.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        take,
      }),
    remove: async (tx, ids) =>
      (await tx.notification.deleteMany({ where: { id: { in: ids as string[] } } })).count,
  },
};

const BATCH = 1000;

export const cutoffFor = (retentionDays: number, now = new Date()): Date =>
  new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

class RetentionService {
  async listPolicies(): Promise<EffectivePolicy[]> {
    const custom = await prisma.retentionPolicy.findMany();
    const byClass = new Map(custom.map((p) => [p.dataClass, p]));
    return RETENTION_DATA_CLASSES.map((dataClass) => {
      const spec = RETENTION_CLASSES[dataClass];
      const row = byClass.get(dataClass);
      return {
        dataClass,
        retentionDays: row?.retentionDays ?? spec.defaultDays,
        action: row?.action ?? spec.defaultAction,
        isActive: row?.isActive ?? true,
        minDays: spec.minDays,
        defaultDays: spec.defaultDays,
        purgeable: spec.purgeable,
        description: spec.description,
        source: row ? "custom" : "default",
        updatedAt: row?.updatedAt,
        updatedBy: row?.updatedBy,
      };
    });
  }

  async upsertPolicy(dataClass: RetentionDataClass, input: UpsertPolicyInput, userId?: string) {
    const spec = RETENTION_CLASSES[dataClass];
    if (input.retentionDays < spec.minDays) {
      throw new ApiError(
        400,
        `${dataClass} must be retained for at least ${spec.minDays} days (statutory minimum)`
      );
    }
    if (input.action !== "RETAIN" && !spec.purgeable) {
      throw new ApiError(
        400,
        `${dataClass} cannot be archived or purged yet; archive arrives with the account export (Phase 1). Use RETAIN.`
      );
    }
    const companyId = requireTenantId();
    return prisma.retentionPolicy.upsert({
      where: { companyId_dataClass: { companyId, dataClass } },
      create: {
        companyId,
        dataClass,
        retentionDays: input.retentionDays,
        action: input.action,
        isActive: input.isActive ?? true,
        updatedBy: userId,
      },
      update: {
        retentionDays: input.retentionDays,
        action: input.action,
        isActive: input.isActive ?? true,
        updatedBy: userId,
      },
    });
  }

  async listSweeps(limit: number, dataClass?: RetentionDataClass) {
    return prisma.retentionSweep.findMany({
      where: dataClass ? { dataClass } : undefined,
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  /**
   * Runs the sweep for the current tenant. Each class runs in its own
   * transaction and records a RetentionSweep row, so one failing class never
   * blocks the others. A dry run counts and records but touches nothing.
   */
  async runSweep(
    input: RunSweepInput & { triggeredBy?: string; jobId?: string }
  ): Promise<SweepResult[]> {
    const companyId = requireTenantId();
    const policies = (await this.listPolicies()).filter(
      (p) => p.isActive && (!input.dataClasses || input.dataClasses.includes(p.dataClass))
    );
    const results: SweepResult[] = [];
    for (const policy of policies) {
      const cutoff = cutoffFor(policy.retentionDays);
      const sweep = await prisma.retentionSweep.create({
        data: {
          companyId,
          dataClass: policy.dataClass,
          action: policy.action,
          dryRun: input.dryRun,
          cutoff,
          triggeredBy: input.triggeredBy ?? null,
          jobId: input.jobId ?? null,
        },
      });
      const result: SweepResult = {
        dataClass: policy.dataClass,
        action: policy.action,
        dryRun: input.dryRun,
        cutoff,
        matched: 0,
        affected: 0,
        archivePath: null,
        error: null,
      };
      try {
        const out = await this.sweepClass(companyId, policy, cutoff, input.dryRun, sweep.id);
        Object.assign(result, out);
      } catch (err) {
        result.error = err instanceof Error ? err.message.slice(0, 1000) : String(err);
      }
      await prisma.retentionSweep.update({
        where: { id: sweep.id },
        data: {
          matched: result.matched,
          affected: result.affected,
          archivePath: result.archivePath,
          error: result.error,
          finishedAt: new Date(),
        },
      });
      results.push(result);
    }
    return results;
  }

  private async sweepClass(
    companyId: string,
    policy: EffectivePolicy,
    cutoff: Date,
    dryRun: boolean,
    sweepId: bigint
  ): Promise<Pick<SweepResult, "matched" | "affected" | "archivePath">> {
    const ops = CLASS_OPS[policy.dataClass];
    const matched = await prisma.$transaction((tx) => ops.count(tx, cutoff, companyId));
    const { fetch, remove } = ops;
    if (dryRun || policy.action === "RETAIN" || !fetch || !remove || matched === 0) {
      return { matched, affected: 0, archivePath: null };
    }

    let archive: Archive | undefined;
    if (policy.action === "ARCHIVE") {
      archive = await Archive.open(companyId, policy.dataClass, sweepId);
    }
    let affected = 0;
    try {
      // Each fetch+delete batch is one transaction, so a crash mid-sweep
      // leaves a consistent prefix archived and deleted.
      for (;;) {
        const removed = await prisma.$transaction(async (tx) => {
          const rows = await fetch(tx, cutoff, BATCH, companyId);
          if (rows.length === 0) return 0;
          if (archive) await archive.write(rows);
          return remove(
            tx,
            rows.map((r) => r.id)
          );
        });
        affected += removed;
        if (removed === 0) break;
      }
    } finally {
      await archive?.close();
    }
    return { matched, affected, archivePath: archive?.relativePath ?? null };
  }
}

/** Gzipped NDJSON archive under ARCHIVE_DIR/<companyId>/<class>/. */
class Archive {
  private constructor(
    readonly relativePath: string,
    private readonly gzip: ReturnType<typeof createGzip>,
    private readonly done: Promise<unknown>
  ) {}

  static async open(companyId: string, dataClass: RetentionDataClass, sweepId: bigint) {
    const dir = path.join(env.ARCHIVE_DIR, companyId, dataClass);
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const relativePath = path.join(companyId, dataClass, `${stamp}-sweep${sweepId}.ndjson.gz`);
    const file = createWriteStream(path.join(env.ARCHIVE_DIR, relativePath));
    const gzip = createGzip();
    gzip.pipe(file);
    return new Archive(relativePath, gzip, once(file, "finish"));
  }

  async write(rows: Row[]) {
    const chunk = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    if (!this.gzip.write(chunk)) await once(this.gzip, "drain");
  }

  async close() {
    this.gzip.end();
    await this.done;
  }
}

export const retentionService = new RetentionService();
