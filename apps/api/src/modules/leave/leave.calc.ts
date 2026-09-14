/**
 * Pure date arithmetic for leave requests (P2-09): the financial-year code a date falls in, and
 * the number of days a request actually costs once weekly-offs and holidays are taken out.
 *
 * Kept apart from the service, the same way `labour.calc.ts` keeps the Labour Code formulas
 * apart from `labour.service.ts` — this is the part somebody can check against a calendar
 * without a database in front of them.
 */
const DAY = 86400000;

export const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** The financial year (April–March) a date falls in, as "2026-27". */
export const fyCodeFor = (d: Date): string => {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

/** Every calendar date from `from` to `to`, inclusive, as UTC midnight `Date`s. */
export const eachDate = (from: Date, to: Date): Date[] => {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) out.push(new Date(t));
  return out;
};

export interface LeaveDaysInput {
  fromDate: Date;
  toDate: Date;
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
  /** 0 = Sunday .. 6 = Saturday, from the tenant's `PayrollConfig.weeklyOffDays`. */
  weeklyOffDays: number[];
  /** Holiday dates as `YYYY-MM-DD`, from the tenant's holiday calendar. */
  holidays: ReadonlySet<string>;
}

/**
 * Days a leave request actually costs: the calendar span minus weekly-offs and holidays, minus
 * a half day at either end. A weekly-off or holiday was never going to be worked, so it is not
 * leave to begin with — charging it would make every request that spans a Sunday cost more than
 * the days actually missed.
 */
export const leaveRequestDays = (input: LeaveDaysInput): number => {
  const offDays = new Set(input.weeklyOffDays);
  const dates = eachDate(input.fromDate, input.toDate);
  const workingDates = dates.filter(
    (d) => !offDays.has(d.getUTCDay()) && !input.holidays.has(iso(d))
  );
  if (workingDates.length === 0) return 0;

  const sameDay = iso(input.fromDate) === iso(input.toDate);
  if (sameDay) {
    return input.halfDayStart || input.halfDayEnd ? 0.5 : 1;
  }

  let days = workingDates.length;
  // A half day at either end only costs half — but only when that end is itself a working
  // day; a half day requested against a Sunday is not half a day off, it is none.
  const firstIso = iso(input.fromDate);
  const lastIso = iso(input.toDate);
  if (input.halfDayStart && workingDates.some((d) => iso(d) === firstIso)) days -= 0.5;
  if (input.halfDayEnd && workingDates.some((d) => iso(d) === lastIso)) days -= 0.5;
  return Math.max(Math.round(days * 100) / 100, 0);
};
