import { FILINGS, filingByKey, type FilingCadence, type FilingDef } from "@shiftline/shared";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { notify } from "../notifications/notify";

/**
 * The compliance calendar (P1-13d): when each statutory filing is due, what state it is in, and
 * a nudge before the date rather than after it.
 *
 * The due dates are derived from the filing registry in `packages/shared`, not kept in a second
 * list, so a filing added there appears here the same day. What the calendar adds is the day of
 * the month each one falls on and the period it covers — a return for August is due in
 * September, and getting that off by a month is the whole difference between a warning and an
 * apology.
 */

/** Day of the month a filing is due, and how many months after the period it closes. */
interface DueRule {
  /** Day of the month the filing is due. */
  day: number;
  /** Months after the end of the period; 1 means "the month after the one it covers". */
  monthsAfter: number;
}

/**
 * The statutory dates. Kept beside the registry rather than in it because these are deadlines,
 * not definitions: a filing exists whether or not its date has been notified for the year.
 */
export const DUE_RULES: Record<string, DueRule> = {
  GSTR1: { day: 11, monthsAfter: 1 },
  GSTR1A: { day: 11, monthsAfter: 1 },
  IMS: { day: 14, monthsAfter: 1 },
  GSTR3B: { day: 20, monthsAfter: 1 },
  GSTR9: { day: 31, monthsAfter: 9 },
  ITC04: { day: 25, monthsAfter: 1 },
  // MSME Form 1 is due a month after each half-year: 31 October and 30 April.
  MSME_1: { day: 30, monthsAfter: 1 },
  TDS_CHALLAN: { day: 7, monthsAfter: 1 },
  TDS_26Q: { day: 31, monthsAfter: 1 },
  TDS_27Q: { day: 31, monthsAfter: 1 },
  TDS_24Q: { day: 31, monthsAfter: 1 },
  PF_ECR: { day: 15, monthsAfter: 1 },
  ESI_MONTHLY: { day: 15, monthsAfter: 1 },
  PT_RETURN: { day: 21, monthsAfter: 1 },
  PAYROLL_RUN: { day: 7, monthsAfter: 1 },
};

/** Days before a due date that a holder of the permission is nudged. */
export const WARN_DAYS = [7, 2];

export interface ComplianceDue {
  filingType: string;
  name: string;
  authority: FilingDef["authority"];
  cadence: FilingCadence;
  /** The period the filing covers. */
  periodKey: string;
  /** The day it has to be filed by. */
  dueDate: string;
  /** Negative once the date has passed. */
  daysLeft: number;
  status: "NOT_STARTED" | "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "SUBMITTED";
  filingId: string | null;
  /** True when the date has passed and it is still not submitted. */
  overdue: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The last day of a month, so a rule asking for the 31st lands on the 30th where it must. */
const clampDay = (year: number, monthIndex: number, day: number) => {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, last)));
};

/** The period key a filing of this cadence covers, `monthsAfter` before the given month. */
export const periodCovered = (cadence: FilingCadence, due: Date, rule: DueRule): string => {
  const anchor = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() - rule.monthsAfter, 1));
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  switch (cadence) {
    case "MONTHLY":
      return `${y}-${String(m + 1).padStart(2, "0")}`;
    case "QUARTERLY":
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "HALF_YEARLY":
      return `${y}-H${m < 6 ? 1 : 2}`;
    case "ANNUAL": {
      // The annual return covers the financial year that ended before the due date.
      const fyStart = m >= 3 ? y : y - 1;
      return `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
    }
  }
};

/** Whether a filing of this cadence is due in the given month at all. */
const dueThisMonth = (cadence: FilingCadence, monthIndex: number, rule: DueRule): boolean => {
  const covered = (monthIndex - rule.monthsAfter + 12) % 12;
  switch (cadence) {
    case "MONTHLY":
      return true;
    case "QUARTERLY":
      // A quarter closes in June, September, December and March.
      return covered % 3 === 2;
    case "HALF_YEARLY":
      return covered === 8 || covered === 2;
    case "ANNUAL":
      return covered === 2; // the financial year ends in March
  }
};

class ComplianceService {
  /**
   * Everything due in a window around today, with the state of each from the filing gate.
   * `from` and `to` default to a month back and three months on: far enough to plan, near
   * enough that the list is still a to-do rather than a calendar.
   */
  async calendar(opts: { from?: Date; to?: Date; today?: Date } = {}): Promise<ComplianceDue[]> {
    const today = startOfDay(opts.today ?? new Date());
    const from =
      opts.from ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const to = opts.to ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, 1));

    const due: Omit<ComplianceDue, "status" | "filingId" | "overdue">[] = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    while (cursor < to) {
      for (const def of FILINGS) {
        const rule = DUE_RULES[def.key];
        if (!rule) continue;
        if (!dueThisMonth(def.cadence, cursor.getUTCMonth(), rule)) continue;
        const dueDate = clampDay(cursor.getUTCFullYear(), cursor.getUTCMonth(), rule.day);
        if (dueDate < from || dueDate >= to) continue;
        due.push({
          filingType: def.key,
          name: def.name,
          authority: def.authority,
          cadence: def.cadence,
          periodKey: periodCovered(def.cadence, dueDate, rule),
          dueDate: iso(dueDate),
          daysLeft: Math.round((dueDate.getTime() - today.getTime()) / 86400000),
        });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    // One query for every gate the window touches, rather than one per row.
    const gates = await prisma.filingApproval.findMany({
      where: {
        OR: due.map((d) => ({ filingType: d.filingType, periodKey: d.periodKey })),
      },
      select: { id: true, filingType: true, periodKey: true, status: true },
    });
    const gateByKey = new Map(gates.map((g) => [`${g.filingType}|${g.periodKey}`, g]));

    return due
      .map((d) => {
        const gate = gateByKey.get(`${d.filingType}|${d.periodKey}`);
        const status = (gate?.status ?? "NOT_STARTED") as ComplianceDue["status"];
        return {
          ...d,
          status,
          filingId: gate?.id ?? null,
          overdue: d.daysLeft < 0 && status !== "SUBMITTED",
        };
      })
      .sort(
        (a, b) => a.dueDate.localeCompare(b.dueDate) || a.filingType.localeCompare(b.filingType)
      );
  }

  /**
   * Nudges the people who can act, 7 and 2 days before each date. The job runs daily, so the
   * notification link carries the filing, the period and which of the two nudges it is, and an
   * existing one stops a second from going out — a reminder that arrives every day is one
   * people learn to close without reading.
   */
  async warnUpcoming(today = new Date()) {
    const rows = await this.calendar({ today });
    let sent = 0;
    for (const row of rows) {
      if (!WARN_DAYS.includes(row.daysLeft)) continue;
      if (row.status === "SUBMITTED") continue;
      const link = `/compliance/calendar?filing=${row.filingType}&period=${row.periodKey}&d=${row.daysLeft}`;
      const already = await prisma.notification.findFirst({
        where: { category: "filings", link },
        select: { id: true },
      });
      if (already) continue;
      const def = filingByKey(row.filingType);
      await notify({
        category: "filings",
        title: `${def?.name ?? row.filingType} for ${row.periodKey} is due on ${row.dueDate}`,
        body:
          row.status === "NOT_STARTED"
            ? `No filing has been started for approval yet. Figures on the GST screen are a live preview, not a filing. ${row.daysLeft} day(s) left.`
            : `It is ${row.status.toLowerCase()}. ${row.daysLeft} day(s) left.`,
        link,
        to: { permission: "filings.prepare" },
        level: row.daysLeft <= 2 ? "WARNING" : "INFO",
      });
      sent++;
    }
    return { checked: rows.length, sent };
  }

  /** The daily sweep across every tenant. */
  async sweepAllTenants(today = new Date()) {
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let sent = 0;
    for (const c of companies) {
      try {
        const r = await runAsTenant(c.id, () => this.warnUpcoming(today));
        sent += r.sent;
      } catch (err) {
        // One tenant's bad configuration must not stop the others being warned.
        logger.warn({ err, companyId: c.id }, "compliance calendar warning skipped");
      }
    }
    return { tenants: companies.length, sent };
  }
}

export const complianceService = new ComplianceService();
