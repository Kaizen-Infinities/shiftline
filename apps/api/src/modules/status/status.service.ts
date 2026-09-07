import { readdirSync } from "node:fs";
import path from "node:path";

import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { isJobsStarted } from "../../lib/jobs";
import { withoutTenant } from "../../lib/tenant-context";

/**
 * Component checks behind `/ready` and the public status page (P0-13, P1-05). One pass over
 * the database, the migration ledger, the worker heartbeat and the last backup; `/ready`
 * decides readiness from it and `/api/status` publishes a coarse, tenant-free view.
 */
export type ComponentState = "ok" | "degraded" | "down" | "unknown";

export interface ComponentReport {
  state: ComponentState;
  /** One short, non-sensitive sentence for the status page. */
  detail: string;
  at: string | null;
}

export interface StatusReport {
  overall: "operational" | "degraded" | "down";
  components: {
    api: ComponentReport;
    database: ComponentReport;
    migrations: ComponentReport;
    worker: ComponentReport;
    backups: ComponentReport;
  };
  checkedAt: string;
}

/** Worker liveness: the heartbeat job completes every minute; older than 5 minutes is stale. */
export const WORKER_STALE_MS = 5 * 60 * 1000;
/** A daily backup older than 36 hours means the job missed a night. */
export const BACKUP_STALE_MS = 36 * 60 * 60 * 1000;

const startedAt = Date.now();

/** Newest migration folder in the repo; `/ready` checks the database has it. */
export const latestMigration = (() => {
  try {
    const dir = path.resolve(__dirname, "../../../prisma/migrations");
    return (
      readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .pop() ?? null
    );
  } catch {
    return null;
  }
})();

export interface RawChecks {
  db: "ok" | "fail";
  migrations: "ok" | "behind" | "fail" | "unknown";
  applied: string | null;
  worker: "ok" | "stale" | "unknown";
  workerLastSeen: string | null;
  backup: { status: "SUCCESS" | "FAILED" | "RUNNING"; finishedAt: string | null } | null;
}

export const runChecks = async (): Promise<RawChecks> => {
  const out: RawChecks = {
    db: "fail",
    migrations: "unknown",
    applied: null,
    worker: "unknown",
    workerLastSeen: null,
    backup: null,
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    out.db = "ok";
  } catch {
    return out;
  }

  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC LIMIT 1
    `;
    out.applied = rows[0]?.migration_name ?? null;
    out.migrations = latestMigration === null || out.applied === latestMigration ? "ok" : "behind";
  } catch {
    out.migrations = "fail";
  }

  try {
    const rows = await withoutTenant(() =>
      prisma.$queryRawUnsafe<{ last: Date | null }[]>(
        `SELECT max(completed_on) AS last FROM ${env.PGBOSS_SCHEMA}.job WHERE name = 'platform.heartbeat'`
      )
    );
    const last = rows[0]?.last ? new Date(rows[0].last) : null;
    out.workerLastSeen = last?.toISOString() ?? null;
    out.worker = !last ? "unknown" : Date.now() - last.getTime() > WORKER_STALE_MS ? "stale" : "ok";
  } catch {
    // pg-boss schema not created yet (worker never ran against this database).
    out.worker = "unknown";
  }

  try {
    const run = await withoutTenant(() =>
      prisma.backupRun.findFirst({
        where: { status: { in: ["SUCCESS", "FAILED"] } },
        orderBy: { startedAt: "desc" },
        select: { status: true, finishedAt: true },
      })
    );
    out.backup = run
      ? {
          status: run.status as "SUCCESS" | "FAILED",
          finishedAt: run.finishedAt?.toISOString() ?? null,
        }
      : null;
  } catch {
    out.backup = null;
  }
  return out;
};

const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 2 ? "just now" : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** The public report: coarse states and short sentences, nothing tenant- or version-specific. */
export const statusReport = async (): Promise<StatusReport> => {
  const c = await runChecks();
  const uptime = Math.round((Date.now() - startedAt) / 1000);
  const components: StatusReport["components"] = {
    api: { state: "ok", detail: `Answering; up ${Math.floor(uptime / 60)} min`, at: null },
    database:
      c.db === "ok"
        ? { state: "ok", detail: "Reachable", at: null }
        : { state: "down", detail: "Not reachable", at: null },
    migrations:
      c.migrations === "ok"
        ? { state: "ok", detail: "Schema current", at: null }
        : c.migrations === "behind"
          ? { state: "degraded", detail: "A schema update is pending", at: null }
          : { state: "unknown", detail: "Could not read the migration ledger", at: null },
    worker:
      c.worker === "ok"
        ? { state: "ok", detail: `Heartbeat ${ago(c.workerLastSeen)}`, at: c.workerLastSeen }
        : c.worker === "stale"
          ? {
              state: "degraded",
              detail: `No heartbeat since ${ago(c.workerLastSeen)}; scheduled jobs are delayed`,
              at: c.workerLastSeen,
            }
          : {
              state: isJobsStarted() ? "ok" : "unknown",
              detail: isJobsStarted() ? "Jobs run inside the API process" : "No worker seen yet",
              at: null,
            },
    backups: !c.backup
      ? { state: "unknown", detail: "No backup recorded yet", at: null }
      : c.backup.status === "FAILED"
        ? { state: "degraded", detail: "The last backup failed", at: c.backup.finishedAt }
        : c.backup.finishedAt &&
            Date.now() - new Date(c.backup.finishedAt).getTime() > BACKUP_STALE_MS
          ? {
              state: "degraded",
              detail: `Last backup ${ago(c.backup.finishedAt)}`,
              at: c.backup.finishedAt,
            }
          : {
              state: "ok",
              detail: `Last backup ${ago(c.backup.finishedAt)}`,
              at: c.backup.finishedAt,
            },
  };
  const states = Object.values(components).map((x) => x.state);
  const overall = states.includes("down")
    ? "down"
    : states.includes("degraded")
      ? "degraded"
      : "operational";
  return { overall, components, checkedAt: new Date().toISOString() };
};
