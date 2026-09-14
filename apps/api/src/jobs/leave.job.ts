import { prisma } from "../config/prisma";
import { logger } from "../lib/logger";
import { runAsTenant, withoutTenant } from "../lib/tenant-context";
import { leaveService } from "../modules/leave/leave.service";

/**
 * Monthly, on the 1st: leave that has accrued does not otherwise accrue itself — P1-17b's
 * `accrue` has to be called. This calls it once per active employee per tenant, from the
 * previous month's attendance (P2-09).
 *
 * Idempotent by construction: `attendanceToDate` always totals from the start of the financial
 * year to the end of the month just closed, and `labourService.accrue` sets the ledger's
 * `accrued` to that absolute total rather than adding to it — so running this twice for the same
 * month lands on the same balance both times.
 */
export const runLeaveAccrual = async (today = new Date()) => {
  // The last day of the month just closed, whatever day of the month the job actually runs.
  const previousMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const companies = await withoutTenant(() =>
    prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
  );
  let accrued = 0;
  for (const c of companies) {
    try {
      const res = await runAsTenant(c.id, () => leaveService.accrueForTenant(previousMonthEnd));
      accrued += res.accrued;
    } catch (err) {
      logger.error({ companyId: c.id, err }, "leave accrual failed for a tenant");
    }
  }
  return { companies: companies.length, accrued };
};

/** pg-boss entry point: the schedule carries no payload, so this always runs for "today". */
export const leaveAccrualHandler = async () => runLeaveAccrual(new Date());
