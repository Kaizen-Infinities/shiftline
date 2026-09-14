import { prisma } from "../config/prisma";
import { logger } from "../lib/logger";
import { runAsTenant, withoutTenant } from "../lib/tenant-context";
import { statutoryPayrollService } from "../modules/payroll/statutory.service";

/**
 * Monthly, on the 1st: an employee with no `EmployeeTaxDeclaration` on file for the financial
 * year is taxed under the new regime with zero deductions — correct per `statutory.calc`'s own
 * rule, but worth telling them (P2-16). The tenant-scoped step, including the once-per-FY
 * idempotency, lives in `statutoryPayrollService.remindMissingDeclarations`; this only fans it
 * out across every active tenant, the same shape as `msme.job.ts` and `leave.job.ts`.
 */
const fyCodeFor = (today: Date): string => {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1; // 1-12
  const fyStartYear = month >= 4 ? year : year - 1;
  return `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
};

export const runTaxDeclarationReminder = async (today = new Date()) => {
  const fyCode = fyCodeFor(today);
  const companies = await withoutTenant(() =>
    prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
  );
  let sent = 0;
  for (const c of companies) {
    try {
      const res = await runAsTenant(c.id, () =>
        statutoryPayrollService.remindMissingDeclarations(fyCode)
      );
      sent += res.sent;
    } catch (err) {
      logger.error({ companyId: c.id, err }, "tax declaration reminder failed for a tenant");
    }
  }
  return { companies: companies.length, sent };
};

/** pg-boss entry point: the schedule carries no payload, so this always runs for "today". */
export const taxDeclarationReminderHandler = async () => runTaxDeclarationReminder(new Date());
