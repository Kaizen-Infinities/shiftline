import type PgBoss from "pg-boss";

import { prisma } from "../config/prisma";
import { QUEUES, sendTenantJob, type TenantJobData } from "../lib/jobs";
import { runAsTenant, withoutTenant } from "../lib/tenant-context";
import { runEodStockSnapshot } from "../modules/inventory/jobs/eodStockSnapshot.job";
import { getISTDateParts, getISTDateString } from "../utils/dateUtils";

export interface EodSnapshotJobData extends TenantJobData {
  /** IST calendar date `YYYY-MM-DD`. */
  date: string;
  /** Re-run even when a snapshot for the date already exists (manual trigger). */
  force?: boolean;
}

const istDateMinus = (daysBack: number): string =>
  getISTDateString(new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000));

const snapshotExists = async (date: string): Promise<boolean> => {
  const [y, m, d] = date.split("-").map(Number);
  const count = await prisma.eodStockSnapshot.count({
    where: { snapshotDate: new Date(Date.UTC(y, m - 1, d)) },
  });
  return count > 0;
};

/** Tenant cutoff `HH:MM` IST (default 23:59) after which today's snapshot may be taken. */
const isPastCutoff = async (): Promise<boolean> => {
  const setting = await prisma.systemSetting.findFirst({ where: { key: "EOD_CUTOFF_TIME" } });
  const [hh, mm] = (setting?.value || "23:59").split(":").map(Number);
  const now = getISTDateParts(new Date());
  return now.hours > hh || (now.hours === hh && now.minutes >= mm);
};

/**
 * Per-tenant handler. Idempotent: skips when the date already has a snapshot
 * (unless forced) and defers today's snapshot until the tenant's cutoff time.
 */
export const eodSnapshotHandler = async (job: PgBoss.Job<EodSnapshotJobData>) => {
  const { companyId, date, force } = job.data;
  return runAsTenant(companyId, async () => {
    if (!force && (await snapshotExists(date))) return { skipped: "exists" };
    if (!force && date === istDateMinus(0) && !(await isPastCutoff())) {
      return { skipped: "before-cutoff" };
    }
    await runEodStockSnapshot(date);
    return { snapshotDate: date };
  });
};

/** Enqueues one EOD snapshot job per active tenant for each of the given dates. */
export const enqueueEodSnapshots = async (dates: string[], force = false): Promise<number> => {
  const companies = await withoutTenant(() =>
    prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
  );
  let sent = 0;
  for (const c of companies) {
    for (const date of dates) {
      const id = await sendTenantJob<EodSnapshotJobData>(
        QUEUES.EOD_SNAPSHOT,
        { companyId: c.id, date, force },
        { singletonKey: `${c.id}:${date}`, expireInSeconds: 60 * 30 }
      );
      if (id) sent++;
    }
  }
  return sent;
};

/**
 * Fan-out handler. The nightly schedule covers today; the morning catch-up
 * covers the last three days so an outage at 23:59 IST leaves no gap. The
 * per-tenant handler's exists-check makes the overlap harmless.
 */
export const eodSnapshotFanoutHandler = async (job: PgBoss.Job<{ daysBack?: number }>) => {
  const daysBack = job.data?.daysBack ?? 0;
  const dates: string[] = [];
  for (let i = daysBack; i >= 0; i--) dates.push(istDateMinus(i));
  const sent = await enqueueEodSnapshots(dates);
  return { dates, sent };
};
