import { Prisma, VoucherType, type LeaveAccrualBasis } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";
import {
  carryForward,
  gratuity,
  leaveAccrued,
  leaveEncashment,
  settle,
  statutoryBonus,
} from "./labour.calc";

/**
 * Leave, gratuity, bonus and the final settlement (P1-17b).
 *
 * These are liabilities the company carries whether or not it has noticed them. The register is
 * kept as a running balance rather than derived on demand, because leave is argued about and the
 * argument is always "what did I have at the start of the year" — a recomputation cannot answer
 * that once the policy has changed.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (v: string | Date) =>
  new Date(typeof v === "string" ? `${v.slice(0, 10)}T00:00:00Z` : v);

const fyRange = (fyCode: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(fyCode);
  if (!m) throw new ApiError(400, "A financial year looks like 2026-27");
  const y = Number(m[1]);
  return { from: new Date(Date.UTC(y, 3, 1)), to: new Date(Date.UTC(y + 1, 2, 31)) };
};

/** The Indian financial year (April–March) that a date falls in, as `YYYY-YY`. */
const fyCodeFor = (d: Date): string => {
  const y = d.getUTCFullYear();
  const fyStartYear = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
};

/** The leave a factory typically gives, as a starting point. */
export const DEFAULT_LEAVE_TYPES = [
  {
    code: "EL",
    name: "Earned Leave",
    daysPerYear: 18,
    basis: "DAYS_WORKED" as LeaveAccrualBasis,
    daysWorkedPerDay: 20,
    carryForwardMax: 30,
    encashable: true,
  },
  {
    code: "CL",
    name: "Casual Leave",
    daysPerYear: 7,
    basis: "ANNUAL" as LeaveAccrualBasis,
    daysWorkedPerDay: 20,
    carryForwardMax: 0,
    encashable: false,
  },
  {
    code: "SL",
    name: "Sick Leave",
    daysPerYear: 7,
    basis: "ANNUAL" as LeaveAccrualBasis,
    daysWorkedPerDay: 20,
    carryForwardMax: 0,
    encashable: false,
  },
];

class LabourService {
  // ── Holidays ───────────────────────────────────────────────────────────────
  async holidays(fyCode?: string) {
    const range = fyCode ? fyRange(fyCode) : null;
    return prisma.holiday.findMany({
      where: range ? { holidayOn: { gte: range.from, lte: range.to } } : {},
      orderBy: { holidayOn: "asc" },
      take: 500,
    });
  }

  async addHoliday(input: {
    holidayOn: string | Date;
    name: string;
    kind?: string;
    stateCode?: string | null;
    isPaid?: boolean;
  }) {
    return prisma.holiday.upsert({
      where: {
        companyId_holidayOn_name: {
          companyId: requireTenantId(),
          holidayOn: asDate(input.holidayOn),
          name: input.name.trim().slice(0, 120),
        },
      },
      create: {
        holidayOn: asDate(input.holidayOn),
        name: input.name.trim().slice(0, 120),
        kind: input.kind ?? "FESTIVAL",
        stateCode: input.stateCode ?? null,
        isPaid: input.isPaid ?? true,
      },
      update: {
        kind: input.kind ?? "FESTIVAL",
        stateCode: input.stateCode ?? null,
        isPaid: input.isPaid ?? true,
      },
    });
  }

  // ── Leave ──────────────────────────────────────────────────────────────────
  async leaveTypes(includeInactive = false) {
    const existing = await prisma.leaveType.findMany({ orderBy: { code: "asc" } });
    if (existing.length === 0) {
      await prisma.leaveType.createMany({
        data: DEFAULT_LEAVE_TYPES.map((t) => ({ companyId: requireTenantId(), ...t })),
        skipDuplicates: true,
      });
      return prisma.leaveType.findMany({ orderBy: { code: "asc" } });
    }
    return includeInactive ? existing : existing.filter((t) => t.isActive);
  }

  async upsertLeaveType(input: {
    code: string;
    name: string;
    daysPerYear: number;
    basis?: LeaveAccrualBasis;
    daysWorkedPerDay?: number;
    isPaid?: boolean;
    carryForwardMax?: number;
    encashable?: boolean;
    isActive?: boolean;
  }) {
    const code = input.code.trim().toUpperCase();
    const data = {
      name: input.name.trim().slice(0, 80),
      daysPerYear: input.daysPerYear,
      basis: input.basis ?? ("ANNUAL" as LeaveAccrualBasis),
      daysWorkedPerDay: input.daysWorkedPerDay ?? 20,
      isPaid: input.isPaid ?? true,
      carryForwardMax: input.carryForwardMax ?? 0,
      encashable: input.encashable ?? false,
      isActive: input.isActive ?? true,
    };
    return prisma.leaveType.upsert({
      where: { companyId_code: { companyId: requireTenantId(), code } },
      create: { code, ...data },
      update: data,
    });
  }

  async balances(fyCode: string, employeeId?: string) {
    return prisma.leaveBalance.findMany({
      where: { fyCode, ...(employeeId ? { employeeId: BigInt(employeeId) } : {}) },
      include: { leaveType: { select: { code: true, name: true, encashable: true } } },
      take: 2000,
    });
  }

  /**
   * Accrues leave for an employee up to a point in the year.
   *
   * The opening is taken from what carried forward and is then left alone: it is what the
   * employee had, and re-deriving it from a policy that has since changed would rewrite history.
   */
  async accrue(
    input: {
      employeeId: string;
      fyCode: string;
      monthsWorked?: number;
      daysWorked?: number;
      opening?: number;
    },
    _actor: { userId?: string }
  ) {
    const types = await this.leaveTypes();
    const out = [];
    for (const type of types) {
      const accrued = leaveAccrued({
        basis: type.basis,
        daysPerYear: Number(type.daysPerYear),
        daysWorkedPerDay: type.daysWorkedPerDay,
        monthsWorked: input.monthsWorked,
        daysWorked: input.daysWorked,
      });
      const where = {
        companyId_employeeId_leaveTypeId_fyCode: {
          companyId: requireTenantId(),
          employeeId: BigInt(input.employeeId),
          leaveTypeId: type.id,
          fyCode: input.fyCode,
        },
      };
      const existing = await prisma.leaveBalance.findUnique({ where });
      const opening = existing ? Number(existing.opening) : (input.opening ?? 0);
      const taken = existing ? Number(existing.taken) : 0;
      const encashed = existing ? Number(existing.encashed) : 0;
      const closing = n2(opening + accrued - taken - encashed);
      out.push(
        await prisma.leaveBalance.upsert({
          where,
          create: {
            employeeId: BigInt(input.employeeId),
            leaveTypeId: type.id,
            fyCode: input.fyCode,
            opening,
            accrued,
            closing,
          },
          update: { accrued, closing },
        })
      );
    }
    return out;
  }

  /**
   * The monthly leave-accrual job (P2-T): recomputes every active employee's leave to date for
   * the financial year containing `monthEnd`, from attendance recorded since the FY began (or
   * since the employee joined, if that is later). One query for all employees' attendance rather
   * than one per employee, since this runs for the whole tenant at once.
   */
  async accrueForMonth(monthEnd: Date, actor: { userId?: string } = {}) {
    const fyCode = fyCodeFor(monthEnd);
    const { from } = fyRange(fyCode);
    const toStr = iso(monthEnd);
    const employees = await prisma.employee.findMany({
      where: { status: "active" },
      select: { id: true, dateOfJoining: true },
    });
    if (employees.length === 0) return { fyCode, employees: 0 };

    const fromStr = iso(from);
    const attendance = await prisma.attendanceRecord.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        date: { gte: fromStr, lte: toStr },
        status: { in: ["PRESENT", "HALF_DAY"] },
      },
      select: { employeeId: true, status: true },
    });
    const daysByEmployee = new Map<string, number>();
    for (const row of attendance) {
      const key = row.employeeId.toString();
      const add = row.status === "HALF_DAY" ? 0.5 : 1;
      daysByEmployee.set(key, (daysByEmployee.get(key) ?? 0) + add);
    }

    const monthsWorked = Math.min(
      12,
      Math.max(
        1,
        (monthEnd.getUTCFullYear() - from.getUTCFullYear()) * 12 +
          (monthEnd.getUTCMonth() - from.getUTCMonth()) +
          1
      )
    );

    const results = [];
    for (const emp of employees) {
      const daysWorked = daysByEmployee.get(emp.id.toString()) ?? 0;
      results.push(
        await this.accrue(
          { employeeId: emp.id.toString(), fyCode, daysWorked, monthsWorked },
          actor
        )
      );
    }
    return { fyCode, employees: employees.length, balances: results.flat().length };
  }

  /** Records leave taken, refusing what the employee does not have. */
  async takeLeave(input: {
    employeeId: string;
    leaveTypeCode: string;
    fyCode: string;
    days: number;
  }) {
    const type = await prisma.leaveType.findFirst({
      where: { code: input.leaveTypeCode.trim().toUpperCase() },
    });
    if (!type) throw new ApiError(404, "That leave type does not exist");
    const where = {
      companyId_employeeId_leaveTypeId_fyCode: {
        companyId: requireTenantId(),
        employeeId: BigInt(input.employeeId),
        leaveTypeId: type.id,
        fyCode: input.fyCode,
      },
    };
    const balance = await prisma.leaveBalance.findUnique({ where });
    if (!balance)
      throw new ApiError(400, "That employee has no balance for the year", "NO_BALANCE");
    const available = n2(
      Number(balance.opening) +
        Number(balance.accrued) -
        Number(balance.taken) -
        Number(balance.encashed)
    );
    if (input.days > available) {
      throw new ApiError(
        409,
        `Only ${available} day(s) of that leave are left`,
        "INSUFFICIENT_LEAVE"
      );
    }
    const taken = n2(Number(balance.taken) + input.days);
    return prisma.leaveBalance.update({
      where,
      data: { taken, closing: n2(available - input.days) },
    });
  }

  /** Closes the year: what is over the cap lapses rather than accumulating for ever. */
  async closeLeaveYear(fyCode: string) {
    const balances = await prisma.leaveBalance.findMany({
      where: { fyCode },
      include: { leaveType: true },
    });
    let lapsedDays = 0;
    for (const b of balances) {
      const { carried, lapsed } = carryForward(
        Number(b.closing),
        Number(b.leaveType.carryForwardMax)
      );
      lapsedDays = n2(lapsedDays + lapsed);
      await prisma.leaveBalance.update({
        where: { id: b.id },
        data: { lapsed, closing: carried },
      });
    }
    return { fyCode, balances: balances.length, lapsedDays };
  }

  // ── Gratuity and bonus ─────────────────────────────────────────────────────
  /**
   * What gratuity the company is carrying, employee by employee.
   *
   * Everyone still employed, valued as if they left today. It is a liability whether or not
   * anyone has resigned, and a company that only computes it on resignation is carrying an
   * unrecorded one.
   */
  async gratuityLiability(asOn = new Date()) {
    const employees = await prisma.employee.findMany({
      where: { status: "active", dateOfJoining: { not: null } },
      take: 2000,
    });
    const rows = employees
      .map((e) => {
        const wage = n2(e.basicSalary ?? 0);
        const g = gratuity({
          joinedOn: e.dateOfJoining as Date,
          leftOn: asOn,
          lastDrawnWage: wage,
        });
        return {
          employeeId: String(e.id),
          employeeCode: e.empCode,
          employeeName: e.fullName,
          joinedOn: e.dateOfJoining ? iso(e.dateOfJoining) : null,
          lastDrawnWage: wage,
          ...g,
        };
      })
      .filter((r) => r.serviceYears > 0);
    return {
      asOn: iso(asOn),
      employees: rows.length,
      eligible: rows.filter((r) => r.eligible).length,
      total: n2(rows.reduce((s, r) => s + r.amount, 0)),
      rows: rows.sort((a, b) => b.amount - a.amount),
    };
  }

  /** The year's statutory bonus, employee by employee. */
  async bonusForYear(fyCode: string, percent?: number, minimumWage?: number) {
    fyRange(fyCode);
    const employees = await prisma.employee.findMany({ where: { status: "active" }, take: 2000 });
    const rows = employees.map((e) => {
      const wage = n2(e.basicSalary ?? 0);
      const b = statutoryBonus({ monthlyWage: wage, monthsWorked: 12, percent, minimumWage });
      return {
        employeeId: String(e.id),
        employeeCode: e.empCode,
        employeeName: e.fullName,
        monthlyWage: wage,
        ...b,
      };
    });
    return {
      fyCode,
      percent: percent ?? 8.33,
      eligible: rows.filter((r) => r.eligible).length,
      total: n2(rows.reduce((s, r) => s + r.amount, 0)),
      rows: rows.filter((r) => r.eligible).sort((a, b) => b.amount - a.amount),
    };
  }

  // ── Full and final ─────────────────────────────────────────────────────────
  /** Works out a settlement without recording it, so the numbers can be looked at first. */
  async previewSettlement(input: {
    employeeId: string;
    separationOn: string | Date;
    lastWorkingDay?: string | Date;
    noticeDaysRequired?: number;
    noticeDaysServed?: number;
    salaryDue?: number;
    otherDues?: number;
    advanceRecovery?: number;
    otherRecovery?: number;
    bonus?: number;
    fyCode?: string;
  }) {
    const employee = await prisma.employee.findUnique({
      where: { id: BigInt(input.employeeId) },
    });
    if (!employee) throw new ApiError(404, "That employee does not exist");
    const separationOn = asDate(input.separationOn);
    const lastWorkingDay = asDate(input.lastWorkingDay ?? input.separationOn);
    const wage = n2(employee.basicSalary ?? 0);

    const g = employee.dateOfJoining
      ? gratuity({ joinedOn: employee.dateOfJoining, leftOn: separationOn, lastDrawnWage: wage })
      : { serviceYears: 0, countedYears: 0, eligible: false, amount: 0, cappedAtCeiling: false };

    // Only leave the policy says can be encashed is encashed.
    const balances = input.fyCode
      ? await prisma.leaveBalance.findMany({
          where: { employeeId: BigInt(input.employeeId), fyCode: input.fyCode },
          include: { leaveType: true },
        })
      : [];
    const encashableDays = balances
      .filter((b) => b.leaveType.encashable)
      .reduce((s, b) => s + Number(b.closing), 0);
    const encashment = leaveEncashment(encashableDays, wage);

    const outcome = settle({
      salaryDue: n2(input.salaryDue ?? 0),
      leaveEncashment: encashment,
      gratuity: g.amount,
      bonus: n2(input.bonus ?? 0),
      otherDues: n2(input.otherDues ?? 0),
      noticeDaysRequired: input.noticeDaysRequired ?? 0,
      noticeDaysServed: input.noticeDaysServed ?? 0,
      monthlyWage: wage,
      advanceRecovery: n2(input.advanceRecovery ?? 0),
      otherRecovery: n2(input.otherRecovery ?? 0),
    });

    return {
      employeeId: String(employee.id),
      employeeCode: employee.empCode,
      employeeName: employee.fullName,
      separationOn: iso(separationOn),
      lastWorkingDay: iso(lastWorkingDay),
      lastDrawnWage: wage,
      serviceYears: g.serviceYears,
      countedYears: g.countedYears,
      gratuityEligible: g.eligible,
      gratuity: g.amount,
      encashableDays: n2(encashableDays),
      leaveEncashment: encashment,
      salaryDue: n2(input.salaryDue ?? 0),
      bonus: n2(input.bonus ?? 0),
      otherDues: n2(input.otherDues ?? 0),
      ...outcome,
    };
  }

  async createSettlement(
    input: Parameters<LabourService["previewSettlement"]>[0] & { reason?: string | null },
    actor: { userId?: string }
  ) {
    const preview = await this.previewSettlement(input);
    const separationOn = asDate(input.separationOn);
    const data = {
      employeeId: BigInt(input.employeeId),
      employeeCode: preview.employeeCode,
      separationOn,
      lastWorkingDay: asDate(input.lastWorkingDay ?? input.separationOn),
      reason: input.reason ?? null,
      noticeDaysRequired: input.noticeDaysRequired ?? 0,
      noticeDaysServed: input.noticeDaysServed ?? 0,
      salaryDue: preview.salaryDue,
      leaveEncashment: preview.leaveEncashment,
      gratuity: preview.gratuity,
      bonus: preview.bonus,
      otherDues: preview.otherDues,
      noticeRecovery: preview.noticeRecovery,
      advanceRecovery: n2(input.advanceRecovery ?? 0),
      otherRecovery: n2(input.otherRecovery ?? 0),
      netPayable: preview.netPayable,
      yearsOfService: preview.serviceYears,
      lastDrawnWage: preview.lastDrawnWage,
      gratuityEligible: preview.gratuityEligible,
      preparedBy: actor.userId?.slice(0, 36) ?? null,
    };
    return prisma.finalSettlement.upsert({
      where: {
        companyId_employeeId_separationOn: {
          companyId: requireTenantId(),
          employeeId: BigInt(input.employeeId),
          separationOn,
        },
      },
      create: data,
      update: data,
    });
  }

  async settlements(status?: string) {
    return prisma.finalSettlement.findMany({
      where: status ? { status: status as "DRAFT" } : {},
      orderBy: { separationOn: "desc" },
      take: 200,
    });
  }

  /**
   * Approves a settlement and posts it: the dues as a cost, the recoveries against them, and what
   * is left over owed to the employee until it is paid.
   */
  async approveSettlement(id: string, actor: { userId?: string }) {
    const row = await prisma.finalSettlement.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "That settlement does not exist");
    if (row.status !== "DRAFT") {
      throw new ApiError(
        409,
        `That settlement is already ${row.status.toLowerCase()}`,
        "NOT_DRAFT"
      );
    }
    const on = row.lastWorkingDay;

    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      await periodService.assertPostingAllowed(on, undefined, tx);
      const ledger = async (code: string) => {
        const found = await tx.accountLedger.findFirst({ where: { code } });
        if (!found) throw new ApiError(500, `Missing ledger ${code}`, "MISSING_LEDGER");
        return found;
      };
      const salaries = await ledger("SAL-EXP-001");
      const gratuityLedger = await ledger("GRATUITY-EXP-001");
      const payable = await ledger("SAL-PAY-001");

      const D = (n: number) => new Prisma.Decimal(n2(n));
      const items = [];
      const salaryPart = n2(
        Number(row.salaryDue) +
          Number(row.leaveEncashment) +
          Number(row.bonus) +
          Number(row.otherDues)
      );
      if (salaryPart > 0) {
        items.push({
          debitLedgerId: salaries.id,
          debitAmount: D(salaryPart),
          creditAmount: D(0),
          narration: `Settlement dues — ${row.employeeCode}`,
        });
      }
      // Gratuity is its own expense; it is a retirement benefit, not salary.
      if (Number(row.gratuity) > 0) {
        items.push({
          debitLedgerId: gratuityLedger.id,
          debitAmount: D(Number(row.gratuity)),
          creditAmount: D(0),
          narration: `Gratuity — ${row.employeeCode}`,
        });
      }
      const recoveries = n2(
        Number(row.noticeRecovery) + Number(row.advanceRecovery) + Number(row.otherRecovery)
      );
      if (recoveries > 0) {
        // The recovery reduces the cost rather than becoming income: the company is getting back
        // what it already paid out.
        items.push({
          creditLedgerId: salaries.id,
          debitAmount: D(0),
          creditAmount: D(recoveries),
          narration: `Recoveries — ${row.employeeCode}`,
        });
      }
      const net = n2(Number(row.netPayable));
      if (net > 0) {
        items.push({
          creditLedgerId: payable.id,
          debitAmount: D(0),
          creditAmount: D(net),
          narration: `Settlement payable — ${row.employeeCode}`,
        });
      } else if (net < 0) {
        // A settlement can come out negative when the notice recovery exceeds the dues; the
        // employee owes the company, and that is a receivable rather than something to hide.
        items.push({
          debitLedgerId: (await ledger("DEBT-001")).id,
          debitAmount: D(-net),
          creditAmount: D(0),
          narration: `Recoverable from ${row.employeeCode}`,
        });
      }

      const voucher = await tx.voucher.create({
        data: {
          voucherNo: `FNF-${row.employeeCode}`.slice(0, 30),
          type: VoucherType.JOURNAL,
          date: on,
          narration: `Full and final settlement — ${row.employeeCode}`,
          refDocType: "FINAL_SETTLEMENT",
          refDocId: row.id,
          createdBy: actor.userId?.slice(0, 36) ?? null,
          items: { create: items },
        },
      });

      return tx.finalSettlement.update({
        where: { id },
        data: {
          status: "APPROVED",
          voucherId: voucher.id,
          approvedBy: actor.userId?.slice(0, 36) ?? null,
          approvedAt: new Date(),
        },
      });
    });
  }
}

export const labourService = new LabourService();
