import PgBoss from "pg-boss";

import { env, isTest } from "../config/env";
import { logger } from "./logger";

/**
 * Background jobs run on pg-boss (Postgres-backed, no extra broker). One
 * instance per process; `startJobs()` is called by the worker entrypoint and,
 * when EMBED_WORKER=true, by the API process for single-process local runs.
 *
 * Queue naming: `<area>.<job>`. Tenant jobs carry `companyId` in their data and
 * the handler wraps itself in `runAsTenant`. Jobs must be idempotent: pg-boss
 * retries and the fan-out schedules can both enqueue the same work twice, and
 * singleton keys only de-duplicate while a job is queued or active.
 */
export const QUEUES = {
  /** Nightly fan-out (23:59 IST): enqueue today's EOD snapshot per active tenant. */
  EOD_SNAPSHOT_FANOUT: "inventory.eod-snapshot.fanout",
  /** Morning catch-up (06:30 IST): enqueue the last three days per tenant; exists-check skips. */
  EOD_SNAPSHOT_CATCHUP: "inventory.eod-snapshot.catchup",
  /** Per-tenant EOD stock snapshot for one IST date. */
  EOD_SNAPSHOT: "inventory.eod-snapshot",
  /** Monthly fan-out: enqueue one retention sweep per active tenant. */
  RETENTION_FANOUT: "platform.retention.fanout",
  /** Per-tenant retention sweep (archive/purge or dry run). */
  RETENTION_SWEEP: "platform.retention.sweep",
  /** Every minute; `/ready` reads its last completion as worker liveness. */
  HEARTBEAT: "platform.heartbeat",
  /** Daily pg_dump (01:30 IST, before the monthly retention sweep). */
  BACKUP_DAILY: "platform.backup.daily",
  /** Per-tenant full account export (P1-03); one at a time per tenant. */
  ACCOUNT_EXPORT: "platform.account-export",
  /** One IRN request per document (P1-11); retried on transient portal errors. */
  E_INVOICE: "gst.e-invoice",
  /** Hourly: expire e-way bills past validity and warn before they lapse (P1-12). */
  EWB_EXPIRY: "gst.eway-bill.expiry",
  /** Daily: warn when IMS records are still undecided and the 14th is close (P1-13c). */
  IMS_DEADLINE: "gst.ims.deadline",
  /** Daily: warn 7 and 2 days before each statutory due date (P1-13d). */
  COMPLIANCE_CALENDAR: "gst.compliance.calendar",
  /** Daily: warn before job-work goods run out of time to come back (P1-14). */
  JOB_WORK_RETURN: "gst.job-work.return",
  /** Daily: warn before a micro or small supplier's bill runs past section 15 (P1-07). */
  MSME_CLOCK: "accounts.msme.clock",
  /** Monthly on the 1st: prepare last month's depreciation for every tenant (P1-18). */
  DEPRECIATION_RUN: "accounts.depreciation.run",
  /** Daily: pull the day's exchange rates for every tenant (P1-17). */
  FX_RATES: "accounts.fx.rates",
  /** Monthly on the 1st: raise the subscription invoice for every tenant (P1-21, P2-01). */
  BILLING_SWEEP: "platform.billing.sweep",
  /** Daily: warn before a post-dated cheque, received or issued, comes due (P1-20, P2-01). */
  CHEQUE_DUE: "banking.cheque.due",
  /** Monthly on the 1st: prepare last month's Tally export for opted-in tenants (P1-06, P2-01). */
  TALLY_EXPORT_SWEEP: "accounts.tally.export.sweep",
  /** One SMS send per job, queued off the request path; retried by pg-boss (P1-22, P2-01). */
  SMS_SEND: "comms.sms.send",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Queues whose jobs carry a companyId and de-duplicate per tenant. */
const TENANT_QUEUES: ReadonlySet<string> = new Set([
  QUEUES.EOD_SNAPSHOT,
  QUEUES.RETENTION_SWEEP,
  QUEUES.ACCOUNT_EXPORT,
]);

let boss: PgBoss | undefined;

export interface JobsOptions {
  /** Override the connection string (tests point at a worker database). */
  connectionString?: string;
  /** Disable cron scheduling (tests, one-off scripts). */
  schedule?: boolean;
}

/** Creates and starts the pg-boss instance; safe to call more than once. */
export const startJobs = async (opts: JobsOptions = {}): Promise<PgBoss> => {
  if (boss) return boss;
  const instance = new PgBoss({
    connectionString: opts.connectionString ?? env.DATABASE_URL,
    schema: env.PGBOSS_SCHEMA,
    application_name: "shiftline-jobs",
    max: 4,
    schedule: opts.schedule ?? !isTest,
    // Job rows are kept for 14 days, plenty for support queries; MCA retention
    // applies to books, not to queue bookkeeping.
    deleteAfterDays: 14,
    archiveCompletedAfterSeconds: 60 * 60 * 12,
    archiveFailedAfterSeconds: 60 * 60 * 24 * 7,
  });
  instance.on("error", (err) => {
    // pino arrives in P0-13; keep the worker alive on transient DB errors.
    logger.error({ err: err }, "[jobs] pg-boss error:");
  });
  await instance.start();
  for (const name of Object.values(QUEUES)) {
    // Tenant queues are `stately`: one job per singleton key may be queued
    // and one active, so a fan-out never stacks duplicate work for a tenant.
    const policy = TENANT_QUEUES.has(name) ? "stately" : "standard";
    await instance.createQueue(name, {
      name,
      policy,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    });
  }
  boss = instance;
  return instance;
};

/** The running instance; throws when `startJobs()` has not run in this process. */
export const getBoss = (): PgBoss => {
  if (!boss) throw new Error("Jobs not started: call startJobs() first");
  return boss;
};

export const isJobsStarted = () => boss !== undefined;

export const stopJobs = async (): Promise<void> => {
  if (!boss) return;
  const b = boss;
  boss = undefined;
  await b.stop({ graceful: true, timeout: 10_000, wait: true, close: true });
};

export interface TenantJobData {
  companyId: string;
}

/**
 * Enqueues a per-tenant job. `singletonKey` defaults to the companyId so at
 * most one job per tenant is queued or running per queue; pass a more specific
 * key (e.g. `${companyId}:${date}`) when several distinct runs may coexist.
 */
export const sendTenantJob = async <T extends TenantJobData>(
  name: QueueName,
  data: T,
  options: PgBoss.SendOptions = {}
): Promise<string | null> => {
  return getBoss().send(name, data, { singletonKey: data.companyId, ...options });
};
