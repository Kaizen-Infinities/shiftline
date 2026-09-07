import type PgBoss from "pg-boss";

import { QUEUES, getBoss } from "../lib/jobs";
import { logger } from "../lib/logger";
import { withRequestContext } from "../lib/request-context";
import { captureError } from "../lib/sentry";
import { eodSnapshotFanoutHandler, eodSnapshotHandler } from "./eod-snapshot.job";
import { backupHandler } from "./backup.job";
import { heartbeatHandler } from "./heartbeat.job";
import { retentionFanoutHandler, retentionSweepHandler } from "./retention.job";

const IST = "Asia/Kolkata";

/** Runs a single-job handler over pg-boss's batch (batchSize is 1 for every queue here). */
const each =
  <T extends object>(fn: (job: PgBoss.Job<T>) => Promise<unknown>) =>
  async (jobs: PgBoss.Job<T>[]) => {
    const out: unknown[] = [];
    for (const job of jobs) {
      out.push(
        await withRequestContext(`job:${job.name}`, async () => {
          const started = Date.now();
          try {
            const result = await fn(job);
            logger.info({ job: job.name, jobId: job.id, ms: Date.now() - started }, "job done");
            return result;
          } catch (err) {
            logger.error({ err, job: job.name, jobId: job.id }, "job failed");
            captureError(err, { job: job.name, jobId: job.id });
            throw err;
          }
        })
      );
    }
    return out.length === 1 ? out[0] : out;
  };

export interface WorkerOptions {
  /** Seconds between polls; tests lower it. */
  pollingIntervalSeconds?: number;
}

/** Registers every queue handler on the running pg-boss instance. */
export const registerWorkers = async (opts: WorkerOptions = {}): Promise<void> => {
  const boss = getBoss();
  const work = { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 5 };
  await boss.work(QUEUES.EOD_SNAPSHOT_FANOUT, work, each(eodSnapshotFanoutHandler));
  await boss.work(QUEUES.EOD_SNAPSHOT_CATCHUP, work, each(eodSnapshotFanoutHandler));
  await boss.work(QUEUES.EOD_SNAPSHOT, work, each(eodSnapshotHandler));
  await boss.work(QUEUES.RETENTION_FANOUT, work, each(retentionFanoutHandler));
  await boss.work(QUEUES.RETENTION_SWEEP, work, each(retentionSweepHandler));
  await boss.work(QUEUES.HEARTBEAT, work, each(heartbeatHandler));
  await boss.work(QUEUES.BACKUP_DAILY, work, each(backupHandler));
};

/**
 * Cron schedules, one per queue (pg-boss keys schedules by queue name).
 * Idempotent: `schedule()` upserts.
 */
export const registerSchedules = async (): Promise<void> => {
  const boss = getBoss();
  await boss.schedule(QUEUES.EOD_SNAPSHOT_FANOUT, "59 23 * * *", { daysBack: 0 }, { tz: IST });
  await boss.schedule(QUEUES.EOD_SNAPSHOT_CATCHUP, "30 6 * * *", { daysBack: 3 }, { tz: IST });
  await boss.schedule(QUEUES.RETENTION_FANOUT, "0 2 1 * *", { dryRun: false }, { tz: IST });
  await boss.schedule(QUEUES.HEARTBEAT, "* * * * *", {}, { tz: IST });
  await boss.schedule(QUEUES.BACKUP_DAILY, "30 1 * * *", { triggeredBy: "schedule" }, { tz: IST });
};
