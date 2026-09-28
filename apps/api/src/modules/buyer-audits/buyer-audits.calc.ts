/**
 * Pure calculations for buyer social-compliance audit readiness (TN-08). No database access:
 * the service gathers attendance, payroll, register and audit rows and hands them here, so the
 * unit test covers every rule.
 *
 * Hours come from what attendance persists (P2-03's muster roll reads the same rows): a present
 * day is the employee's shift length (or the payroll default hours) plus the day's OT hours; a
 * half day is half of that plus OT; a weekly off, holiday or leave day counts only OT worked on
 * it. Biometric punches (P2-11) will replace the shift length with the real span when they exist.
 */
import { DAILY_HOURS, QUARTERLY_OVERTIME_CAP, WEEKLY_HOURS } from "../payroll/labour.calc";

export { DAILY_HOURS, QUARTERLY_OVERTIME_CAP, WEEKLY_HOURS };

/** Regular 48 plus 12 overtime: the ceiling every buyer code (BSCI, SA8000, ETI/SMETA) sets. */
export const WEEKLY_TOTAL_CEILING = 60;
/** Overtime at or above this share of the quarterly cap is flagged before it breaches. */
export const OT_CAP_WARN_SHARE = 0.8;
/** Corrective actions due within this many days are "due soon". */
export const DUE_SOON_DAYS = 7;
/** At most this many rows are listed under a check (the count is always the full number). */
export const MAX_ITEMS = 50;

export type CheckStatus = "PASS" | "WARN" | "FAIL" | "NOT_CONFIGURED";

export interface CheckItem {
  ref: string;
  label: string;
  value: string;
}

export interface ReadinessCheck {
  key:
    | "WEEKLY_HOURS"
    | "DAILY_HOURS"
    | "OT_QUARTERLY_CAP"
    | "MINIMUM_WAGE"
    | "REGISTERS"
    | "OPEN_FINDINGS"
    | "OVERDUE_ACTIONS";
  title: string;
  status: CheckStatus;
  /** How many employees / gaps / findings / actions the check found; null when not configured. */
  count: number | null;
  detail: string;
  items: CheckItem[];
}

// ── Dates ─────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;

/** A `YYYY-MM-DD` string as a UTC midnight date. */
export const asDate = (v: string | Date): Date => {
  const s = typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
  return new Date(`${s}T00:00:00.000Z`);
};
export const iso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY);
export const daysBetween = (from: Date, to: Date): number =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / DAY);

/** The Monday of the (Monday-to-Sunday) week a date falls in. */
export const weekStart = (date: string): string => {
  const d = asDate(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return iso(addDays(d, -dow));
};

/** Calendar months (YYYY-MM) touched by a range, in order. */
export const monthsInRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

export const monthEnd = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
};

/** Calendar quarter key, e.g. "2026-Q3", matching payroll's `quarterBoundsFor`. */
export const quarterKey = (date: string): string => {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
};

/** First day of the quarter a date falls in. */
export const quarterStart = (date: string): string => {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
};

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

// ── Hours ─────────────────────────────────────────────────────────────────────
/** Hours in a shift from "HH:MM" start/end (overnight wraps) less the break in minutes. */
export const shiftHours = (
  start: string | null | undefined,
  end: string | null | undefined,
  breakMinutes?: number | null
): number | null => {
  const parse = (t: string | null | undefined) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const s = parse(start);
  const e = parse(end);
  if (s === null || e === null) return null;
  let span = e - s;
  if (span <= 0) span += 24 * 60;
  const worked = span - Math.max(breakMinutes ?? 0, 0);
  return worked > 0 ? r2(worked / 60) : null;
};

/** Hours worked on one attendance day. */
export const hoursForDay = (status: string, normalHours: number, otHours: number): number => {
  const ot = Math.max(otHours, 0);
  if (status === "PRESENT") return r2(normalHours + ot);
  if (status === "HALF_DAY") return r2(normalHours / 2 + ot);
  // ABSENT, WEEKLY_OFF, HOLIDAY, LEAVE_*: only overtime actually worked that day counts.
  return r2(ot);
};

export interface DayHours {
  employeeId: string;
  date: string;
  hours: number;
}

export interface EmployeeRef {
  code: string;
  name: string;
}

export interface HoursBreach {
  employeeId: string;
  maxDaily: number;
  daysOverDaily: number;
  maxWeekly: number;
  weeksOver48: number;
  weeksOverCeiling: number;
  worstWeek: string | null;
}

/**
 * Per employee: days over 9 hours and weeks over 48 / 60 hours. Only employees with a breach.
 * `days` may run to whole weeks around the period so a week is never cut short; long days are
 * counted only inside `period` when one is given.
 */
export const hoursBreaches = (
  days: DayHours[],
  period?: { from: string; to: string }
): HoursBreach[] => {
  const byEmp = new Map<string, DayHours[]>();
  for (const d of days) {
    const list = byEmp.get(d.employeeId) ?? [];
    list.push(d);
    byEmp.set(d.employeeId, list);
  }
  const out: HoursBreach[] = [];
  for (const [employeeId, list] of byEmp) {
    const weeks = new Map<string, number>();
    let maxDaily = 0;
    let daysOverDaily = 0;
    for (const d of list) {
      const inPeriod = !period || (d.date >= period.from && d.date <= period.to);
      if (inPeriod) {
        maxDaily = Math.max(maxDaily, d.hours);
        if (d.hours > DAILY_HOURS) daysOverDaily += 1;
      }
      const w = weekStart(d.date);
      weeks.set(w, (weeks.get(w) ?? 0) + d.hours);
    }
    let maxWeekly = 0;
    let worstWeek: string | null = null;
    let weeksOver48 = 0;
    let weeksOverCeiling = 0;
    for (const [w, h] of weeks) {
      if (h > maxWeekly) {
        maxWeekly = h;
        worstWeek = w;
      }
      if (h > WEEKLY_HOURS) weeksOver48 += 1;
      if (h > WEEKLY_TOTAL_CEILING) weeksOverCeiling += 1;
    }
    if (daysOverDaily > 0 || weeksOver48 > 0) {
      out.push({
        employeeId,
        maxDaily: r2(maxDaily),
        daysOverDaily,
        maxWeekly: r2(maxWeekly),
        weeksOver48,
        weeksOverCeiling,
        worstWeek: weeksOver48 > 0 ? worstWeek : null,
      });
    }
  }
  return out;
};

const itemFor = (
  employees: Map<string, EmployeeRef>,
  employeeId: string,
  value: string
): CheckItem => {
  const e = employees.get(employeeId);
  return { ref: employeeId, label: e ? `${e.code} · ${e.name}` : employeeId, value };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const weeklyHoursCheck = (
  breaches: HoursBreach[],
  employees: Map<string, EmployeeRef>
): ReadinessCheck => {
  const over = breaches.filter((b) => b.weeksOver48 > 0).sort((a, b) => b.maxWeekly - a.maxWeekly);
  const overCeiling = over.filter((b) => b.weeksOverCeiling > 0).length;
  return {
    key: "WEEKLY_HOURS",
    title: `Weekly hours within ${WEEKLY_HOURS}`,
    status: overCeiling > 0 ? "FAIL" : over.length > 0 ? "WARN" : "PASS",
    count: over.length,
    detail:
      over.length === 0
        ? `No one worked more than ${WEEKLY_HOURS} hours in a week.`
        : `${plural(over.length, "employee")} worked more than ${WEEKLY_HOURS} hours in a week` +
          (overCeiling > 0
            ? `; ${overCeiling} went past the ${WEEKLY_TOTAL_CEILING}-hour ceiling buyer codes allow.`
            : `, within the ${WEEKLY_TOTAL_CEILING}-hour ceiling buyer codes allow.`),
    items: over
      .slice(0, MAX_ITEMS)
      .map((b) =>
        itemFor(employees, b.employeeId, `${b.maxWeekly} h (week of ${b.worstWeek ?? "—"})`)
      ),
  };
};

export const dailyHoursCheck = (
  breaches: HoursBreach[],
  employees: Map<string, EmployeeRef>
): ReadinessCheck => {
  const over = breaches
    .filter((b) => b.daysOverDaily > 0)
    .sort((a, b) => b.daysOverDaily - a.daysOverDaily);
  return {
    key: "DAILY_HOURS",
    title: `Daily hours within ${DAILY_HOURS}`,
    // A long day is overtime, not by itself a breach; the auditor still asks for it.
    status: over.length > 0 ? "WARN" : "PASS",
    count: over.length,
    detail:
      over.length === 0
        ? `No one worked more than ${DAILY_HOURS} hours in a day.`
        : `${plural(over.length, "employee")} worked more than ${DAILY_HOURS} hours on at least one day.`,
    items: over
      .slice(0, MAX_ITEMS)
      .map((b) =>
        itemFor(
          employees,
          b.employeeId,
          `${plural(b.daysOverDaily, "day")}, longest ${b.maxDaily} h`
        )
      ),
  };
};

// ── Overtime quarterly cap ────────────────────────────────────────────────────
export interface QuarterOt {
  employeeId: string;
  quarter: string;
  hours: number;
  /** The breach payroll itself recorded (OvertimeQuarterPeriod.breached), when a run posted. */
  payrollBreach?: boolean;
}

export const otCapCheck = (
  rows: QuarterOt[],
  employees: Map<string, EmployeeRef>
): ReadinessCheck => {
  const warnAt = QUARTERLY_OVERTIME_CAP * OT_CAP_WARN_SHARE;
  const over = rows.filter((r) => r.hours > QUARTERLY_OVERTIME_CAP || r.payrollBreach);
  const near = rows.filter(
    (r) => !(r.hours > QUARTERLY_OVERTIME_CAP || r.payrollBreach) && r.hours >= warnAt
  );
  const listed = [...over, ...near].sort((a, b) => b.hours - a.hours);
  const overEmployees = new Set(over.map((r) => r.employeeId)).size;
  const nearEmployees = new Set(near.map((r) => r.employeeId)).size;
  return {
    key: "OT_QUARTERLY_CAP",
    title: `Overtime within ${QUARTERLY_OVERTIME_CAP} hours a quarter`,
    status: overEmployees > 0 ? "FAIL" : nearEmployees > 0 ? "WARN" : "PASS",
    count: overEmployees,
    detail:
      overEmployees > 0
        ? `${plural(overEmployees, "employee")} went past the ${QUARTERLY_OVERTIME_CAP}-hour quarterly overtime cap.`
        : nearEmployees > 0
          ? `${plural(nearEmployees, "employee")} ${nearEmployees === 1 ? "is" : "are"} above ${Math.round(OT_CAP_WARN_SHARE * 100)}% of the quarterly overtime cap.`
          : "Everyone's overtime is within the quarterly cap.",
    items: listed
      .slice(0, MAX_ITEMS)
      .map((r) => itemFor(employees, r.employeeId, `${r2(r.hours)} h OT in ${r.quarter}`)),
  };
};

// ── Minimum wage ──────────────────────────────────────────────────────────────
export interface WageRow {
  employeeId: string;
  month: string;
  /** The daily rate the payroll run used. */
  dailyRate: number;
}

/**
 * Wages against the applicable minimum. Shiftline does not store minimum wages yet (roadmap
 * P2-17), so with no rate the check is NOT_CONFIGURED rather than a guess, and is left out of
 * the readiness score.
 */
export const minimumWageCheck = (
  rows: WageRow[],
  minimumDailyWage: number | null,
  employees: Map<string, EmployeeRef>
): ReadinessCheck => {
  if (minimumDailyWage === null || !(minimumDailyWage > 0)) {
    return {
      key: "MINIMUM_WAGE",
      title: "Wages at or above the minimum wage",
      status: "NOT_CONFIGURED",
      count: null,
      detail:
        "Minimum wages are not configured in Shiftline yet, so wages cannot be checked against them.",
      items: [],
    };
  }
  const below = rows
    .filter((r) => r.dailyRate > 0 && r.dailyRate < minimumDailyWage)
    .sort((a, b) => a.dailyRate - b.dailyRate);
  const people = new Set(below.map((r) => r.employeeId)).size;
  return {
    key: "MINIMUM_WAGE",
    title: "Wages at or above the minimum wage",
    status: people > 0 ? "FAIL" : "PASS",
    count: people,
    detail:
      people > 0
        ? `${plural(people, "employee")} were paid a daily rate below the minimum of ₹${minimumDailyWage}.`
        : "Every daily rate paid is at or above the minimum wage.",
    items: below
      .slice(0, MAX_ITEMS)
      .map((r) => itemFor(employees, r.employeeId, `₹${r2(r.dailyRate)}/day in ${r.month}`)),
  };
};

// ── Registers ────────────────────────────────────────────────────────────────
export interface MonthRegisterData {
  month: string;
  /** Active employees; a month with none needs no register. */
  activeEmployees: number;
  /** Active employees with no attendance row at all in the month. */
  employeesWithoutAttendance: number;
  /** Attendance rows in the month (muster roll). */
  attendanceRows: number;
  /** Payroll results for the period (register of wages). */
  payrollResults: number;
  /** Whether the month is over (a wages register is only due once the month has closed). */
  closed: boolean;
}

export const registersCheck = (months: MonthRegisterData[]): ReadinessCheck => {
  const items: CheckItem[] = [];
  let missing = 0;
  let partial = 0;
  for (const m of months) {
    if (m.activeEmployees === 0 && m.attendanceRows === 0) continue;
    if (m.attendanceRows === 0) {
      missing += 1;
      items.push({ ref: `${m.month}:MUSTER`, label: `Muster roll · ${m.month}`, value: "Missing" });
    } else if (m.employeesWithoutAttendance > 0) {
      partial += 1;
      items.push({
        ref: `${m.month}:MUSTER`,
        label: `Muster roll · ${m.month}`,
        value: `${plural(m.employeesWithoutAttendance, "employee")} not marked`,
      });
    }
    if (m.closed && m.payrollResults === 0) {
      missing += 1;
      items.push({
        ref: `${m.month}:WAGES`,
        label: `Wages register · ${m.month}`,
        value: "Missing",
      });
    }
  }
  return {
    key: "REGISTERS",
    title: "Registers kept for the period",
    status: missing > 0 ? "FAIL" : partial > 0 ? "WARN" : "PASS",
    count: missing + partial,
    detail:
      missing + partial === 0
        ? "The muster roll and the wages register exist for every month in the period."
        : missing > 0
          ? `${plural(missing, "register")} missing for the period${partial > 0 ? `, ${partial} incomplete` : ""}.`
          : `${plural(partial, "muster roll")} incomplete for the period.`,
    items: items.slice(0, MAX_ITEMS),
  };
};

// ── Findings and corrective actions ──────────────────────────────────────────
export type Severity = "CRITICAL" | "MAJOR" | "MINOR" | "OBSERVATION";
export type ActionStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "VERIFIED";

export const ACTION_ORDER: ActionStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "VERIFIED"];

/** Forward-only: a step may be skipped, never undone, and a status never "moves" to itself. */
export const canMoveAction = (from: ActionStatus, to: ActionStatus): boolean =>
  ACTION_ORDER.indexOf(to) > ACTION_ORDER.indexOf(from);

export const AUDIT_ORDER = ["PLANNED", "IN_PROGRESS", "COMPLETED"] as const;
export type AuditStatus = (typeof AUDIT_ORDER)[number] | "CANCELLED";

export const canMoveAudit = (from: AuditStatus, to: AuditStatus): boolean => {
  if (from === "CANCELLED" || from === "COMPLETED") return false;
  if (to === "CANCELLED") return true;
  return (
    AUDIT_ORDER.indexOf(to as (typeof AUDIT_ORDER)[number]) >
    AUDIT_ORDER.indexOf(from as (typeof AUDIT_ORDER)[number])
  );
};

export interface ActionLike {
  status: ActionStatus;
  dueDate: Date | string;
}

export const isOverdue = (a: ActionLike, today: Date): boolean =>
  (a.status === "OPEN" || a.status === "IN_PROGRESS") && asDate(a.dueDate) < asDate(today);

export const isDueSoon = (a: ActionLike, today: Date): boolean =>
  (a.status === "OPEN" || a.status === "IN_PROGRESS") &&
  !isOverdue(a, today) &&
  daysBetween(today, asDate(a.dueDate)) <= DUE_SOON_DAYS;

/** A finding is closed once it has actions and every one of them is verified. */
export const isFindingOpen = (actions: { status: ActionStatus }[]): boolean =>
  actions.length === 0 || actions.some((a) => a.status !== "VERIFIED");

export interface FindingRow {
  id: string;
  auditNo: string;
  severity: Severity;
  area: string;
  description: string;
  actions: { status: ActionStatus }[];
}

export const openFindingsCheck = (findings: FindingRow[]): ReadinessCheck => {
  const open = findings.filter(
    (f) => (f.severity === "CRITICAL" || f.severity === "MAJOR") && isFindingOpen(f.actions)
  );
  const critical = open.filter((f) => f.severity === "CRITICAL").length;
  const major = open.length - critical;
  return {
    key: "OPEN_FINDINGS",
    title: "No open critical or major findings",
    status: critical > 0 ? "FAIL" : major > 0 ? "WARN" : "PASS",
    count: open.length,
    detail:
      open.length === 0
        ? "Every critical and major finding has verified corrective action."
        : `${critical} critical and ${major} major ${open.length === 1 ? "finding is" : "findings are"} still open.`,
    items: open
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "CRITICAL" ? -1 : 1))
      .slice(0, MAX_ITEMS)
      .map((f) => ({
        ref: f.id,
        label: `${f.auditNo} · ${f.area.replace(/_/g, " ").toLowerCase()}`,
        value: `${f.severity.toLowerCase()} · ${f.description.slice(0, 80)}`,
      })),
  };
};

export interface ActionRow extends ActionLike {
  id: string;
  auditNo: string;
  action: string;
}

export const overdueActionsCheck = (actions: ActionRow[], today: Date): ReadinessCheck => {
  const overdue = actions
    .filter((a) => isOverdue(a, today))
    .sort((a, b) => asDate(a.dueDate).getTime() - asDate(b.dueDate).getTime());
  const soon = actions.filter((a) => isDueSoon(a, today)).length;
  return {
    key: "OVERDUE_ACTIONS",
    title: "Corrective actions on time",
    status: overdue.length > 0 ? "FAIL" : soon > 0 ? "WARN" : "PASS",
    count: overdue.length,
    detail:
      overdue.length > 0
        ? `${plural(overdue.length, "corrective action")} past the due date.`
        : soon > 0
          ? `${plural(soon, "corrective action")} due in the next ${DUE_SOON_DAYS} days.`
          : "No corrective action is overdue.",
    items: overdue.slice(0, MAX_ITEMS).map((a) => ({
      ref: a.id,
      label: `${a.auditNo} · ${a.action.slice(0, 60)}`,
      value: `${daysBetween(asDate(a.dueDate), today)}d overdue`,
    })),
  };
};

// ── Score ────────────────────────────────────────────────────────────────────
const POINTS: Record<Exclude<CheckStatus, "NOT_CONFIGURED">, number> = {
  PASS: 1,
  WARN: 0.5,
  FAIL: 0,
};

/** Pass = 1, warn = ½, fail = 0 over the checks that apply; not-configured checks are left out. */
export const readinessPercent = (checks: Pick<ReadinessCheck, "status">[]): number | null => {
  const scored = checks.filter((c) => c.status !== "NOT_CONFIGURED");
  if (scored.length === 0) return null;
  const pts = scored.reduce(
    (s, c) => s + POINTS[c.status as Exclude<CheckStatus, "NOT_CONFIGURED">],
    0
  );
  return Math.round((pts / scored.length) * 100);
};

export const readinessBand = (pct: number | null): "READY" | "AT_RISK" | "NOT_READY" | null =>
  pct === null ? null : pct >= 85 ? "READY" : pct >= 60 ? "AT_RISK" : "NOT_READY";
