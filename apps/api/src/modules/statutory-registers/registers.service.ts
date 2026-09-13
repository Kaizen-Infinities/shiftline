import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";

/**
 * The inspector's registers (P2T-03): the muster roll, the wages register, the overtime
 * register, the register of fines, the register of deductions and the register of advances the
 * Factories Act and the Labour Codes require a factory to keep and produce on demand.
 *
 * None of it is separately maintained — every register is read straight off attendance and
 * payroll data that already exists. There is nothing to keep in sync because there is nothing
 * else: recompute the payroll run or re-enter attendance and the register's answer changes with
 * it, which is the point.
 */

const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

const ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "WEEKLY_OFF",
  "HOLIDAY",
  "LEAVE_PAID",
  "LEAVE_UNPAID",
] as const;

/** The calendar days a `YYYY-MM` period covers, as `YYYY-MM-DD` strings. */
const daysInMonth = (period: string): string[] => {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new ApiError(400, "A period looks like 2026-08");
  const [, y, mo] = m;
  const last = new Date(Number(y), Number(mo), 0).getDate();
  return Array.from({ length: last }, (_, i) => `${y}-${mo}-${String(i + 1).padStart(2, "0")}`);
};

/** The calendar days a payroll run's `period` covers, whether monthly (`YYYY-MM`) or ISO-weekly
 * (`YYYY-Www`) — enough to look up attendance rows for the overtime register. */
const daysInRunPeriod = (period: string): string[] => {
  if (/^\d{4}-\d{2}$/.test(period)) return daysInMonth(period);
  const m = /^(\d{4})-W(\d{2})$/.exec(period);
  if (!m) return [];
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - (dow - 1) + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
};

const dateRange = (from?: string, to?: string) => {
  if (!from || !to) {
    throw new ApiError(400, "Both from and to dates are required", "MISSING_RANGE");
  }
  return { from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T23:59:59Z`) };
};

class RegistersService {
  /** Form-25-shaped: who was present, absent or on leave, on every day of the month. */
  async musterRoll(period: string) {
    const dates = daysInMonth(period);
    const employees = await prisma.employee.findMany({
      where: { status: "active" },
      select: { id: true, empCode: true, fullName: true, designation: true },
      orderBy: { empCode: "asc" },
      take: 2000,
    });
    const attendance = await prisma.attendanceRecord.findMany({
      where: { date: { gte: dates[0], lte: dates[dates.length - 1] } },
      select: {
        employeeId: true,
        date: true,
        status: true,
        otHours: true,
        lateMinutes: true,
        permissionMinutes: true,
      },
    });
    const byEmployee = new Map<string, (typeof attendance)[number][]>();
    for (const row of attendance) {
      const key = row.employeeId.toString();
      const list = byEmployee.get(key) ?? [];
      list.push(row);
      byEmployee.set(key, list);
    }

    const rows = employees.map((emp) => {
      const own = byEmployee.get(emp.id.toString()) ?? [];
      const byDate = new Map(own.map((r) => [r.date, r]));
      const days = dates.map((date) => {
        const r = byDate.get(date);
        return {
          date,
          status: r?.status ?? null,
          otHours: n2(r?.otHours),
          lateMinutes: r?.lateMinutes ?? 0,
          permissionMinutes: r?.permissionMinutes ?? 0,
        };
      });
      const totals = Object.fromEntries(
        ATTENDANCE_STATUSES.map((s) => [s, days.filter((d) => d.status === s).length])
      ) as Record<(typeof ATTENDANCE_STATUSES)[number], number>;
      return {
        employeeId: emp.id.toString(),
        employeeCode: emp.empCode,
        employeeName: emp.fullName,
        designation: emp.designation ?? null,
        days,
        totals,
      };
    });
    return { period, days: dates.length, employees: rows };
  }

  private async run(runId: number) {
    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiError(404, "That payroll run does not exist");
    return run;
  }

  /** Every deduction a run made, employee by employee, named rather than lumped together. */
  private async deductionLines(runId: number) {
    const [run, results] = await Promise.all([
      this.run(runId),
      prisma.payrollResult.findMany({
        where: { payrollRunId: runId },
        orderBy: { employeeCode: "asc" },
      }),
    ]);
    const employeeIds = results.map((r) => r.employeeId);
    const permanentDeductions = employeeIds.length
      ? await prisma.employeePermanentDeduction.findMany({
          where: { employeeId: { in: employeeIds }, isActive: true },
        })
      : [];
    const byEmployee = new Map<string, typeof permanentDeductions>();
    for (const d of permanentDeductions) {
      const key = d.employeeId.toString();
      const list = byEmployee.get(key) ?? [];
      list.push(d);
      byEmployee.set(key, list);
    }
    return { run, results, byEmployee };
  }

  /** What each employee earned and was paid for one payroll run. */
  async wages(runId: number) {
    const { run, results } = await this.deductionLines(runId);
    return {
      runId,
      runCode: run.runCode,
      period: run.period,
      type: run.type,
      employees: results.map((r) => ({
        employeeId: r.employeeId.toString(),
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        department: r.department,
        // r.presentDays already folds half days in (payroll.service.ts computes it as
        // presentDays + halfDays * 0.5 before storing it) — adding halfDays again would
        // double-count them.
        daysPaid: n2(r.presentDays),
        grossWages: n2(r.grossSalary),
        totalDeductions: n2(r.totalDeductions),
        netWages: n2(r.netSalary),
        paymentMode: r.paymentMode,
      })),
    };
  }

  /** Overtime hours worked, day by day, and what the run paid for them. */
  async overtime(runId: number) {
    const { run, results } = await this.deductionLines(runId);
    const dates = daysInRunPeriod(run.period);
    const employeeIds = results.map((r) => r.employeeId);
    const attendance =
      dates.length && employeeIds.length
        ? await prisma.attendanceRecord.findMany({
            where: {
              employeeId: { in: employeeIds },
              date: { gte: dates[0], lte: dates[dates.length - 1] },
              otHours: { gt: 0 },
            },
            select: { employeeId: true, date: true, otHours: true },
            orderBy: { date: "asc" },
          })
        : [];
    const byEmployee = new Map<string, typeof attendance>();
    for (const row of attendance) {
      const key = row.employeeId.toString();
      const list = byEmployee.get(key) ?? [];
      list.push(row);
      byEmployee.set(key, list);
    }
    return {
      runId,
      runCode: run.runCode,
      period: run.period,
      employees: results
        .filter((r) => Number(r.otHours) > 0)
        .map((r) => ({
          employeeId: r.employeeId.toString(),
          employeeCode: r.employeeCode,
          employeeName: r.employeeName,
          days: (byEmployee.get(r.employeeId.toString()) ?? []).map((a) => ({
            date: a.date,
            otHours: n2(a.otHours),
          })),
          totalOtHours: n2(r.otHours),
          otWagesPaid: n2(r.otPay),
        })),
    };
  }

  /** Statutory and other deductions, itemised, for one payroll run. */
  async deductions(runId: number) {
    const { run, results, byEmployee } = await this.deductionLines(runId);
    return {
      runId,
      runCode: run.runCode,
      period: run.period,
      employees: results.map((r) => {
        const other = (byEmployee.get(r.employeeId.toString()) ?? []).filter(
          (d) => d.type !== "LOAN_EMI"
        );
        return {
          employeeId: r.employeeId.toString(),
          employeeCode: r.employeeCode,
          employeeName: r.employeeName,
          providentFund: n2(r.employeePf),
          esi: n2(r.employeeEsi),
          professionalTax: n2(r.professionalTax),
          lateEntry: n2(r.lateEntryDeduction),
          permission: n2(r.permissionDeduction),
          salaryAdvance: n2(r.salaryAdvance),
          loanRecovery: n2(r.loanRecovery),
          other: other.map((d) => ({ type: d.type, label: d.label, amount: n2(d.amount) })),
          total: n2(r.totalDeductions),
        };
      }),
    };
  }

  /**
   * The register of fines (Payment of Wages Act). `EmployeePermanentDeduction` has no
   * fine-specific date, so this reports by `createdAt` (when it was recorded) within the range
   * and `isActive` (whether it is still being deducted) — the closest honest reading of a model
   * that was not built with a fines register in mind.
   */
  async fines(from?: string, to?: string) {
    const range = dateRange(from, to);
    const rows = await prisma.employeePermanentDeduction.findMany({
      where: { type: "FINE", createdAt: { gte: range.from, lte: range.to } },
      include: { employee: { select: { empCode: true, fullName: true } } },
      orderBy: { createdAt: "asc" },
      take: 2000,
    });
    return {
      from,
      to,
      rows: rows.map((r) => ({
        employeeCode: r.employee.empCode,
        employeeName: r.employee.fullName,
        label: r.label,
        amount: n2(r.amount),
        isActive: r.isActive,
        recordedAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** The register of advances: disbursed, recovered and outstanding, in a date range. */
  async advances(from?: string, to?: string) {
    const range = dateRange(from, to);
    const rows = await prisma.salaryAdvance.findMany({
      where: { disbursedDate: { gte: range.from, lte: range.to } },
      include: { employee: { select: { empCode: true, fullName: true } } },
      orderBy: { disbursedDate: "asc" },
      take: 2000,
    });
    return {
      from,
      to,
      rows: rows.map((r) => ({
        employeeCode: r.employee.empCode,
        employeeName: r.employee.fullName,
        disbursedDate: r.disbursedDate.toISOString().slice(0, 10),
        amount: n2(r.amount),
        recovered: n2(r.recoveredAmount),
        outstanding: n2(Number(r.amount) - Number(r.recoveredAmount)),
        status: r.status,
      })),
    };
  }
}

export const registersService = new RegistersService();
