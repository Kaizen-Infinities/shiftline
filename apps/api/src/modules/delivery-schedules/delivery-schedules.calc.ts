/**
 * Schedule adherence (TN-02), computed the way an OEM's vendor rating does. Pure functions: no
 * database, no clock — the caller passes `asOf`.
 *
 * Per line: dispatched = Σ qty, onTime = Σ qty dispatched on or before the due date,
 * late = dispatched − onTime, short = max(0, scheduled − dispatched).
 * Adherence % = Σ min(onTime, scheduled) / Σ scheduled over FIRM lines, to one decimal.
 * OTIF % = FIRM lines that are MET / FIRM lines that are due by `asOf`.
 */
export type LineStatus = "PENDING" | "MET" | "LATE" | "SHORT" | "EXCESS";
export type Firmness = "FIRM" | "TENTATIVE";

export interface CalcDispatch {
  dispatchDate: Date;
  qty: number;
}

export interface CalcLine {
  dueDate: Date;
  firmness: Firmness;
  scheduledQty: number;
  dispatches: CalcDispatch[];
}

export interface LineMetrics {
  scheduled: number;
  dispatched: number;
  onTime: number;
  late: number;
  short: number;
  remaining: number;
  status: LineStatus;
}

export interface AdherenceTotals {
  firmLines: number;
  dueLines: number;
  metLines: number;
  scheduled: number;
  onTime: number;
  late: number;
  short: number;
  adherencePct: number | null;
  otifPct: number | null;
}

/** Dispatches more than this share of the scheduled quantity are EXCESS. */
export const EXCESS_FACTOR = 1.1;
/** A line's due date may spill this many days either side of the schedule month. */
export const DUE_WINDOW_DAYS = 45;

const DAY_MS = 86_400_000;
const q3 = (v: number) => Math.round(v * 1000) / 1000;
const pct1 = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
/** Calendar day (UTC) so a time of day never moves a dispatch across its due date. */
const dayOf = (d: Date) => Math.floor(d.getTime() / DAY_MS);

export const lineMetrics = (line: CalcLine, asOf: Date): LineMetrics => {
  const due = dayOf(line.dueDate);
  let dispatched = 0;
  let onTime = 0;
  for (const d of line.dispatches) {
    dispatched += d.qty;
    if (dayOf(d.dispatchDate) <= due) onTime += d.qty;
  }
  dispatched = q3(dispatched);
  onTime = q3(onTime);
  const scheduled = q3(line.scheduledQty);
  const late = q3(dispatched - onTime);
  const short = q3(Math.max(0, scheduled - dispatched));

  let status: LineStatus;
  if (dispatched > scheduled * EXCESS_FACTOR) status = "EXCESS";
  else if (onTime >= scheduled) status = "MET";
  else if (dispatched >= scheduled) status = "LATE";
  else if (dayOf(asOf) > due) status = "SHORT";
  else status = "PENDING";

  return { scheduled, dispatched, onTime, late, short, remaining: short, status };
};

/** Adherence and OTIF over a set of lines (one customer and month, typically). */
export const adherence = (lines: CalcLine[], asOf: Date): AdherenceTotals => {
  const today = dayOf(asOf);
  let scheduled = 0;
  let credited = 0;
  let onTime = 0;
  let late = 0;
  let short = 0;
  let firmLines = 0;
  let dueLines = 0;
  let metLines = 0;
  for (const line of lines) {
    if (line.firmness !== "FIRM") continue;
    const m = lineMetrics(line, asOf);
    firmLines += 1;
    scheduled += m.scheduled;
    credited += Math.min(m.onTime, m.scheduled);
    onTime += m.onTime;
    late += m.late;
    short += m.short;
    if (dayOf(line.dueDate) <= today) {
      dueLines += 1;
      if (m.status === "MET") metLines += 1;
    }
  }
  return {
    firmLines,
    dueLines,
    metLines,
    scheduled: q3(scheduled),
    onTime: q3(onTime),
    late: q3(late),
    short: q3(short),
    adherencePct: pct1(credited, scheduled),
    otifPct: pct1(metLines, dueLines),
  };
};

/** True when `dueDate` falls within the schedule month ± {@link DUE_WINDOW_DAYS}. */
export const dueDateInWindow = (periodMonth: Date, dueDate: Date): boolean => {
  const start = Date.UTC(periodMonth.getUTCFullYear(), periodMonth.getUTCMonth(), 1);
  const end = Date.UTC(periodMonth.getUTCFullYear(), periodMonth.getUTCMonth() + 1, 0);
  const t = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return t >= start - DUE_WINDOW_DAYS * DAY_MS && t <= end + DUE_WINDOW_DAYS * DAY_MS;
};

/** Colour band for an adherence / OTIF cell: ≥95 green, 85–95 amber, <85 red. */
export const adherenceBand = (pct: number | null): "good" | "warn" | "bad" | "none" =>
  pct === null ? "none" : pct >= 95 ? "good" : pct >= 85 ? "warn" : "bad";
