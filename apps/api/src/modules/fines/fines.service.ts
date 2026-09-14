/**
 * Fines and deductions (P2-13): entry, the employee's chance to show cause, approval against
 * the Code on Wages' 3% ceiling, and cancellation — the source the fines/deductions registers
 * (P2-03) and payroll recovery (payroll.service.ts) both read.
 *
 * A fine (Payment of Wages Act s.8) needs the employee heard before it can be approved, and the
 * sum of a period's approved fines for one employee can never exceed 3% of that period's gross
 * wage. A deduction for damage/loss (s.10) has no such ceiling: the amount entered at creation
 * *is* the loss, so there is nothing further to cap.
 */
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import type { CreateFineInput, ListFinesQuery, ShowCauseInput } from "./fines.validation";

const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

const EMPLOYEE_SELECT = { select: { empCode: true, fullName: true } } as const;

class FinesService {
  async create(input: CreateFineInput) {
    const employee = await prisma.employee.findUnique({ where: { id: BigInt(input.employeeId) } });
    if (!employee) throw new ApiError(404, "That employee does not exist");

    return prisma.employeeFineDeduction.create({
      data: {
        employeeId: BigInt(input.employeeId),
        kind: input.kind,
        occurredOn: new Date(`${input.occurredOn}T00:00:00Z`),
        cause: input.cause,
        amount: n2(input.amount),
        wagePeriod: input.wagePeriod,
        status: "PENDING",
      },
      include: { employee: EMPLOYEE_SELECT },
    });
  }

  private async findOrThrow(id: string) {
    const row = await prisma.employeeFineDeduction.findUnique({
      where: { id },
      include: { employee: EMPLOYEE_SELECT },
    });
    if (!row) throw new ApiError(404, "That fine or deduction does not exist");
    return row;
  }

  async get(id: string) {
    return this.findOrThrow(id);
  }

  async list(query: ListFinesQuery) {
    const rows = await prisma.employeeFineDeduction.findMany({
      where: {
        ...(query.employeeId ? { employeeId: BigInt(query.employeeId) } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.wagePeriod ? { wagePeriod: query.wagePeriod } : {}),
        ...(query.from || query.to
          ? {
              occurredOn: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
                ...(query.to ? { lte: new Date(`${query.to}T23:59:59Z`) } : {}),
              },
            }
          : {}),
      },
      include: { employee: EMPLOYEE_SELECT },
      orderBy: [{ occurredOn: "desc" }],
      take: 500,
    });
    return rows.map((r) => ({ ...r, recovered: r.recoveredInPayrollResultId !== null }));
  }

  /** Records that the employee was heard before a fine is imposed (Payment of Wages Act s.8). */
  async showCause(id: string, input: ShowCauseInput) {
    const row = await this.findOrThrow(id);
    if (row.status !== "PENDING") {
      throw new ApiError(409, "Only a pending item can record a show-cause notice", "NOT_PENDING");
    }
    return prisma.employeeFineDeduction.update({
      where: { id },
      data: {
        shownCauseGiven: true,
        showCauseDate: new Date(`${input.showCauseDate}T00:00:00Z`),
        showCauseRemarks: input.showCauseRemarks,
      },
      include: { employee: EMPLOYEE_SELECT },
    });
  }

  /**
   * Approves a fine or deduction. A FINE cannot be approved until the employee has been heard,
   * and approving it must not take the wage period's approved fines for that employee over 3%
   * of the period's gross wage — checked against `PayrollResult` when a run for the period
   * already exists; when none does yet, there is nothing to check against and the approval goes
   * through (the register still reports the breach once a run exists, same as before).
   */
  async approve(id: string, actor: { userId?: string }) {
    const row = await this.findOrThrow(id);
    if (row.status === "CANCELLED")
      throw new ApiError(409, "That item was cancelled", "ALREADY_CANCELLED");
    if (row.status === "APPROVED")
      throw new ApiError(409, "That item is already approved", "ALREADY_APPROVED");
    if (row.kind === "FINE" && !row.shownCauseGiven) {
      throw new ApiError(
        400,
        "Record the employee's show-cause before approving a fine",
        "SHOW_CAUSE_REQUIRED"
      );
    }

    if (row.kind === "FINE") {
      const priorApproved = await prisma.employeeFineDeduction.aggregate({
        where: {
          employeeId: row.employeeId,
          kind: "FINE",
          wagePeriod: row.wagePeriod,
          status: "APPROVED",
        },
        _sum: { amount: true },
      });
      const totalIfApproved = n2(Number(priorApproved._sum.amount ?? 0) + Number(row.amount));
      const wageResult = await prisma.payrollResult.findFirst({
        where: { employeeId: row.employeeId, payrollRun: { period: row.wagePeriod } },
        select: { grossSalary: true },
      });
      if (wageResult) {
        const ceiling = n2(Number(wageResult.grossSalary) * 0.03);
        if (totalIfApproved > ceiling) {
          throw new ApiError(
            409,
            `Approving this fine would take the wage period's fines for this employee to ₹${totalIfApproved.toFixed(2)}, over the 3% ceiling of ₹${ceiling.toFixed(2)}`,
            "FINE_CEILING_EXCEEDED",
            { ceiling, total: totalIfApproved }
          );
        }
      }
    }

    return prisma.employeeFineDeduction.update({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: actor.userId ?? null },
      include: { employee: EMPLOYEE_SELECT },
    });
  }

  /** Cancels a fine or deduction; refused once payroll has already recovered it. */
  async cancel(id: string, reason: string, actor: { userId?: string }) {
    const row = await this.findOrThrow(id);
    if (row.status === "CANCELLED")
      throw new ApiError(409, "That item was already cancelled", "ALREADY_CANCELLED");
    if (row.recoveredInPayrollResultId) {
      throw new ApiError(
        409,
        "This item was already recovered in a payroll run and cannot be cancelled",
        "ALREADY_RECOVERED"
      );
    }
    return prisma.employeeFineDeduction.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: actor.userId ?? null,
        cancelReason: reason,
      },
      include: { employee: EMPLOYEE_SELECT },
    });
  }
}

export const finesService = new FinesService();
