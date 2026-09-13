import type PgBoss from "pg-boss";

import { prisma } from "../config/prisma";
import { QUEUES, sendTenantJob, type TenantJobData } from "../lib/jobs";
import { runAsTenant, withoutTenant } from "../lib/tenant-context";
import { labourService } from "../modules/payroll/labour.service";

export interface LeaveAccrualJobData extends TenantJobData {
  /** The last calendar day of the month being accrued, `YYYY-MM-DD`. */
  monthEnd: string;
}

/** Per-tenant handler: recomputes leave to date for every active employee (P2-T). */
export const leaveAccrualHandler = async (job: PgBoss.Job<LeaveAccrualJobData>) => {
  const { companyId, monthEnd } = job.data;
  return runAsTenant(companyId, () =>
    labourService.accrueForMonth(new Date(`${monthEnd}T00:00:00.000Z`), { userId: "system" })
  );
};

const lastDayOfPreviousIstMonth = (): string => {
  const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const lastDay = new Date(Date.UTC(istNow.getFullYear(), istNow.getMonth(), 0));
  return lastDay.toISOString().slice(0, 10);
};

/** Monthly fan-out (1st of the month IST): one leave-accrual run per active tenant. */
export const leaveAccrualFanoutHandler = async (_job: PgBoss.Job<Record<string, never>>) => {
  const monthEnd = lastDayOfPreviousIstMonth();
  const companies = await withoutTenant(() =>
    prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
  );
  let sent = 0;
  for (const c of companies) {
    const id = await sendTenantJob<LeaveAccrualJobData>(
      QUEUES.LEAVE_ACCRUAL,
      { companyId: c.id, monthEnd },
      { singletonKey: `${c.id}:${monthEnd}`, expireInSeconds: 60 * 60 }
    );
    if (id) sent++;
  }
  return { monthEnd, sent };
};
