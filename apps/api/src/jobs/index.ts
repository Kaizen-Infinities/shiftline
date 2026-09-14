import type PgBoss from "pg-boss";

import { QUEUES, getBoss } from "../lib/jobs";
import { logger } from "../lib/logger";
import { withRequestContext } from "../lib/request-context";
import { captureError } from "../lib/sentry";
import { eodSnapshotFanoutHandler, eodSnapshotHandler } from "./eod-snapshot.job";
import { backupHandler } from "./backup.job";
import { accountExportHandler } from "./account-export.job";
import { eInvoiceHandler } from "./e-invoice.job";
import { ewayBillExpiryHandler } from "./eway-bill.job";
import { heartbeatHandler } from "./heartbeat.job";
import { complianceCalendarHandler } from "./compliance.job";
import { imsDeadlineHandler } from "./ims.job";
import { jobWorkReturnHandler } from "./job-work.job";
import { msmeClockHandler } from "./msme.job";
import { depreciationRunHandler } from "./assets.job";
import { fxRatesHandler } from "./fx.job";
import { leaveAccrualHandler } from "./leave.job";
import { retentionFanoutHandler, retentionSweepHandler } from "./retention.job";
import { billingSweepHandler } from "./billing.job";
import { chequeDueHandler } from "./banking.job";
import { tallyExportSweepHandler } from "./tally.job";
import { smsSendHandler } from "./sms.job";

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
  await boss.work(QUEUES.ACCOUNT_EXPORT, work, each(accountExportHandler));
  await boss.work(QUEUES.E_INVOICE, work, each(eInvoiceHandler));
  await boss.work(QUEUES.EWB_EXPIRY, work, each(ewayBillExpiryHandler));
  await boss.work(QUEUES.IMS_DEADLINE, work, each(imsDeadlineHandler));
  await boss.work(QUEUES.COMPLIANCE_CALENDAR, work, each(complianceCalendarHandler));
  await boss.work(QUEUES.JOB_WORK_RETURN, work, each(jobWorkReturnHandler));
  await boss.work(QUEUES.MSME_CLOCK, work, each(msmeClockHandler));
  await boss.work(QUEUES.DEPRECIATION_RUN, work, each(depreciationRunHandler));
  await boss.work(QUEUES.FX_RATES, work, each(fxRatesHandler));
  await boss.work(QUEUES.BILLING_SWEEP, work, each(billingSweepHandler));
  await boss.work(QUEUES.CHEQUE_DUE, work, each(chequeDueHandler));
  await boss.work(QUEUES.TALLY_EXPORT_SWEEP, work, each(tallyExportSweepHandler));
  await boss.work(QUEUES.SMS_SEND, work, each(smsSendHandler));
  await boss.work(QUEUES.LEAVE_ACCRUAL, work, each(leaveAccrualHandler));
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
  await boss.schedule(QUEUES.EWB_EXPIRY, "15 * * * *", {}, { tz: IST });
  // 08:00 IST daily: the IMS deadline warning is only useful in the run-up to the 14th, and
  // the handler itself decides whether today is inside that window.
  await boss.schedule(QUEUES.IMS_DEADLINE, "0 8 * * *", {}, { tz: IST });
  // 07:30 IST daily, before the IMS nudge so the calendar's wider view lands first.
  await boss.schedule(QUEUES.COMPLIANCE_CALENDAR, "30 7 * * *", {}, { tz: IST });
  await boss.schedule(QUEUES.JOB_WORK_RETURN, "45 7 * * *", {}, { tz: IST });
  await boss.schedule(QUEUES.MSME_CLOCK, "15 8 * * *", {}, { tz: IST });
  await boss.schedule(QUEUES.DEPRECIATION_RUN, "0 3 1 * *", {}, { tz: IST });
  // 14:00 IST: the RBI publishes its reference rate around 13:30 and not at all on a holiday.
  await boss.schedule(QUEUES.FX_RATES, "0 14 * * *", {}, { tz: IST });
  // 03:30 IST on the 1st: raise the month's subscription invoices before the day starts.
  await boss.schedule(QUEUES.BILLING_SWEEP, "30 3 1 * *", {}, { tz: IST });
  // 08:30 IST daily: after the MSME clock, before the working day gets busy.
  await boss.schedule(QUEUES.CHEQUE_DUE, "30 8 * * *", {}, { tz: IST });
  // 04:00 IST on the 1st, after billing: prepare last month's Tally export for opted-in tenants.
  await boss.schedule(QUEUES.TALLY_EXPORT_SWEEP, "0 4 1 * *", {}, { tz: IST });
  // 02:00 IST on the 1st, before the depreciation run: last month's attendance is settled by
  // then and the leave ledger should be current before anyone applies against it.
  await boss.schedule(QUEUES.LEAVE_ACCRUAL, "0 2 1 * *", {}, { tz: IST });
};
