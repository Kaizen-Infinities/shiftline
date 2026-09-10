import { Router } from "express";

import { env } from "../config/env";
import { isJobsStarted } from "../lib/jobs";
import { latestMigration, runChecks, statusReport } from "../modules/status/status.service";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();
const startedAt = Date.now();

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
    const c = await runChecks();
    const checks = {
      db: c.db,
      migrations: c.db === "ok" ? c.migrations : "unknown",
      worker: c.worker,
    };
    const ready = checks.db === "ok" && checks.migrations === "ok";
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not-ready",
      checks,
      worker: { lastHeartbeatAt: c.workerLastSeen, embedded: isJobsStarted() },
      migration: { expected: latestMigration },
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * Public status (P1-05): what the status page shows. Coarse component states and one plain
 * sentence each; no versions, migration names, hosts or tenant data. Cached for 30 seconds.
 */
router.get(
  "/api/status",
  asyncHandler(async (_req, res) => {
    const report = await statusReport();
    res.setHeader("Cache-Control", "public, max-age=30");
    res.status(report.overall === "down" ? 503 : 200).json(report);
  })
);

export default router;
