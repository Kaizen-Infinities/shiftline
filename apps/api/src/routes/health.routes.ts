import { readdirSync } from "node:fs";
import path from "node:path";
import { Router } from "express";

import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { isJobsStarted } from "../lib/jobs";
import { withoutTenant } from "../lib/tenant-context";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();
const startedAt = Date.now();

/** Newest migration folder in the repo; `/ready` checks the database has it. */
const latestMigration = (() => {
  try {
    const dir = path.resolve(__dirname, "../../prisma/migrations");
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

/** Worker liveness: the heartbeat job completes every minute; older than 5 minutes is stale. */
const WORKER_STALE_MS = 5 * 60 * 1000;

type Check = "ok" | "fail" | "behind" | "stale" | "unknown";

/** Liveness: the process answers. Never touches the database. */
router.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: env.SERVICE_NAME,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness: database reachable and migrated. The worker heartbeat is
 * reported but does not fail readiness (the API serves without a worker; the
 * status page decides how loud to be about it).
 */
router.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    const checks: Record<string, Check> = {
      db: "unknown",
      migrations: "unknown",
      worker: "unknown",
    };
    let workerLastSeen: string | null = null;

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = "ok";
    } catch {
      checks.db = "fail";
    }

    if (checks.db === "ok") {
      try {
        const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
          SELECT migration_name FROM _prisma_migrations
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
          ORDER BY migration_name DESC LIMIT 1
        `;
        const applied = rows[0]?.migration_name ?? null;
        checks.migrations =
          latestMigration === null || applied === latestMigration ? "ok" : "behind";
      } catch {
        checks.migrations = "fail";
      }

      try {
        const rows = await withoutTenant(() =>
          prisma.$queryRawUnsafe<{ last: Date | null }[]>(
            `SELECT max(completed_on) AS last FROM ${env.PGBOSS_SCHEMA}.job WHERE name = 'platform.heartbeat'`
          )
        );
        const last = rows[0]?.last ? new Date(rows[0].last) : null;
        workerLastSeen = last?.toISOString() ?? null;
        checks.worker = !last
          ? "unknown"
          : Date.now() - last.getTime() > WORKER_STALE_MS
            ? "stale"
            : "ok";
      } catch {
        // pg-boss schema not created yet (worker never ran against this database).
        checks.worker = "unknown";
      }
    }

    const ready = checks.db === "ok" && checks.migrations === "ok";
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not-ready",
      checks,
      worker: { lastHeartbeatAt: workerLastSeen, embedded: isJobsStarted() },
      migration: { expected: latestMigration },
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
