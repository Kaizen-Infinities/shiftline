/**
 * One definition of "a week" for the whole product: Monday to Sunday, in the tenant's
 * timezone (Asia/Kolkata unless the tenant record says otherwise). Dates travel as
 * calendar-date strings (`YYYY-MM-DD`); a `Date` is read as that instant's calendar date
 * in the given timezone, so a browser in any zone agrees with the server.
 */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** The calendar date (`YYYY-MM-DD`) of an instant in a timezone. */
export function calendarDateIn(instant: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Today's calendar date in the tenant's timezone. */
export function todayIn(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return calendarDateIn(now, timeZone);
}

function toUtcMidnight(input: string | Date, timeZone: string): number {
  const iso = typeof input === "string" ? ISO_DATE.exec(input.trim()) : null;
  const ymd = iso ? iso.slice(1, 4).join("-") : calendarDateIn(new Date(input), timeZone);
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Monday (`YYYY-MM-DD`) of the week containing `date`. */
export function weekStart(date: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const ms = toUtcMidnight(date, timeZone);
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  return fmt(ms - sinceMonday * DAY_MS);
}

/** Sunday (`YYYY-MM-DD`) of the week containing `date`. */
export function weekEnd(date: string | Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return fmt(Date.parse(weekStart(date, timeZone)) + 6 * DAY_MS);
}

export function weekRange(
  date: string | Date,
  timeZone: string = DEFAULT_TIMEZONE
): { start: string; end: string } {
  return { start: weekStart(date, timeZone), end: weekEnd(date, timeZone) };
}

/** Adds whole days to a calendar date string. */
export function addDays(date: string, days: number): string {
  return fmt(Date.parse(date.slice(0, 10)) + days * DAY_MS);
}
