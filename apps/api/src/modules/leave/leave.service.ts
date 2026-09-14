import type { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { labourService } from "../payroll/labour.service";
import { notify } from "../notifications/notify";
import { fyCodeFor, iso, leaveRequestDays } from "./leave.calc";

/**
 * Leave requests: dated applications against the leave ledger `labour.service.ts` already keeps
 * (P2-09).
 *
 * The ledger stays the source of truth for balances — this module only ever moves `taken` on a
 * `LeaveBalance` row, the same field `labourService.takeLeave` moves, so a balance looks the same
 * whether it was adjusted by hand or through a request. Approving deducts; rejecting leaves the
 * balance alone because nothing was taken; cancelling an approved request adds the days back
 * rather than deleting the request, so the calendar and the audit trail both keep the history.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const asDate = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00Z`);

type Tx = Prisma.TransactionClient;

class LeaveService {
  // ── Shared lookups ────────────────────────────────────────────────────────
  private async weeklyOffDays(): Promise<number[]> {
    const config = await prisma.payrollConfig.findUnique({
      where: { companyId: requireTenantId() },
      select: { weeklyOffDays: true },
    });
    const days = (config?.weeklyOffDays as unknown as number[]) ?? [0];
    return Array.isArray(days) && days.length > 0 ? days : [0];
  }

  private async holidaysBetween(from: Date, to: Date): Promise<Set<string>> {
    const rows = await prisma.holiday.findMany({
      where: { holidayOn: { gte: from, lte: to } },
      select: { holidayOn: true },
    });
    return new Set(rows.map((r) => iso(r.holidayOn)));
  }

  private async employee(employeeId: string) {
    const employee = await prisma.employee.findUnique({ where: { id: BigInt(employeeId) } });
    if (!employee) throw new ApiError(404, "That employee does not exist");
    return employee;
  }

  private async leaveType(code: string) {
    // Lazily seeds the tenant's default leave types the same way `GET /labour/leave-types`
    // does, so a request against a freshly provisioned tenant that has never opened that
    // screen still finds EL/CL/SL/LWP instead of a false 404.
    await labourService.leaveTypes(true);
    const type = await prisma.leaveType.findFirst({ where: { code: code.trim().toUpperCase() } });
    if (!type || !type.isActive) throw new ApiError(404, "That leave type does not exist");
    return type;
  }

  private async balance(employeeId: bigint, leaveTypeId: string, fyCode: string, tx: Tx = prisma) {
    return tx.leaveBalance.findUnique({
      where: {
        companyId_employeeId_leaveTypeId_fyCode: {
          companyId: requireTenantId(),
          employeeId,
          leaveTypeId,
          fyCode,
        },
      },
    });
  }

  private available(
    balance: { opening: unknown; accrued: unknown; taken: unknown; encashed: unknown } | null
  ) {
    if (!balance) return 0;
    return n2(
      Number(balance.opening) +
        Number(balance.accrued) -
        Number(balance.taken) -
        Number(balance.encashed)
    );
  }

  /** Moves `taken` on the ledger by `delta` (positive on approval, negative on a restore). */
  private async applyLedgerDelta(
    tx: Tx,
    employeeId: bigint,
    leaveTypeId: string,
    fyCode: string,
    delta: number
  ) {
    const where = {
      companyId_employeeId_leaveTypeId_fyCode: {
        companyId: requireTenantId(),
        employeeId,
        leaveTypeId,
        fyCode,
      },
    };
    const existing = await tx.leaveBalance.findUnique({ where });
    const taken = n2((existing ? Number(existing.taken) : 0) + delta);
    const opening = existing ? Number(existing.opening) : 0;
    const accrued = existing ? Number(existing.accrued) : 0;
    const encashed = existing ? Number(existing.encashed) : 0;
    const closing = n2(opening + accrued - taken - encashed);
    return tx.leaveBalance.upsert({
      where,
      create: { employeeId, leaveTypeId, fyCode, taken, closing },
      update: { taken, closing },
    });
  }

  // ── Requests ─────────────────────────────────────────────────────────────
  async listRequests(filters: {
    employeeId?: string;
    status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
    fyCode?: string;
    from?: string;
    to?: string;
  }) {
    return prisma.leaveRequest.findMany({
      where: {
        ...(filters.employeeId ? { employeeId: BigInt(filters.employeeId) } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.fyCode ? { fyCode: filters.fyCode } : {}),
        ...(filters.from ? { toDate: { gte: asDate(filters.from) } } : {}),
        ...(filters.to ? { fromDate: { lte: asDate(filters.to) } } : {}),
      },
      include: { leaveType: { select: { code: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async createRequest(
    input: {
      employeeId: string;
      leaveTypeCode: string;
      fromDate: string;
      toDate: string;
      halfDayStart?: boolean;
      halfDayEnd?: boolean;
      reason?: string;
    },
    actor: { userId?: string }
  ) {
    const employee = await this.employee(input.employeeId);
    const type = await this.leaveType(input.leaveTypeCode);
    const fromDate = asDate(input.fromDate);
    const toDate = asDate(input.toDate);
    if (toDate.getTime() < fromDate.getTime()) {
      throw new ApiError(400, "The leave cannot end before it starts", "BAD_RANGE");
    }

    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: ["PENDING", "APPROVED"] },
        fromDate: { lte: toDate },
        toDate: { gte: fromDate },
      },
    });
    if (overlap) {
      throw new ApiError(
        409,
        "That employee already has a leave request over some of these dates",
        "OVERLAP"
      );
    }

    const [weeklyOffDays, holidays] = await Promise.all([
      this.weeklyOffDays(),
      this.holidaysBetween(fromDate, toDate),
    ]);
    const days = leaveRequestDays({
      fromDate,
      toDate,
      halfDayStart: input.halfDayStart,
      halfDayEnd: input.halfDayEnd,
      weeklyOffDays,
      holidays,
    });
    if (days <= 0) {
      throw new ApiError(400, "That range is entirely weekly-offs and holidays", "NO_WORKING_DAYS");
    }

    const fyCode = fyCodeFor(fromDate);
    const balance = await this.balance(employee.id, type.id, fyCode);
    const available = this.available(balance);
    if (days > available && !type.allowNegative) {
      throw new ApiError(
        409,
        `Only ${available} day(s) of ${type.code} are left`,
        "INSUFFICIENT_LEAVE"
      );
    }

    const row = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: type.id,
        fyCode,
        fromDate,
        toDate,
        halfDayStart: input.halfDayStart ?? false,
        halfDayEnd: input.halfDayEnd ?? false,
        days,
        reason: input.reason?.trim().slice(0, 255) ?? null,
        appliedBy: actor.userId?.slice(0, 36) ?? null,
      },
      include: { leaveType: { select: { code: true, name: true } } },
    });

    await notify({
      category: "leave",
      title: `${employee.fullName} applied for ${days} day(s) of ${type.code}`,
      body: `${iso(fromDate)} to ${iso(toDate)}${input.reason ? ` — ${input.reason}` : ""}`,
      link: `/hr/leave?request=${row.id}`,
      to: { permission: "leave.approve" },
      level: "INFO",
      createdBy: actor.userId,
    });

    return row;
  }

  async approve(id: string, actor: { userId?: string }, comments?: string) {
    return prisma
      .$transaction(async (tx) => {
        const row = await tx.leaveRequest.findUnique({ where: { id } });
        if (!row) throw new ApiError(404, "That leave request does not exist");
        if (row.status !== "PENDING") {
          throw new ApiError(
            409,
            `That request is already ${row.status.toLowerCase()}`,
            "NOT_PENDING"
          );
        }
        const type = await tx.leaveType.findUniqueOrThrow({ where: { id: row.leaveTypeId } });
        const balance = await this.balance(row.employeeId, row.leaveTypeId, row.fyCode, tx);
        const available = this.available(balance);
        if (Number(row.days) > available && !type.allowNegative) {
          throw new ApiError(
            409,
            `Only ${available} day(s) of ${type.code} are left`,
            "INSUFFICIENT_LEAVE"
          );
        }
        await this.applyLedgerDelta(
          tx,
          row.employeeId,
          row.leaveTypeId,
          row.fyCode,
          Number(row.days)
        );
        return tx.leaveRequest.update({
          where: { id },
          data: {
            status: "APPROVED",
            approverId: actor.userId?.slice(0, 36) ?? null,
            decidedAt: new Date(),
            comments: comments?.slice(0, 255) ?? null,
          },
        });
      })
      .then(async (row) => {
        await this.notifyDecision(row.id, "approved");
        return row;
      });
  }

  async reject(id: string, actor: { userId?: string }, comments?: string) {
    const row = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "That leave request does not exist");
    if (row.status !== "PENDING") {
      throw new ApiError(409, `That request is already ${row.status.toLowerCase()}`, "NOT_PENDING");
    }
    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approverId: actor.userId?.slice(0, 36) ?? null,
        decidedAt: new Date(),
        comments: comments?.slice(0, 255) ?? null,
      },
    });
    await this.notifyDecision(updated.id, "rejected");
    return updated;
  }

  /** Cancels a request. A pending one is simply withdrawn; an approved one gives the days back. */
  async cancel(id: string, actor: { userId?: string }, comments?: string) {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.leaveRequest.findUnique({ where: { id } });
      if (!row) throw new ApiError(404, "That leave request does not exist");
      if (row.status !== "PENDING" && row.status !== "APPROVED") {
        throw new ApiError(
          409,
          `That request is already ${row.status.toLowerCase()}`,
          "NOT_CANCELLABLE"
        );
      }
      if (row.status === "APPROVED") {
        // Restore rather than delete: the ledger's `taken` moves back down, and the request
        // stays on record as CANCELLED with when it happened.
        await this.applyLedgerDelta(
          tx,
          row.employeeId,
          row.leaveTypeId,
          row.fyCode,
          -Number(row.days)
        );
      }
      return tx.leaveRequest.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          comments: comments?.slice(0, 255) ?? row.comments,
          approverId:
            row.status === "PENDING"
              ? row.approverId
              : (actor.userId?.slice(0, 36) ?? row.approverId),
        },
      });
    });
    await this.notifyDecision(updated.id, "cancelled");
    return updated;
  }

  private async notifyDecision(requestId: string, outcome: "approved" | "rejected" | "cancelled") {
    const row = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { leaveType: { select: { code: true } } },
    });
    if (!row) return;
    const employee = await prisma.employee.findUnique({
      where: { id: row.employeeId },
      select: { fullName: true },
    });
    const user = await prisma.user.findUnique({
      where: { employeeId: row.employeeId },
      select: { userId: true },
    });
    if (!user) return;
    await notify({
      category: "leave",
      title: `Your ${row.leaveType.code} request was ${outcome}`,
      body: `${iso(row.fromDate)} to ${iso(row.toDate)}${row.comments ? ` — ${row.comments}` : ""}`,
      link: `/me/leave?request=${row.id}`,
      to: { userIds: [user.userId] },
      level: outcome === "rejected" ? "WARNING" : "INFO",
    });
  }

  // ── Calendar ─────────────────────────────────────────────────────────────
  async calendar(month: string, departmentId?: number) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0));
    const requests = await prisma.leaveRequest.findMany({
      where: { status: "APPROVED", fromDate: { lte: end }, toDate: { gte: start } },
      orderBy: { fromDate: "asc" },
      take: 1000,
    });
    if (requests.length === 0) {
      return { month, from: iso(start), to: iso(end), count: 0, rows: [] as unknown[] };
    }
    const employeeIds = [...new Set(requests.map((r) => r.employeeId))];
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds }, ...(departmentId ? { departmentId } : {}) },
      select: {
        id: true,
        empCode: true,
        fullName: true,
        departmentId: true,
        department: { select: { name: true } },
      },
    });
    const byId = new Map(employees.map((e) => [e.id.toString(), e]));
    const leaveTypeIds = [...new Set(requests.map((r) => r.leaveTypeId))];
    const types = await prisma.leaveType.findMany({ where: { id: { in: leaveTypeIds } } });
    const typeById = new Map(types.map((t) => [t.id, t]));

    const rows = requests
      .filter((r) => byId.has(r.employeeId.toString()))
      .map((r) => {
        const e = byId.get(r.employeeId.toString())!;
        return {
          requestId: r.id,
          employeeId: String(r.employeeId),
          employeeCode: e.empCode,
          employeeName: e.fullName,
          departmentId: e.departmentId,
          departmentName: e.department?.name ?? null,
          leaveTypeCode: typeById.get(r.leaveTypeId)?.code ?? null,
          fromDate: iso(r.fromDate),
          toDate: iso(r.toDate),
          halfDayStart: r.halfDayStart,
          halfDayEnd: r.halfDayEnd,
          days: Number(r.days),
        };
      });
    return { month, from: iso(start), to: iso(end), count: rows.length, rows };
  }

  // ── Self-service ─────────────────────────────────────────────────────────
  /** The calling user's own balances and requests; 200 with `linked:false` when there is no employee record. */
  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { userId }, select: { employeeId: true } });
    if (!user?.employeeId) return { linked: false as const, balances: [], requests: [] };
    const employeeId = user.employeeId;
    const [employee, balances, requests] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, empCode: true, fullName: true },
      }),
      prisma.leaveBalance.findMany({
        where: { employeeId },
        include: { leaveType: { select: { code: true, name: true, encashable: true } } },
        orderBy: { fyCode: "desc" },
        take: 50,
      }),
      prisma.leaveRequest.findMany({
        where: { employeeId },
        include: { leaveType: { select: { code: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    if (!employee) return { linked: false as const, balances: [], requests: [] };
    return { linked: true as const, employee, balances, requests };
  }

  // ── Accrual (used by the monthly job) ───────────────────────────────────
  /**
   * Cumulative attendance from the start of the financial year through the end of `asOf`'s
   * month, so a call to `labourService.accrue` — which sets the ledger's `accrued` to an
   * absolute figure rather than adding to it — always lands on the right total. That also makes
   * a second run for the same month a no-op: the cumulative totals do not change.
   */
  async attendanceToDate(employeeId: bigint, asOf: Date) {
    const fyStartYear = asOf.getUTCMonth() >= 3 ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
    const fyStart = new Date(Date.UTC(fyStartYear, 3, 1));
    const monthEnd = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0));
    const from = iso(fyStart);
    const to = iso(monthEnd);
    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: from, lte: to } },
      select: { status: true, date: true },
    });
    const daysWorked = records.reduce((s, r) => {
      if (r.status === "PRESENT" || r.status === "LEAVE_PAID") return s + 1;
      if (r.status === "HALF_DAY") return s + 0.5;
      return s;
    }, 0);
    const monthsWorked = Math.min(
      12,
      Math.max(0, (asOf.getUTCFullYear() - fyStartYear) * 12 + (asOf.getUTCMonth() - 3) + 1)
    );
    return { fyCode: fyCodeFor(fyStart), daysWorked: n2(daysWorked), monthsWorked };
  }

  /** One tenant's monthly accrual: every active employee, once. */
  async accrueForTenant(asOf: Date) {
    const employees = await prisma.employee.findMany({
      where: { status: "active" },
      select: { id: true },
      take: 5000,
    });
    let accrued = 0;
    for (const e of employees) {
      const { fyCode, daysWorked, monthsWorked } = await this.attendanceToDate(e.id, asOf);
      await labourService.accrue(
        { employeeId: String(e.id), fyCode, daysWorked, monthsWorked },
        {}
      );
      accrued++;
    }
    return { employees: employees.length, accrued };
  }
}

export const leaveService = new LeaveService();
