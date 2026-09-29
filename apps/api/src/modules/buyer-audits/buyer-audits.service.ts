import type { Prisma } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  addDays,
  asDate,
  canMoveAction,
  canMoveAudit,
  dailyHoursCheck,
  hoursBreaches,
  hoursForDay,
  isDueSoon,
  isFindingOpen,
  isOverdue,
  iso,
  minimumWageCheck,
  monthEnd,
  monthsInRange,
  openFindingsCheck,
  otCapCheck,
  overdueActionsCheck,
  quarterKey,
  quarterStart,
  readinessBand,
  readinessPercent,
  registersCheck,
  shiftHours,
  weekStart,
  weeklyHoursCheck,
  type ActionStatus,
  type AuditStatus,
  type DayHours,
  type EmployeeRef,
  type MonthRegisterData,
  type QuarterOt,
  type WageRow,
} from "./buyer-audits.calc";
import type {
  actionBody,
  cancelBody,
  createBody,
  findingBody,
  listQuery,
  readinessQuery,
  updateActionBody,
  updateBody,
  updateFindingBody,
} from "./buyer-audits.validation";

/**
 * Buyer social-compliance audits (TN-08): the audit calendar, findings, corrective actions and
 * the readiness report. Every query goes through the tenant-scoped client from `lib/prisma.ts`,
 * so a foreign company's audits, buyers, users and employees read as absent (404) here.
 */
type Actor = { userId?: string };

const today = () => asDate(new Date());
/** The widest readiness window: a year, so the attendance read stays bounded. */
const MAX_RANGE_DAYS = 366;

const include = {
  customer: { select: { id: true, firmName: true } },
  findings: {
    orderBy: { seq: "asc" },
    include: { actions: { orderBy: { createdAt: "asc" } } },
  },
} as const;

type AuditFull = Prisma.BuyerAuditGetPayload<{ include: typeof include }>;
type ActionRowDb = AuditFull["findings"][number]["actions"][number];

const actionDto = (a: ActionRowDb, t: Date) => ({
  id: a.id,
  findingId: a.findingId,
  action: a.action,
  ownerUserId: a.ownerUserId,
  ownerEmployeeId: a.ownerEmployeeId !== null ? a.ownerEmployeeId.toString() : null,
  ownerName: a.ownerName,
  dueDate: iso(a.dueDate),
  status: a.status,
  evidenceNote: a.evidenceNote,
  closedOn: a.closedOn ? iso(a.closedOn) : null,
  overdue: isOverdue(a, t),
  dueSoon: isDueSoon(a, t),
});

const summaryOf = (a: AuditFull, t: Date) => {
  const open = { CRITICAL: 0, MAJOR: 0, MINOR: 0, OBSERVATION: 0 };
  let overdueActions = 0;
  let openActions = 0;
  for (const f of a.findings) {
    if (isFindingOpen(f.actions)) open[f.severity] += 1;
    for (const ca of f.actions) {
      if (ca.status === "OPEN" || ca.status === "IN_PROGRESS") openActions += 1;
      if (isOverdue(ca, t)) overdueActions += 1;
    }
  }
  return { findingCount: a.findings.length, openFindings: open, openActions, overdueActions };
};

const headerDto = (a: AuditFull, t: Date) => ({
  id: a.id,
  auditNo: a.auditNo,
  standard: a.standard,
  customerId: a.customerId,
  customerName: a.customer?.firmName ?? null,
  auditorFirm: a.auditorFirm,
  auditorName: a.auditorName,
  scheduledDate: iso(a.scheduledDate),
  actualDate: a.actualDate ? iso(a.actualDate) : null,
  status: a.status,
  rating: a.rating,
  nextAuditDue: a.nextAuditDue ? iso(a.nextAuditDue) : null,
  remarks: a.remarks,
  cancelReason: a.cancelReason,
  daysToGo:
    a.status === "PLANNED" || a.status === "IN_PROGRESS"
      ? Math.round((a.scheduledDate.getTime() - t.getTime()) / 86_400_000)
      : null,
  ...summaryOf(a, t),
});

const detailDto = (a: AuditFull, t: Date) => ({
  ...headerDto(a, t),
  findings: a.findings.map((f) => ({
    id: f.id,
    seq: f.seq,
    area: f.area,
    severity: f.severity,
    clauseRef: f.clauseRef,
    description: f.description,
    open: isFindingOpen(f.actions),
    actions: f.actions.map((ca) => actionDto(ca, t)),
  })),
});

class BuyerAuditsService {
  private async load(id: string): Promise<AuditFull> {
    const audit = await prisma.buyerAudit.findFirst({ where: { id }, include });
    if (!audit) throw new ApiError(404, "That audit does not exist");
    return audit;
  }

  private assertOpen(audit: { status: string }) {
    if (audit.status === "CANCELLED") {
      throw new ApiError(409, "This audit is cancelled and can no longer be changed");
    }
  }

  private async assertCustomer(customerId: string) {
    const c = await prisma.customer.findFirst({ where: { id: customerId }, select: { id: true } });
    if (!c) throw new ApiError(404, "That buyer does not exist");
  }

  /** The action owner — a user or an employee of this company — and the name to show. */
  private async resolveOwner(body: {
    ownerUserId?: string;
    ownerEmployeeId?: string;
  }): Promise<{ ownerUserId: string | null; ownerEmployeeId: bigint | null; ownerName: string }> {
    if (body.ownerUserId) {
      const u = await prisma.user.findFirst({
        where: { userId: body.ownerUserId },
        select: { userId: true, fullName: true },
      });
      if (!u) throw new ApiError(404, "That user does not exist");
      return { ownerUserId: u.userId, ownerEmployeeId: null, ownerName: u.fullName };
    }
    const e = await prisma.employee.findFirst({
      where: { id: BigInt(body.ownerEmployeeId!) },
      select: { id: true, fullName: true, empCode: true },
    });
    if (!e) throw new ApiError(404, "That employee does not exist");
    return { ownerUserId: null, ownerEmployeeId: e.id, ownerName: `${e.fullName} (${e.empCode})` };
  }

  async list(q: z.infer<typeof listQuery>) {
    const where: Prisma.BuyerAuditWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.standard) where.standard = q.standard;
    if (q.customerId) where.customerId = q.customerId;
    if (q.from || q.to) {
      where.scheduledDate = {
        ...(q.from ? { gte: asDate(q.from) } : {}),
        ...(q.to ? { lte: asDate(q.to) } : {}),
      };
    }
    const t = today();
    const rows = await prisma.buyerAudit.findMany({
      where,
      include,
      orderBy: [{ scheduledDate: "asc" }, { auditNo: "asc" }],
      take: 500,
    });
    return rows.map((a) => headerDto(a, t));
  }

  async get(id: string) {
    return detailDto(await this.load(id), today());
  }

  async create(body: z.infer<typeof createBody>, actor: Actor) {
    if (body.customerId) await this.assertCustomer(body.customerId);
    const auditNo = (body.auditNo ?? `${body.standard}-${body.scheduledDate}`).slice(0, 30);
    const clash = await prisma.buyerAudit.findFirst({ where: { auditNo }, select: { id: true } });
    if (clash) throw new ApiError(409, "An audit with that number already exists");
    const created = await prisma.buyerAudit.create({
      data: {
        auditNo,
        standard: body.standard,
        customerId: body.customerId ?? null,
        auditorFirm: body.auditorFirm || null,
        auditorName: body.auditorName || null,
        scheduledDate: asDate(body.scheduledDate),
        nextAuditDue: body.nextAuditDue ? asDate(body.nextAuditDue) : null,
        remarks: body.remarks || null,
        createdBy: actor.userId ?? null,
      },
    });
    return this.get(created.id);
  }

  /** Header edits; status moves forward only, and COMPLETED needs the actual audit date. */
  async update(id: string, body: z.infer<typeof updateBody>) {
    const audit = await this.load(id);
    this.assertOpen(audit);
    if (body.customerId) await this.assertCustomer(body.customerId);
    if (
      body.status &&
      body.status !== audit.status &&
      !canMoveAudit(audit.status as AuditStatus, body.status)
    ) {
      throw new ApiError(
        409,
        `An audit moves forward only; it cannot go from ${audit.status} back to ${body.status}`
      );
    }
    const status = body.status ?? audit.status;
    const actualDate =
      body.actualDate !== undefined
        ? body.actualDate
          ? asDate(body.actualDate)
          : null
        : audit.actualDate;
    if (status === "COMPLETED" && !actualDate) {
      throw new ApiError(400, "A completed audit needs the date it actually took place");
    }
    if (actualDate && actualDate.getTime() > today().getTime()) {
      throw new ApiError(400, "The actual audit date cannot be in the future");
    }
    const scheduled = body.scheduledDate ? asDate(body.scheduledDate) : audit.scheduledDate;
    const nextDue =
      body.nextAuditDue !== undefined
        ? body.nextAuditDue
          ? asDate(body.nextAuditDue)
          : null
        : audit.nextAuditDue;
    if (nextDue && nextDue.getTime() <= (actualDate ?? scheduled).getTime()) {
      throw new ApiError(400, "The next audit must be due after this one");
    }
    await prisma.buyerAudit.update({
      where: { id },
      data: {
        ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
        ...(body.auditorFirm !== undefined ? { auditorFirm: body.auditorFirm || null } : {}),
        ...(body.auditorName !== undefined ? { auditorName: body.auditorName || null } : {}),
        ...(body.scheduledDate ? { scheduledDate: scheduled } : {}),
        ...(body.rating !== undefined ? { rating: body.rating || null } : {}),
        ...(body.remarks !== undefined ? { remarks: body.remarks || null } : {}),
        nextAuditDue: nextDue,
        actualDate,
        status,
      },
    });
    return this.get(id);
  }

  /** No DELETE: an audit that will not happen is cancelled with a reason and kept. */
  async cancel(id: string, body: z.infer<typeof cancelBody>) {
    const audit = await this.load(id);
    if (!canMoveAudit(audit.status as AuditStatus, "CANCELLED")) {
      throw new ApiError(409, `A ${audit.status.toLowerCase()} audit cannot be cancelled`);
    }
    await prisma.buyerAudit.update({
      where: { id },
      data: { status: "CANCELLED", cancelReason: body.reason },
    });
    return this.get(id);
  }

  async addFinding(id: string, body: z.infer<typeof findingBody>) {
    const audit = await this.load(id);
    this.assertOpen(audit);
    const seq = audit.findings.reduce((m, f) => Math.max(m, f.seq), 0) + 1;
    await prisma.auditFinding.create({
      data: {
        companyId: audit.companyId,
        auditId: audit.id,
        seq,
        area: body.area,
        severity: body.severity,
        clauseRef: body.clauseRef || null,
        description: body.description,
      },
    });
    return this.get(id);
  }

  async updateFinding(id: string, findingId: string, body: z.infer<typeof updateFindingBody>) {
    const audit = await this.load(id);
    this.assertOpen(audit);
    const finding = audit.findings.find((f) => f.id === findingId);
    if (!finding) throw new ApiError(404, "That finding does not exist");
    await prisma.auditFinding.update({
      where: { id: finding.id },
      data: {
        ...(body.area ? { area: body.area } : {}),
        ...(body.severity ? { severity: body.severity } : {}),
        ...(body.clauseRef !== undefined ? { clauseRef: body.clauseRef || null } : {}),
        ...(body.description ? { description: body.description } : {}),
      },
    });
    return this.get(id);
  }

  async addAction(id: string, findingId: string, body: z.infer<typeof actionBody>, actor: Actor) {
    const audit = await this.load(id);
    this.assertOpen(audit);
    const finding = audit.findings.find((f) => f.id === findingId);
    if (!finding) throw new ApiError(404, "That finding does not exist");
    const owner = await this.resolveOwner(body);
    await prisma.correctiveAction.create({
      data: {
        companyId: audit.companyId,
        findingId: finding.id,
        action: body.action,
        ...owner,
        dueDate: asDate(body.dueDate),
        createdBy: actor.userId ?? null,
      },
    });
    return this.get(id);
  }

  /**
   * Status moves forward only (OPEN → IN_PROGRESS → DONE → VERIFIED; a step may be skipped).
   * DONE and VERIFIED need an evidence note; DONE stamps `closedOn` (today unless given).
   * A verified action is final.
   */
  async updateAction(
    id: string,
    actionId: string,
    body: z.infer<typeof updateActionBody>,
    actor: Actor
  ) {
    const audit = await this.load(id);
    this.assertOpen(audit);
    const action = audit.findings.flatMap((f) => f.actions).find((a) => a.id === actionId);
    if (!action) throw new ApiError(404, "That corrective action does not exist");
    if (action.status === "VERIFIED") {
      throw new ApiError(409, "A verified corrective action is closed and cannot change");
    }
    const from = action.status as ActionStatus;
    const to = (body.status ?? from) as ActionStatus;
    if (to !== from && !canMoveAction(from, to)) {
      throw new ApiError(
        409,
        `A corrective action moves forward only; it cannot go from ${from} back to ${to}`
      );
    }
    const evidence =
      body.evidenceNote !== undefined ? body.evidenceNote || null : action.evidenceNote;
    if ((to === "DONE" || to === "VERIFIED") && !evidence) {
      throw new ApiError(400, "Record the evidence before closing the corrective action");
    }
    let closedOn = action.closedOn;
    if ((to === "DONE" || to === "VERIFIED") && (!closedOn || body.closedOn)) {
      closedOn = body.closedOn ? asDate(body.closedOn) : today();
    }
    if (closedOn && closedOn.getTime() > today().getTime()) {
      throw new ApiError(400, "The closing date cannot be in the future");
    }
    const owner =
      body.ownerUserId || body.ownerEmployeeId ? await this.resolveOwner(body) : undefined;
    await prisma.correctiveAction.update({
      where: { id: action.id },
      data: {
        ...(body.action ? { action: body.action } : {}),
        ...(body.dueDate ? { dueDate: asDate(body.dueDate) } : {}),
        ...(owner ?? {}),
        evidenceNote: evidence,
        status: to,
        closedOn: to === "DONE" || to === "VERIFIED" ? closedOn : null,
        ...(to === "VERIFIED" && from !== "VERIFIED" ? { verifiedBy: actor.userId ?? null } : {}),
      },
    });
    return this.get(id);
  }

  /** People who can own a corrective action: active users and active employees. */
  async owners(q?: string) {
    const term = q?.trim();
    const [users, employees] = await Promise.all([
      prisma.user.findMany({
        where: {
          status: "active",
          ...(term ? { fullName: { contains: term, mode: "insensitive" } } : {}),
        },
        select: { userId: true, fullName: true },
        orderBy: { fullName: "asc" },
        take: 50,
      }),
      prisma.employee.findMany({
        where: {
          status: "active",
          ...(term
            ? {
                OR: [
                  { fullName: { contains: term, mode: "insensitive" } },
                  { empCode: { contains: term, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: { id: true, fullName: true, empCode: true },
        orderBy: { fullName: "asc" },
        take: 50,
      }),
    ]);
    return [
      ...users.map((u) => ({ kind: "USER" as const, id: u.userId, name: u.fullName })),
      ...employees.map((e) => ({
        kind: "EMPLOYEE" as const,
        id: e.id.toString(),
        name: `${e.fullName} (${e.empCode})`,
      })),
    ];
  }

  // ── Readiness ──────────────────────────────────────────────────────────────
  /**
   * The readiness report for a period (default: the last 90 days). Reads attendance (hours and
   * OT), payroll results (wage rates, the wages register), the OT quarter periods payroll keeps,
   * and this module's findings and corrective actions.
   */
  async readiness(q: z.infer<typeof readinessQuery>) {
    const t = today();
    const to = q.to ?? iso(t);
    const from = q.from ?? iso(addDays(asDate(to), -89));
    if ((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000 >= MAX_RANGE_DAYS) {
      throw new ApiError(400, "Pick a period of at most a year");
    }

    // Attendance for whole weeks around the period, and for every quarter it touches.
    const weekFrom = weekStart(from);
    const weekTo = iso(addDays(asDate(weekStart(to)), 6));
    const qFrom = quarterStart(from);
    const readFrom = qFrom < weekFrom ? qFrom : weekFrom;
    const readTo = weekTo > to ? weekTo : to;

    const [config, shifts, employees, attendance, payroll, otPeriods, findings] = await Promise.all(
      [
        prisma.payrollConfig.findFirst({ select: { defaultWorkingHoursPerDay: true } }),
        prisma.shift.findMany({
          select: {
            id: true,
            shiftCode: true,
            startTime: true,
            endTime: true,
            breakDuration: true,
          },
        }),
        prisma.employee.findMany({
          select: { id: true, empCode: true, fullName: true, status: true, shiftId: true },
        }),
        prisma.attendanceRecord.findMany({
          where: { date: { gte: readFrom, lte: readTo } },
          select: { employeeId: true, date: true, status: true, shiftId: true, otHours: true },
        }),
        prisma.payrollResult.findMany({
          where: { payrollRun: { period: { in: monthsInRange(from, to) } } },
          select: {
            employeeId: true,
            dailyRate: true,
            payrollRun: { select: { period: true } },
          },
        }),
        prisma.overtimeQuarterPeriod.findMany({
          where: { quarterKey: { in: Array.from(new Set([quarterKey(from), quarterKey(to)])) } },
          select: { employeeId: true, quarterKey: true, breached: true, hoursAccrued: true },
        }),
        prisma.auditFinding.findMany({
          where: { audit: { status: { not: "CANCELLED" } } },
          select: {
            id: true,
            severity: true,
            area: true,
            description: true,
            audit: { select: { auditNo: true } },
            actions: { select: { id: true, status: true, dueDate: true, action: true } },
          },
        }),
      ]
    );

    const defaultHours =
      config && Number(config.defaultWorkingHoursPerDay) > 0
        ? Number(config.defaultWorkingHoursPerDay)
        : 8;
    const shiftById = new Map(
      shifts.map((s) => [s.id, shiftHours(s.startTime, s.endTime, s.breakDuration)])
    );
    const shiftByCode = new Map(
      shifts.map((s) => [s.shiftCode, shiftHours(s.startTime, s.endTime, s.breakDuration)])
    );
    const empRef = new Map<string, EmployeeRef>();
    const empShift = new Map<string, string | null>();
    for (const e of employees) {
      empRef.set(e.id.toString(), { code: e.empCode, name: e.fullName });
      empShift.set(e.id.toString(), e.shiftId);
    }
    const normalHoursFor = (employeeId: string, shiftId: number | null) => {
      const byRecord = shiftId !== null ? shiftById.get(shiftId) : null;
      if (byRecord) return byRecord;
      const code = empShift.get(employeeId);
      const byEmployee = code ? shiftByCode.get(code) : null;
      return byEmployee ?? defaultHours;
    };

    // Hours: days within the whole weeks around the period.
    const days: DayHours[] = [];
    const quarterOt = new Map<string, QuarterOt>();
    for (const r of attendance) {
      const employeeId = r.employeeId.toString();
      const ot = Number(r.otHours);
      if (r.date >= weekFrom && r.date <= weekTo) {
        days.push({
          employeeId,
          date: r.date,
          hours: hoursForDay(r.status, normalHoursFor(employeeId, r.shiftId), ot),
        });
      }
      // Quarter-to-date OT up to the end of the period, for each quarter the period touches.
      if (ot > 0 && r.date <= to && r.date >= qFrom) {
        const key = `${employeeId}:${quarterKey(r.date)}`;
        const row = quarterOt.get(key) ?? { employeeId, quarter: quarterKey(r.date), hours: 0 };
        row.hours += ot;
        quarterOt.set(key, row);
      }
    }
    for (const p of otPeriods) {
      if (!p.breached) continue;
      const employeeId = p.employeeId.toString();
      const key = `${employeeId}:${p.quarterKey}`;
      const row = quarterOt.get(key) ?? {
        employeeId,
        quarter: p.quarterKey,
        hours: Number(p.hoursAccrued),
      };
      row.payrollBreach = true;
      quarterOt.set(key, row);
    }

    // Only weeks that overlap the period count; the padding days just complete those weeks.
    const breaches = hoursBreaches(days, { from, to });

    // Registers per month: muster roll (attendance) and register of wages (payroll results).
    const activeIds = employees.filter((e) => e.status === "active").map((e) => e.id.toString());
    const months: MonthRegisterData[] = monthsInRange(from, to).map((month) => {
      const rows = attendance.filter((r) => r.date.startsWith(month));
      const marked = new Set(rows.map((r) => r.employeeId.toString()));
      return {
        month,
        activeEmployees: activeIds.length,
        attendanceRows: rows.length,
        employeesWithoutAttendance:
          rows.length === 0 ? activeIds.length : activeIds.filter((id) => !marked.has(id)).length,
        payrollResults: payroll.filter((p) => p.payrollRun.period === month).length,
        closed: monthEnd(month) < iso(t),
      };
    });

    const wages: WageRow[] = payroll.map((p) => ({
      employeeId: p.employeeId.toString(),
      month: p.payrollRun.period,
      dailyRate: Number(p.dailyRate),
    }));

    const actions = findings.flatMap((f) =>
      f.actions.map((a) => ({
        id: a.id,
        auditNo: f.audit.auditNo,
        action: a.action,
        status: a.status as ActionStatus,
        dueDate: a.dueDate,
      }))
    );

    const checks = [
      weeklyHoursCheck(breaches, empRef),
      dailyHoursCheck(breaches, empRef),
      otCapCheck(Array.from(quarterOt.values()), empRef),
      // Minimum wages are not stored in Shiftline yet (roadmap P2-17): reported, never guessed.
      minimumWageCheck(wages, null, empRef),
      registersCheck(months),
      openFindingsCheck(
        findings.map((f) => ({
          id: f.id,
          auditNo: f.audit.auditNo,
          severity: f.severity,
          area: f.area,
          description: f.description,
          actions: f.actions.map((a) => ({ status: a.status as ActionStatus })),
        }))
      ),
      overdueActionsCheck(actions, t),
    ];
    const percent = readinessPercent(checks);

    const upcoming = await prisma.buyerAudit.findMany({
      where: { status: { in: ["PLANNED", "IN_PROGRESS"] } },
      include,
      orderBy: { scheduledDate: "asc" },
      take: 5,
    });

    return {
      from,
      to,
      percent,
      band: readinessBand(percent),
      counts: {
        pass: checks.filter((c) => c.status === "PASS").length,
        warn: checks.filter((c) => c.status === "WARN").length,
        fail: checks.filter((c) => c.status === "FAIL").length,
        notConfigured: checks.filter((c) => c.status === "NOT_CONFIGURED").length,
      },
      checks,
      nextAudit: upcoming[0] ? headerDto(upcoming[0], t) : null,
    };
  }

  /** The readiness report as CSV: one line per check, then one line per listed item. */
  async readinessCsv(q: z.infer<typeof readinessQuery>) {
    const r = await this.readiness(q);
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      // Neutralise spreadsheet formulas and quote every field.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [
      ["Period", `${r.from} to ${r.to}`, "Readiness %", r.percent ?? "n/a", ""].map(esc).join(","),
      ["Check", "Status", "Count", "Detail", "Item"].map(esc).join(","),
    ];
    for (const c of r.checks) {
      lines.push([c.title, c.status, c.count ?? "", c.detail, ""].map(esc).join(","));
      for (const i of c.items) {
        lines.push([c.title, "", "", i.value, i.label].map(esc).join(","));
      }
    }
    return { csv: `${lines.join("\n")}\n`, fileName: `audit-readiness-${r.from}-${r.to}.csv` };
  }
}

export const buyerAuditsService = new BuyerAuditsService();
