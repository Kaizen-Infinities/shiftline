import type PgBoss from "pg-boss";

import { prisma } from "../config/prisma";
import { QUEUES, sendTenantJob, type TenantJobData } from "../lib/jobs";
import { runAsTenant, withoutTenant } from "../lib/tenant-context";
import { PLATFORM_LOGIN_ATTEMPT_DAYS } from "../modules/retention/retention.policy";
import { cutoffFor, retentionService } from "../modules/retention/retention.service";

export interface RetentionSweepJobData extends TenantJobData {
  dryRun: boolean;
}

/** Per-tenant sweep; the service records one RetentionSweep row per class. */
export const retentionSweepHandler = async (job: PgBoss.Job<RetentionSweepJobData>) => {
  const { companyId, dryRun } = job.data;
  const results = await runAsTenant(companyId, () =>
    retentionService.runSweep({ dryRun, triggeredBy: "schedule", jobId: job.id })
  );
  return results.map((r) => ({
    dataClass: r.dataClass,
    matched: r.matched,
    affected: r.affected,
    error: r.error,
  }));
};

/** Enqueues one sweep per active tenant; `dryRun` defaults to a real run. */
export const enqueueRetentionSweeps = async (dryRun = false): Promise<number> => {
  const companies = await withoutTenant(() =>
    prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
  );
  let sent = 0;
  for (const c of companies) {
    const id = await sendTenantJob<RetentionSweepJobData>(
      QUEUES.RETENTION_SWEEP,
      { companyId: c.id, dryRun },
      { expireInSeconds: 60 * 60 }
    );
    if (id) sent++;
  }
  return sent;
};

/**
 * Monthly fan-out. Also purges login attempts that belong to no tenant
 * (unknown usernames, platform admins), which no tenant policy can reach.
 */
export const retentionFanoutHandler = async (job: PgBoss.Job<{ dryRun?: boolean }>) => {
  const dryRun = job.data?.dryRun ?? false;
  const sent = await enqueueRetentionSweeps(dryRun);
  const cutoff = cutoffFor(PLATFORM_LOGIN_ATTEMPT_DAYS);
  const orphanWhere = { userId: null, attemptedAt: { lt: cutoff } };
  const orphanAttempts = dryRun
    ? await prisma.loginAttempt.count({ where: orphanWhere })
    : (await prisma.loginAttempt.deleteMany({ where: orphanWhere })).count;
  return { sent, orphanAttempts, dryRun };
};
