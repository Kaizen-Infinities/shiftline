/**
 * The inspector's registers (P2-03): muster roll, wages, overtime, fines, deductions and
 * advances, built entirely from data other modules already persist — attendance, payroll
 * results, and the fine/deduction and advance records. Nothing here computes payroll; it only
 * reads what a run already produced and shapes it into the six registers the Labour Codes
 * require a company to keep.
 */
import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { OVERTIME_MULTIPLIER, QUARTERLY_OVERTIME_CAP } from "../payroll/labour.calc";
import { payrollService } from "../payroll/payroll.service";
import { quarterBoundsFor } from "../payroll/statutory.service";

const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

const daysInMonth = (month: string): number => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

const monthEnd = (month: string): string =>
  `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

/** The calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec) a month falls in, as YYYY-MM strings
 *  from the first month of the quarter up to and including `month`. */
const quarterMonthsUpTo = (month: string): string[] => {
  const [y, m] = month.split("-").map(Number);
  const quarterStart = Math.floor((m - 1) / 3) * 3 + 1;
  const months: string[] = [];
  for (let mm = quarterStart; mm <= m; mm++) months.push(`${y}-${String(mm).padStart(2, "0")}`);
  return months;
};

const ATTENDANCE_CODE: Record<string, "P" | "A" | "H" | "L" | "WO"> = {
  PRESENT: "P",
  ABSENT: "A",
  HALF_DAY: "H",
  HOLIDAY: "H",
  WEEKLY_OFF: "WO",
  LEAVE_PAID: "L",
  LEAVE_UNPAID: "L",
};

class RegistersService {
  /** Validates a business-place filter belongs to this tenant, so a bad id is rejected rather
   *  than silently ignored, and returns it as a BigInt for the filter itself. Every register
   *  filters by `Employee.businessPlaceId` (P2-15) — `AttendanceRecord` still carries no
   *  business-place link, so the muster roll and overtime registers filter by the employee set
   *  a business place resolves to. */
  private async assertBusinessPlace(businessPlaceId?: string): Promise<bigint | undefined> {
    if (!businessPlaceId) return undefined;
    const id = BigInt(businessPlaceId);
    const bp = await prisma.businessPlace.findUnique({ where: { id } });
    if (!bp) throw new ApiError(400, "Business place not found");
    return id;
  }

  /** The active employee ids attached to a business place, for registers (muster roll, overtime)
   *  that filter `AttendanceRecord` rows rather than `Employee` rows directly. */
  private async employeeIdsFor(businessPlaceId: bigint): Promise<bigint[]> {
    const rows = await prisma.employee.findMany({
      where: { businessPlaceId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ── 1. Muster roll ────────────────────────────────────────────────────────────
  async musterRoll(month: string, businessPlaceIdInput?: string) {
    const businessPlaceId = await this.assertBusinessPlace(businessPlaceIdInput);
    const totalDays = daysInMonth(month);

    const employees = await prisma.employee.findMany({
      where: { status: "active", ...(businessPlaceId ? { businessPlaceId } : {}) },
      include: { department: { select: { name: true } } },
      orderBy: { empCode: "asc" },
    });
    const records = await prisma.attendanceRecord.findMany({
      where: { date: { startsWith: month } },
    });

    const byEmployee = new Map<string, Map<string, (typeof records)[number]>>();
    for (const r of records) {
      const key = r.employeeId.toString();
      if (!byEmployee.has(key)) byEmployee.set(key, new Map());
      byEmployee.get(key)!.set(r.date, r);
    }

    const rows = employees.map((e) => {
      const empRecords = byEmployee.get(e.id.toString()) ?? new Map();
      const days: Array<{ date: string; code: string | null; otHours: number }> = [];
      let present = 0,
        absent = 0,
        half = 0,
        leave = 0,
        weekOff = 0,
        otHours = 0;
      for (let d = 1; d <= totalDays; d++) {
        const date = `${month}-${String(d).padStart(2, "0")}`;
        const rec = empRecords.get(date);
        const code = rec ? (ATTENDANCE_CODE[rec.status] ?? null) : null;
        const ot = rec ? Number(rec.otHours) : 0;
        days.push({ date, code, otHours: ot });
        if (rec) {
          if (rec.status === "PRESENT") present++;
          else if (rec.status === "ABSENT") absent++;
          else if (rec.status === "HALF_DAY") half++;
          else if (rec.status === "WEEKLY_OFF") weekOff++;
          else if (rec.status === "LEAVE_PAID" || rec.status === "LEAVE_UNPAID") leave++;
        }
        otHours += ot;
      }
      return {
        employeeId: e.id.toString(),
        employeeCode: e.empCode,
        employeeName: e.fullName,
        department: e.department?.name ?? "",
        designation: e.designation ?? "",
        days,
        totals: {
          present,
          absent,
          halfDay: half,
          leave,
          weekOff,
          otHours: n2(otHours),
        },
      };
    });

    return { month, totalDays, rows };
  }

  // ── 2. Wages register ────────────────────────────────────────────────────────
  async wages(month: string, businessPlaceIdInput?: string) {
    const businessPlaceId = await this.assertBusinessPlace(businessPlaceIdInput);

    const results = await prisma.payrollResult.findMany({
      where: {
        payrollRun: { period: month },
        ...(businessPlaceId ? { employee: { businessPlaceId } } : {}),
      },
      include: {
        payrollRun: true,
        employee: { include: { payrollConfig: true } },
      },
      orderBy: { employeeCode: "asc" },
    });

    const fineTotals = await this.fineDeductionTotalsForMonth(month, "FINE");
    const otherTotals = await this.fineDeductionTotalsForMonth(month, "DEDUCTION");

    const rows = results.map((r) => {
      const pc = r.employee.payrollConfig;
      const basic = pc ? Number(pc.basicSalary) : 0;
      const allowances = pc ? Number(pc.da) + Number(pc.hra) + Number(pc.otherAllowance) : 0;
      const fine = fineTotals.get(r.employeeId.toString()) ?? 0;
      const otherFromRegister = otherTotals.get(r.employeeId.toString()) ?? 0;
      const paidOn = r.payrollRun.approvedAt ?? r.payrollRun.lockedAt ?? null;
      return {
        employeeId: r.employeeId.toString(),
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        designation: r.employee.designation ?? "",
        daysWorked: Number(r.presentDays),
        rate: Number(r.dailyRate),
        basic,
        allowances,
        otWages: Number(r.otPay),
        gross: Number(r.grossSalary),
        pf: Number(r.employeePf),
        esi: Number(r.employeeEsi),
        professionalTax: Number(r.professionalTax),
        // Tax on salary for the month, from PayrollResult.salaryTds (P2-02/P2-16).
        tds: Number(r.salaryTds),
        fines: fine,
        advancesRecovered: Number(r.salaryAdvance),
        others: Number(r.otherDeductions) + Number(r.loanRecovery) + otherFromRegister,
        totalDeductions:
          Number(r.employeePf) +
          Number(r.employeeEsi) +
          Number(r.professionalTax) +
          Number(r.salaryTds) +
          fine +
          Number(r.salaryAdvance) +
          Number(r.otherDeductions) +
          Number(r.loanRecovery) +
          otherFromRegister,
        net: Number(r.netSalary),
        paymentMode: r.paymentMode,
        paymentDate: paidOn ? paidOn.toISOString().slice(0, 10) : null,
      };
    });

    return { month, rows };
  }

  // ── 3. Overtime register ─────────────────────────────────────────────────────
  async overtime(month: string, businessPlaceIdInput?: string) {
    const businessPlaceId = await this.assertBusinessPlace(businessPlaceIdInput);
    const employeeFilter = businessPlaceId ? await this.employeeIdsFor(businessPlaceId) : null;
    const companyId = requireTenantId();
    const config = await payrollService.getConfig(companyId);
    const workingHours =
      Number(config.defaultWorkingHoursPerDay) > 0 ? Number(config.defaultWorkingHoursPerDay) : 8;

    const records = await prisma.attendanceRecord.findMany({
      where: {
        date: { startsWith: month },
        otHours: { gt: 0 },
        ...(employeeFilter ? { employeeId: { in: employeeFilter } } : {}),
      },
      orderBy: [{ employeeId: "asc" }, { date: "asc" }],
    });
    const employees = await prisma.employee.findMany({
      where: { id: { in: records.map((r) => r.employeeId) } },
      select: { id: true, empCode: true, fullName: true },
    });
    const employeeById = new Map(employees.map((e) => [e.id.toString(), e]));

    const quarterMonths = quarterMonthsUpTo(month);
    const quarterRecords = await prisma.attendanceRecord.findMany({
      where: { OR: quarterMonths.map((m) => ({ date: { startsWith: m } })), otHours: { gt: 0 } },
      select: { employeeId: true, otHours: true },
    });
    const quarterTotals = new Map<string, number>();
    for (const r of quarterRecords) {
      const key = r.employeeId.toString();
      quarterTotals.set(key, (quarterTotals.get(key) ?? 0) + Number(r.otHours));
    }

    // The real breach, as flagged by payroll runs against the running quarterly total (P2-16) —
    // not the ad-hoc `cumulativeQuarterHours > cap` above, which is an attendance-only estimate
    // that can differ from what a run actually banked once the running-hours count of a run and
    // this month's raw attendance no longer coincide (a corrected attendance entry, a deleted
    // run, and so on).
    const { key: quarterKey } = quarterBoundsFor(`${month}-01`);
    const quarterPeriods = await prisma.overtimeQuarterPeriod.findMany({
      where: { quarterKey },
      select: { employeeId: true, hoursAccrued: true, breached: true },
    });
    const breachByEmployee = new Map(
      quarterPeriods.map((p) => [p.employeeId.toString(), p.breached])
    );

    // Best available daily rate per employee: the persisted result for this period if the run
    // exists, else the current payroll config (not a point-in-time snapshot — documented gap).
    const results = await prisma.payrollResult.findMany({
      where: { payrollRun: { period: month } },
      select: { employeeId: true, dailyRate: true },
    });
    const rateByEmployee = new Map<string, number>();
    for (const r of results) rateByEmployee.set(r.employeeId.toString(), Number(r.dailyRate));

    const configs = await prisma.employeePayrollConfig.findMany({
      where: { employeeId: { in: records.map((r) => r.employeeId) } },
    });
    const configByEmployee = new Map(configs.map((c) => [c.employeeId.toString(), c]));
    const monthDays = daysInMonth(month);

    const rows = records.map((r) => {
      const key = r.employeeId.toString();
      let dailyRate = rateByEmployee.get(key);
      if (dailyRate === undefined) {
        const pc = configByEmployee.get(key);
        dailyRate = pc ? Number(pc.monthlySalary) / monthDays : 0;
      }
      const normalRate = n2(dailyRate / workingHours);
      const otRate = n2(normalRate * OVERTIME_MULTIPLIER);
      const otHours = Number(r.otHours);
      const cumulativeQuarterHours = n2(quarterTotals.get(key) ?? 0);
      const emp = employeeById.get(key);
      return {
        employeeId: key,
        employeeCode: emp?.empCode ?? "",
        employeeName: emp?.fullName ?? "",
        date: r.date,
        otHours,
        normalRate,
        otRate,
        otWages: n2(otHours * otRate),
        cumulativeQuarterHours,
        quarterlyCap: QUARTERLY_OVERTIME_CAP,
        overCap: cumulativeQuarterHours > QUARTERLY_OVERTIME_CAP,
        // The breach payroll itself recorded for the quarter (P2-16); false when no run has
        // posted for this quarter yet, distinct from `overCap` above, which is only an estimate.
        payrollBreach: breachByEmployee.get(key) ?? false,
      };
    });

    return { month, quarterMonths, rows };
  }

  // ── 4/5. Fines and deductions ────────────────────────────────────────────────
  /** Sum of a kind's fine/deduction amounts per employee within one calendar month. */
  private async fineDeductionTotalsForMonth(
    month: string,
    kind: "FINE" | "DEDUCTION"
  ): Promise<Map<string, number>> {
    const rows = await prisma.employeeFineDeduction.findMany({
      where: {
        kind,
        status: "APPROVED",
        occurredOn: {
          gte: new Date(`${month}-01T00:00:00Z`),
          lte: new Date(`${monthEnd(month)}T23:59:59Z`),
        },
      },
      select: { employeeId: true, amount: true },
    });
    const totals = new Map<string, number>();
    for (const r of rows) {
      const key = r.employeeId.toString();
      totals.set(key, (totals.get(key) ?? 0) + Number(r.amount));
    }
    return totals;
  }

  private async finesOrDeductions(
    kind: "FINE" | "DEDUCTION",
    from: string,
    to: string,
    businessPlaceId?: bigint
  ) {
    const rows = await prisma.employeeFineDeduction.findMany({
      where: {
        kind,
        status: "APPROVED",
        occurredOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) },
        ...(businessPlaceId ? { employee: { businessPlaceId } } : {}),
      },
      include: { employee: { select: { empCode: true, fullName: true } } },
      orderBy: [{ occurredOn: "asc" }],
    });

    const lines = rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId.toString(),
      employeeCode: r.employee.empCode,
      employeeName: r.employee.fullName,
      date: r.occurredOn.toISOString().slice(0, 10),
      cause: r.cause,
      amount: Number(r.amount),
      shownCauseGiven: r.shownCauseGiven,
      // P2-13: whether payroll has already taken this as an "other deduction".
      recovered: r.recoveredInPayrollResultId !== null,
      recoveredInPayrollResultId: r.recoveredInPayrollResultId,
    }));
    const total = n2(lines.reduce((s, l) => s + l.amount, 0));

    let ceilingChecks: Array<{
      employeeId: string;
      employeeCode: string;
      month: string;
      totalFines: number;
      wageCeiling: number | null;
      breach: boolean | null;
    }> = [];
    if (kind === "FINE") {
      // The 3% ceiling (Payment of Wages Act s.8(3)) applies per wage period — grouped here by
      // the calendar month the fine falls in, against that month's gross wage where it exists.
      const byEmpMonth = new Map<
        string,
        { employeeId: string; employeeCode: string; month: string; total: number }
      >();
      for (const r of rows) {
        const month = r.occurredOn.toISOString().slice(0, 7);
        const key = `${r.employeeId}:${month}`;
        const entry = byEmpMonth.get(key) ?? {
          employeeId: r.employeeId.toString(),
          employeeCode: r.employee.empCode,
          month,
          total: 0,
        };
        entry.total += Number(r.amount);
        byEmpMonth.set(key, entry);
      }
      const months = Array.from(new Set(Array.from(byEmpMonth.values()).map((v) => v.month)));
      const wageResults =
        months.length > 0
          ? await prisma.payrollResult.findMany({
              where: { payrollRun: { period: { in: months } } },
              select: {
                employeeId: true,
                grossSalary: true,
                payrollRun: { select: { period: true } },
              },
            })
          : [];
      const grossByEmpMonth = new Map<string, number>();
      for (const wr of wageResults) {
        grossByEmpMonth.set(`${wr.employeeId}:${wr.payrollRun.period}`, Number(wr.grossSalary));
      }
      ceilingChecks = Array.from(byEmpMonth.entries()).map(([key, v]) => {
        const gross = grossByEmpMonth.get(key) ?? null;
        const wageCeiling = gross === null ? null : n2(gross * 0.03);
        return {
          employeeId: v.employeeId,
          employeeCode: v.employeeCode,
          month: v.month,
          totalFines: n2(v.total),
          wageCeiling,
          breach: wageCeiling === null ? null : v.total > wageCeiling,
        };
      });
    }

    return { from, to, rows: lines, total, ceilingChecks };
  }

  async fines(from: string, to: string, businessPlaceIdInput?: string) {
    const businessPlaceId = await this.assertBusinessPlace(businessPlaceIdInput);
    return this.finesOrDeductions("FINE", from, to, businessPlaceId);
  }

  async deductions(from: string, to: string, businessPlaceIdInput?: string) {
    const businessPlaceId = await this.assertBusinessPlace(businessPlaceIdInput);
    const { ceilingChecks, ...rest } = await this.finesOrDeductions(
      "DEDUCTION",
      from,
      to,
      businessPlaceId
    );
    return rest;
  }

  // ── 6. Advances register ─────────────────────────────────────────────────────
  async advances(from: string, to: string, businessPlaceIdInput?: string) {
    const businessPlaceId = await this.assertBusinessPlace(businessPlaceIdInput);
    const rows = await prisma.salaryAdvance.findMany({
      where: {
        disbursedDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) },
        ...(businessPlaceId ? { employee: { businessPlaceId } } : {}),
      },
      include: { employee: { select: { empCode: true, fullName: true } } },
      orderBy: { disbursedDate: "asc" },
    });
    const lines = rows.map((a) => {
      const amount = Number(a.amount);
      const recovered = Number(a.recoveredAmount);
      return {
        id: a.id,
        employeeId: a.employeeId.toString(),
        employeeCode: a.employee.empCode,
        employeeName: a.employee.fullName,
        date: a.disbursedDate.toISOString().slice(0, 10),
        amount,
        purpose: a.reason ?? "",
        recoveredToDate: recovered,
        balance: n2(amount - recovered),
        status: a.status,
      };
    });
    return { from, to, rows: lines, total: n2(lines.reduce((s, l) => s + l.amount, 0)) };
  }
}

export const registersService = new RegistersService();
