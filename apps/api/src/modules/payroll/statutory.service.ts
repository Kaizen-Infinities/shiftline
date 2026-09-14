import { createHash } from "node:crypto";

import { Prisma, VoucherType, type TaxRegime } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";
import { filingApprovalService } from "../filings/filing-approval.service";
import { notify } from "../notifications/notify";
import {
  DEFAULT_STATUTORY_RULES,
  ESI_WAGE_LIMIT,
  esiSplit,
  pfSplit,
  professionalTax,
  salaryTax,
  wageCheck,
  type PtSlab,
} from "./statutory.calc";
import { QUARTERLY_OVERTIME_CAP } from "./labour.calc";
import {
  build24QRows,
  buildBankTransferFile,
  buildEcr,
  buildEsicFile,
  buildPtSummary,
  type StatutoryLine,
} from "./statutory.files";

/**
 * The statutory half of a payroll run (P1-16).
 *
 * The engine that works out attendance, overtime and net pay already exists; this takes a
 * completed run and produces what the law wants from it — the provident fund split the EPFO
 * expects, the state's professional tax, the labour welfare fund, tax on salary, the four files,
 * and the journal that puts it all in the books.
 *
 * It is a separate table rather than more columns on `PayrollResult` because the three
 * contribution wages are three different wages, and flattening them is how a contribution ends up
 * worked out on the wrong base.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

const monthOf = (periodKey: string): number => {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) throw new ApiError(400, "A period looks like 2026-08");
  return Number(m[2]);
};
const monthEnd = (periodKey: string): Date => {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) throw new ApiError(400, "A period looks like 2026-08");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
};

/**
 * ESI's contribution half-year for a payroll period: April-September or October-March. The
 * period is keyed by the calendar year its first month falls in, so "2026-08" and "2026-04" both
 * land in "2026-H1" and "2026-11" lands in "2026-H2" (which runs into March of the next year).
 */
export const esiPeriodBoundsFor = (periodKey: string): { key: string; start: Date; end: Date } => {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) throw new ApiError(400, "A period looks like 2026-08");
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month >= 4 && month <= 9) {
    return {
      key: `${year}-H1`,
      start: new Date(Date.UTC(year, 3, 1)),
      end: new Date(Date.UTC(year, 8, 30)),
    };
  }
  const octYear = month >= 10 ? year : year - 1;
  return {
    key: `${octYear}-H2`,
    start: new Date(Date.UTC(octYear, 9, 1)),
    end: new Date(Date.UTC(octYear + 1, 2, 31)),
  };
};

/**
 * The calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec) a "YYYY-MM-DD" date falls in — the
 * OSH Code's 125-hour overtime cap is reckoned quarter-to-date (P2-16), matching the same
 * calendar quarters the overtime register (P2-03) already groups attendance by.
 */
export const quarterBoundsFor = (dateStr: string): { key: string; start: Date; end: Date } => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new ApiError(400, "A date looks like 2026-08-15");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const qIndex = Math.floor((month - 1) / 3); // 0..3
  const startMonth = qIndex * 3;
  return {
    key: `${year}-Q${qIndex + 1}`,
    start: new Date(Date.UTC(year, startMonth, 1)),
    end: new Date(Date.UTC(year, startMonth + 3, 0)),
  };
};

class StatutoryPayrollService {
  /** The tenant's state rules, seeded on first use from the states a manufacturer is likely in. */
  async rules(includeInactive = false) {
    const existing = await prisma.statutoryRule.findMany({ orderBy: { stateCode: "asc" } });
    if (existing.length === 0) {
      await prisma.statutoryRule.createMany({
        data: DEFAULT_STATUTORY_RULES.map((r) => ({
          companyId: requireTenantId(),
          stateCode: r.stateCode,
          stateName: r.stateName,
          ptSlabs: r.ptSlabs as unknown as Prisma.InputJsonValue,
          lwfEmployee: r.lwfEmployee,
          lwfEmployer: r.lwfEmployer,
          lwfFrequency: r.lwfFrequency,
          lwfMonths: r.lwfMonths as unknown as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      return prisma.statutoryRule.findMany({ orderBy: { stateCode: "asc" } });
    }
    return includeInactive ? existing : existing.filter((r) => r.isActive);
  }

  /**
   * ESI eligibility for a payroll period (P2-02): the scheme fixes it once, at the start of the
   * contribution half-year, from that month's wage — a raise above the limit later does not stop
   * the contribution until the period ends. The decision is written once per employee per period
   * and left alone; a later call for the same period returns what was already decided rather than
   * re-reading the current wage.
   */
  async resolveEsiEligibility(
    employeeId: bigint,
    periodKey: string,
    grossWage: number,
    applicable: boolean
  ): Promise<boolean> {
    if (!applicable) return false;
    const { key, start, end } = esiPeriodBoundsFor(periodKey);
    const row = await prisma.esiContributionPeriod.upsert({
      where: {
        companyId_employeeId_periodKey: {
          companyId: requireTenantId(),
          employeeId,
          periodKey: key,
        },
      },
      update: {},
      create: {
        companyId: requireTenantId(),
        employeeId,
        periodKey: key,
        periodStart: start,
        periodEnd: end,
        eligible: n2(grossWage) <= ESI_WAGE_LIMIT,
        wageAtStart: n2(grossWage),
      },
    });
    return row.eligible;
  }

  /**
   * The quarter-to-date overtime hours already banked for an employee, before this run's own
   * hours are added (P2-16) — what `labour.calc`'s `overtimeForWeek` needs as
   * `quarterToDateHours` to compute a real `hoursOverCap` instead of one measured against a
   * blank quarter every time.
   */
  async peekOvertimeQuarterHours(employeeId: bigint, dateStr: string): Promise<number> {
    const { key } = quarterBoundsFor(dateStr);
    const row = await prisma.overtimeQuarterPeriod.findUnique({
      where: { companyId_employeeId_quarterKey: { companyId: requireTenantId(), employeeId, quarterKey: key } },
      select: { hoursAccrued: true },
    });
    return row ? n2(row.hoursAccrued) : 0;
  }

  /**
   * Banks this run's overtime hours onto the employee's running quarterly total and returns the
   * new total plus whether the OSH Code's 125-hour cap has been breached (P2-16). `breached` is
   * sticky for the quarter: once true it stays true even if a later run in the same quarter adds
   * no overtime of its own.
   */
  async recordOvertimeQuarterHours(
    employeeId: bigint,
    dateStr: string,
    totalHours: number
  ): Promise<{ totalHours: number; breached: boolean }> {
    const { key, start, end } = quarterBoundsFor(dateStr);
    const breached = totalHours > QUARTERLY_OVERTIME_CAP;
    const row = await prisma.overtimeQuarterPeriod.upsert({
      where: { companyId_employeeId_quarterKey: { companyId: requireTenantId(), employeeId, quarterKey: key } },
      update: { hoursAccrued: n2(totalHours), breached: breached ? true : undefined },
      create: {
        companyId: requireTenantId(),
        employeeId,
        quarterKey: key,
        quarterStart: start,
        quarterEnd: end,
        hoursAccrued: n2(totalHours),
        breached,
      },
    });
    return { totalHours: n2(row.hoursAccrued), breached: row.breached };
  }

  /**
   * Employees with no `EmployeeTaxDeclaration` on file for a financial year (P2-16): the payroll
   * run taxes them under the new regime with zero deductions by default, which is correct per
   * `statutory.calc.salaryTax`'s own rule but worth reminding them to file one.
   */
  async missingDeclarations(
    fyCode: string
  ): Promise<Array<{ employeeId: string; employeeCode: string; employeeName: string }>> {
    const employees = await prisma.employee.findMany({
      where: { status: "active" },
      select: { id: true, empCode: true, fullName: true },
    });
    if (employees.length === 0) return [];
    const declarations = await prisma.employeeTaxDeclaration.findMany({
      where: { fyCode, employeeId: { in: employees.map((e) => e.id) } },
      select: { employeeId: true },
    });
    const declared = new Set(declarations.map((d) => d.employeeId.toString()));
    return employees
      .filter((e) => !declared.has(e.id.toString()))
      .map((e) => ({ employeeId: e.id.toString(), employeeCode: e.empCode, employeeName: e.fullName }));
  }

  /**
   * Notifies each missing-declaration employee's linked user, once per employee per FY (P2-16):
   * the monthly job's tenant-scoped step, kept here next to `missingDeclarations` so the same
   * list feeds both the run screen's reminder and the notification. Idempotent by construction —
   * `notify`'s own row is checked by `category` + `link` (unique per employee and FY) before
   * sending, so calling this twice in the same month sends nothing the second time.
   */
  async remindMissingDeclarations(fyCode: string): Promise<{ checked: number; sent: number }> {
    const missing = await this.missingDeclarations(fyCode);
    let sent = 0;
    for (const m of missing) {
      const link = `/payroll/statutory?employeeId=${m.employeeId}&fy=${fyCode}`;
      // Only an employee with a linked login can be told in-app; one with none simply has
      // nobody to notify here — HR still sees them on the payroll run screen's own list.
      const user = await prisma.user.findFirst({
        where: { employeeId: BigInt(m.employeeId), status: "active" },
        select: { userId: true },
      });
      if (!user) continue;
      const already = await prisma.notification.findFirst({
        where: { category: "payroll-tax-declaration", link },
        select: { id: true },
      });
      if (already) continue;
      await notify({
        category: "payroll-tax-declaration",
        title: `File your tax declaration for FY ${fyCode}`,
        body: `No income-tax declaration is on file for FY ${fyCode} yet. Without one, tax on salary is deducted under the new regime with no deductions.`,
        link,
        to: { userIds: [user.userId] },
        level: "INFO",
      });
      sent++;
    }
    return { checked: missing.length, sent };
  }

  async upsertRule(input: {
    stateCode: string;
    stateName: string;
    ptSlabs?: PtSlab[];
    ptEnabled?: boolean;
    lwfEmployee?: number;
    lwfEmployer?: number;
    lwfFrequency?: string;
    lwfMonths?: number[];
    isActive?: boolean;
  }) {
    const data = {
      stateName: input.stateName.trim().slice(0, 80),
      ...(input.ptSlabs ? { ptSlabs: input.ptSlabs as unknown as Prisma.InputJsonValue } : {}),
      ptEnabled: input.ptEnabled ?? true,
      lwfEmployee: input.lwfEmployee ?? 0,
      lwfEmployer: input.lwfEmployer ?? 0,
      lwfFrequency: input.lwfFrequency ?? "ANNUAL",
      ...(input.lwfMonths
        ? { lwfMonths: input.lwfMonths as unknown as Prisma.InputJsonValue }
        : {}),
      isActive: input.isActive ?? true,
    };
    return prisma.statutoryRule.upsert({
      where: {
        companyId_stateCode: { companyId: requireTenantId(), stateCode: input.stateCode },
      },
      create: { stateCode: input.stateCode, ptSlabs: [], ...data },
      update: data,
    });
  }

  // ── Tax declarations ───────────────────────────────────────────────────────
  async declarations(fyCode: string) {
    return prisma.employeeTaxDeclaration.findMany({ where: { fyCode }, take: 1000 });
  }

  async setDeclaration(
    input: {
      employeeId: string;
      fyCode: string;
      regime: TaxRegime;
      declarations?: Record<string, number>;
      proofsVerified?: boolean;
      notes?: string | null;
    },
    _actor: { userId?: string }
  ) {
    const employee = await prisma.employee.findUnique({ where: { id: BigInt(input.employeeId) } });
    if (!employee) throw new ApiError(404, "That employee does not exist");
    const annualGross = n2(Number(employee.grossSalary ?? 0) * 12);
    const deductions = Object.values(input.declarations ?? {}).reduce(
      (s, v) => s + (Number(v) || 0),
      0
    );
    const tax = salaryTax({
      annualGross,
      regime: input.regime,
      deductions,
    });
    const data = {
      regime: input.regime,
      declarations: (input.declarations ?? {}) as unknown as Prisma.InputJsonValue,
      projectedIncome: annualGross,
      projectedTax: tax.totalTax,
      proofsVerified: input.proofsVerified ?? false,
      notes: input.notes ?? null,
    };
    return prisma.employeeTaxDeclaration.upsert({
      where: {
        companyId_employeeId_fyCode: {
          companyId: requireTenantId(),
          employeeId: BigInt(input.employeeId),
          fyCode: input.fyCode,
        },
      },
      create: { employeeId: BigInt(input.employeeId), fyCode: input.fyCode, ...data },
      update: data,
    });
  }

  // ── The run's statutory half ───────────────────────────────────────────────
  /**
   * Works out the statutory figures for a completed payroll run and stores them.
   *
   * Re-running replaces them, because a payroll can be corrected before it is paid and a stale
   * statutory row would be filed.
   */
  async compute(payrollRunId: number, actor: { userId?: string }) {
    const run = await prisma.payrollRun.findUnique({
      where: { id: payrollRunId },
      include: { results: true },
    });
    if (!run) throw new ApiError(404, "That payroll run does not exist");
    if (run.results.length === 0) {
      throw new ApiError(400, "That run has no results to work from", "NO_RESULTS");
    }
    const periodKey = /^\d{4}-\d{2}$/.test(run.period) ? run.period : run.period.slice(0, 7);
    const month = monthOf(periodKey);
    const fyStartYear =
      month >= 4 ? Number(periodKey.slice(0, 4)) : Number(periodKey.slice(0, 4)) - 1;
    const fyCode = `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;

    const rules = await this.rules(true);
    const employees = await prisma.employee.findMany({
      where: { id: { in: run.results.map((r) => r.employeeId) } },
    });
    const byId = new Map(employees.map((e) => [String(e.id), e]));
    const declarations = await prisma.employeeTaxDeclaration.findMany({ where: { fyCode } });
    const declarationById = new Map(declarations.map((d) => [String(d.employeeId), d]));
    const company = await prisma.company.findFirstOrThrow({ where: { id: requireTenantId() } });
    const companyState = company.stateCode ?? null;

    const rows: Prisma.PayrollStatutoryUncheckedCreateInput[] = [];
    for (const result of run.results) {
      const employee = byId.get(String(result.employeeId));
      const gross = n2(result.grossSalary);
      // Basic plus dearness allowance. The engine keeps one basic figure, so that is the wage;
      // where the structure has a separate DA it is already inside the PF wage it computed.
      const basicPlusDa =
        n2(result.pfWage) > 0 ? n2(result.pfWage) : n2(Number(employee?.basicSalary ?? 0));
      const check = wageCheck(basicPlusDa, gross);

      const pf = result.pfApplicable
        ? pfSplit({ pfWage: basicPlusDa })
        : {
            pfWage: basicPlusDa,
            epfEmployee: 0,
            epsEmployer: 0,
            epfEmployer: 0,
            edliCharges: 0,
            pfAdminCharges: 0,
            vpf: 0,
            employerTotal: 0,
          };
      const esi = esiSplit(gross, result.esiApplicable);

      const stateCode = companyState;
      const rule = rules.find((r) => r.stateCode === stateCode);
      const pt =
        rule && rule.ptEnabled && employee?.professionalTax
          ? professionalTax(gross, rule.ptSlabs as unknown as PtSlab[], month)
          : 0;
      // The welfare fund is only collected in the months the state names.
      const lwfMonths = (rule?.lwfMonths as unknown as number[]) ?? [];
      const lwfDue = rule ? lwfMonths.includes(month) : false;

      const declaration = declarationById.get(String(result.employeeId));
      const tax = employee?.tdsApplicable
        ? salaryTax({
            annualGross: n2(gross * 12),
            regime: (declaration?.regime ?? "NEW") as "OLD" | "NEW",
            deductions: Object.values(
              (declaration?.declarations as Record<string, number>) ?? {}
            ).reduce((s, v) => s + (Number(v) || 0), 0),
            professionalTaxPaid: n2(pt * 12),
          })
        : null;

      rows.push({
        companyId: requireTenantId(),
        payrollRunId,
        employeeId: result.employeeId,
        employeeCode: result.employeeCode,
        periodKey,
        stateCode,
        uan: employee?.uanNumber ?? null,
        esicNumber: employee?.esiNumber ?? null,
        pfWage: pf.pfWage,
        esiWage: esi.esiWage,
        ptWage: gross,
        epfEmployee: pf.epfEmployee,
        epsEmployer: pf.epsEmployer,
        epfEmployer: pf.epfEmployer,
        edliCharges: pf.edliCharges,
        pfAdminCharges: pf.pfAdminCharges,
        vpf: pf.vpf,
        esiEmployee: esi.esiEmployee,
        esiEmployer: esi.esiEmployer,
        professionalTax: pt,
        lwfEmployee: lwfDue ? n2(rule?.lwfEmployee) : 0,
        lwfEmployer: lwfDue ? n2(rule?.lwfEmployer) : 0,
        incomeTax: tax ? n2(tax.monthlyDeduction) : 0,
        wageSharePercent: check.sharePercent,
        wageCheckPassed: check.passed,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.payrollStatutory.deleteMany({ where: { payrollRunId } });
      await tx.payrollStatutory.createMany({ data: rows });
    });

    const failures = rows.filter((r) => !r.wageCheckPassed);
    return {
      payrollRunId,
      periodKey,
      fyCode,
      employees: rows.length,
      // Said out loud: the Code on Wages floor decides PF, gratuity and bonus, so a structure
      // that fails it is understating all three.
      wageCheckFailures: failures.map((f) => ({
        employeeCode: f.employeeCode,
        sharePercent: Number(f.wageSharePercent),
      })),
      preparedBy: actor.userId ?? null,
    };
  }

  /** The statutory rows for a run, joined to what the files need. */
  private async linesFor(
    payrollRunId: number
  ): Promise<
    (StatutoryLine & { stateCode: string | null; stateName?: string; pan?: string | null })[]
  > {
    const rows = await prisma.payrollStatutory.findMany({ where: { payrollRunId } });
    if (rows.length === 0) {
      throw new ApiError(
        400,
        "The statutory figures have not been worked out for that run yet",
        "NOT_COMPUTED"
      );
    }
    const results = await prisma.payrollResult.findMany({ where: { payrollRunId } });
    const resultById = new Map(results.map((r) => [String(r.employeeId), r]));
    const employees = await prisma.employee.findMany({
      where: { id: { in: rows.map((r) => r.employeeId) } },
    });
    const employeeById = new Map(employees.map((e) => [String(e.id), e]));
    const rules = await this.rules(true);

    return rows.map((r) => {
      const result = resultById.get(String(r.employeeId));
      const employee = employeeById.get(String(r.employeeId));
      return {
        employeeCode: r.employeeCode,
        employeeName: result?.employeeName ?? r.employeeCode,
        uan: r.uan,
        esicNumber: r.esicNumber,
        pfWage: n2(r.pfWage),
        esiWage: n2(r.esiWage),
        grossWage: n2(result?.grossSalary ?? 0),
        epfEmployee: n2(r.epfEmployee),
        epsEmployer: n2(r.epsEmployer),
        epfEmployer: n2(r.epfEmployer),
        vpf: n2(r.vpf),
        esiEmployee: n2(r.esiEmployee),
        esiEmployer: n2(r.esiEmployer),
        professionalTax: n2(r.professionalTax),
        incomeTax: n2(r.incomeTax),
        netSalary: n2(result?.netSalary ?? 0),
        lopDays: Number(result?.lopDays ?? 0),
        workingDays: Number(result?.presentDays ?? 0),
        bankAccountNumber: employee?.accountNumber ?? null,
        bankIfsc: employee?.ifscCode ?? null,
        stateCode: r.stateCode,
        stateName: rules.find((x) => x.stateCode === r.stateCode)?.stateName,
        pan: employee?.panNumber ?? null,
      };
    });
  }

  async ecr(payrollRunId: number) {
    return buildEcr(await this.linesFor(payrollRunId));
  }

  async esicFile(payrollRunId: number) {
    return buildEsicFile(await this.linesFor(payrollRunId));
  }

  async ptSummary(payrollRunId: number) {
    return buildPtSummary(await this.linesFor(payrollRunId));
  }

  async bankTransferFile(payrollRunId: number) {
    const rows = await prisma.payrollStatutory.findFirst({ where: { payrollRunId } });
    return buildBankTransferFile(await this.linesFor(payrollRunId), rows?.periodKey ?? "");
  }

  async form24QRows(payrollRunId: number) {
    return build24QRows(await this.linesFor(payrollRunId));
  }

  /** Everything the month owes, in one place. */
  async summary(payrollRunId: number) {
    const lines = await this.linesFor(payrollRunId);
    const rows = await prisma.payrollStatutory.findMany({ where: { payrollRunId } });
    const sum = (f: (r: (typeof rows)[number]) => unknown) =>
      n2(rows.reduce((s, r) => s + Number(f(r) ?? 0), 0));
    return {
      payrollRunId,
      periodKey: rows[0]?.periodKey ?? null,
      employees: rows.length,
      gross: n2(lines.reduce((s, l) => s + l.grossWage, 0)),
      net: n2(lines.reduce((s, l) => s + l.netSalary, 0)),
      pf: {
        employee: sum((r) => r.epfEmployee),
        vpf: sum((r) => r.vpf),
        pension: sum((r) => r.epsEmployer),
        employer: sum((r) => r.epfEmployer),
        edli: sum((r) => r.edliCharges),
        admin: sum((r) => r.pfAdminCharges),
      },
      esi: { employee: sum((r) => r.esiEmployee), employer: sum((r) => r.esiEmployer) },
      professionalTax: sum((r) => r.professionalTax),
      lwf: { employee: sum((r) => r.lwfEmployee), employer: sum((r) => r.lwfEmployer) },
      incomeTax: sum((r) => r.incomeTax),
      wageCheckFailures: rows.filter((r) => !r.wageCheckPassed).length,
    };
  }

  /**
   * The payroll journal.
   *
   *   Dr Salaries and wages           (the gross)
   *   Dr Employer's contributions     (pension, PF, EDLI, admin, ESI, welfare fund)
   *     Cr each withholding to its own liability — PF, ESI, professional tax, TDS, welfare fund
   *     Cr Salaries payable           (the net)
   *
   * The employer's share is a cost of employing people, not a deduction from anyone's pay, which
   * is why it is debited rather than netted against the gross.
   */
  async postJournal(payrollRunId: number, actor: { userId?: string }) {
    const summary = await this.summary(payrollRunId);
    if (!summary.periodKey) throw new ApiError(400, "That run has no period");
    const on = monthEnd(summary.periodKey);

    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      await periodService.assertPostingAllowed(on, undefined, tx);
      const existing = await tx.voucher.findFirst({
        where: { refDocType: "PAYROLL_RUN", refDocId: String(payrollRunId), status: "POSTED" },
      });
      if (existing) return { posted: false, voucherId: existing.id, summary };

      const ledger = async (code: string) => {
        const row = await tx.accountLedger.findFirst({ where: { code } });
        if (!row) throw new ApiError(500, `Missing ledger ${code}`, "MISSING_LEDGER");
        return row;
      };
      const salaries = await ledger("SAL-EXP-001");
      const contributions = await ledger("SAL-CONTRIB-001");
      const pfPayable = await ledger("PF-PAY-001");
      const esiPayable = await ledger("ESI-PAY-001");
      const ptPayable = await ledger("PT-PAY-001");
      const tdsPayable = await ledger("TDS-LIA-001");
      const salaryPayable = await ledger("SAL-PAY-001");

      const D = (n: number) => new Prisma.Decimal(n2(n));
      const debit = (id: number, amount: number, narration: string) => ({
        debitLedgerId: id,
        debitAmount: D(amount),
        creditAmount: D(0),
        narration,
      });
      const credit = (id: number, amount: number, narration: string) => ({
        creditLedgerId: id,
        debitAmount: D(0),
        creditAmount: D(amount),
        narration,
      });

      const employerShare = n2(
        summary.pf.pension +
          summary.pf.employer +
          summary.pf.edli +
          summary.pf.admin +
          summary.esi.employer +
          summary.lwf.employer
      );
      const pfTotal = n2(
        summary.pf.employee +
          summary.pf.vpf +
          summary.pf.pension +
          summary.pf.employer +
          summary.pf.edli +
          summary.pf.admin
      );
      const esiTotal = n2(summary.esi.employee + summary.esi.employer);
      const ptTotal = n2(summary.professionalTax + summary.lwf.employee + summary.lwf.employer);

      const items = [
        debit(salaries.id, summary.gross, `Salaries for ${summary.periodKey}`),
        ...(employerShare > 0
          ? [
              debit(
                contributions.id,
                employerShare,
                `Employer's contributions ${summary.periodKey}`
              ),
            ]
          : []),
        ...(pfTotal > 0 ? [credit(pfPayable.id, pfTotal, "Provident fund payable")] : []),
        ...(esiTotal > 0 ? [credit(esiPayable.id, esiTotal, "ESI payable")] : []),
        ...(ptTotal > 0
          ? [credit(ptPayable.id, ptTotal, "Professional tax and welfare fund")]
          : []),
        ...(summary.incomeTax > 0
          ? [credit(tdsPayable.id, summary.incomeTax, "Tax deducted on salary")]
          : []),
      ];
      // Whatever is left of the gross after the withholdings is what the bank actually pays.
      const withheld = n2(
        summary.pf.employee +
          summary.pf.vpf +
          summary.esi.employee +
          summary.professionalTax +
          summary.lwf.employee +
          summary.incomeTax
      );
      const net = n2(summary.gross - withheld);
      if (net > 0) items.push(credit(salaryPayable.id, net, `Net salary for ${summary.periodKey}`));

      const voucher = await tx.voucher.create({
        data: {
          voucherNo: `PAY-${summary.periodKey}-${payrollRunId}`.slice(0, 30),
          type: VoucherType.JOURNAL,
          date: on,
          narration: `Payroll for ${summary.periodKey}`,
          refDocType: "PAYROLL_RUN",
          refDocId: String(payrollRunId),
          createdBy: actor.userId?.slice(0, 36) ?? null,
          items: { create: items },
        },
      });
      return { posted: true, voucherId: voucher.id, summary, netPayable: net };
    });
  }

  /** Puts the month's statutory filings on the approval gate. */
  async registerFilings(payrollRunId: number, actor: { userId?: string }) {
    const summary = await this.summary(payrollRunId);
    if (!summary.periodKey) throw new ApiError(400, "That run has no period");
    const hash = (payload: unknown) =>
      createHash("sha256").update(JSON.stringify(payload)).digest("hex");

    const filings: { filingType: string; payload: unknown; note: string }[] = [
      {
        filingType: "PF_ECR",
        payload: summary.pf,
        note: `${summary.employees} member(s)`,
      },
      { filingType: "ESI_MONTHLY", payload: summary.esi, note: `${summary.employees} member(s)` },
      {
        filingType: "PT_RETURN",
        payload: { professionalTax: summary.professionalTax, lwf: summary.lwf },
        note: "Professional tax and welfare fund",
      },
      {
        filingType: "PAYROLL_RUN",
        payload: { gross: summary.gross, net: summary.net },
        note: `${summary.employees} employee(s)`,
      },
    ];

    const out = [];
    for (const f of filings) {
      out.push(
        await filingApprovalService.upsertDraft(
          {
            filingType: f.filingType,
            periodKey: summary.periodKey,
            businessPlaceId: null,
            payloadHash: hash(f.payload),
            summary: f.payload as Record<string, unknown>,
            notes: f.note,
          },
          actor
        )
      );
    }
    return { periodKey: summary.periodKey, registered: out.length, filings: out };
  }
}

export const statutoryPayrollService = new StatutoryPayrollService();
