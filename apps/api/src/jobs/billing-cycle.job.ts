import type PgBoss from "pg-boss";

import { prisma } from "../config/prisma";
import { QUEUES, sendTenantJob, type TenantJobData } from "../lib/jobs";
import { withoutTenant } from "../lib/tenant-context";
import { billingService } from "../modules/payments/billing.service";
import { getISTDateString } from "../utils/dateUtils";

/** Per-tenant handler: raises the next subscription invoice once its period is due (P2-T). */
export const billingCycleHandler = async (job: PgBoss.Job<TenantJobData>) => {
  const invoice = await billingService.raiseNextIfDue(job.data.companyId);
  return { raised: Boolean(invoice), invoiceId: invoice?.id ?? null };
};

/**
 * Daily fan-out. Each tenant's billing anchor date can fall on any day of the month
 * (`currentPeriodStart` is set at provisioning), so the fan-out runs every day and the per-tenant
 * handler decides whether that tenant's period has actually ended.
 */
export const billingCycleFanoutHandler = async (_job: PgBoss.Job<Record<string, never>>) => {
  const today = getISTDateString();
  const companies = await withoutTenant(() =>
    prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
  );
  let sent = 0;
  for (const c of companies) {
    const id = await sendTenantJob(
      QUEUES.BILLING_CYCLE,
      { companyId: c.id },
      { singletonKey: `${c.id}:${today}`, expireInSeconds: 60 * 30 }
    );
    if (id) sent++;
  }
  return { date: today, sent };
};
