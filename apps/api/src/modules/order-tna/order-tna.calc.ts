/**
 * Pure calculations for the export order time-and-action calendar (TN-03): milestone templates
 * counted back from the ex-factory date, the ex-factory reschedule and the RAG status. No
 * database access, so the unit test covers every rule.
 */

export type TnaTemplateKey = "GARMENT_KNIT" | "HOME_TEXTILE" | "LEATHER_FOOTWEAR" | "GENERIC";

export interface TnaTemplateStep {
  name: string;
  /** Days before the ex-factory date. */
  offsetDays: number;
}

export interface TnaTemplate {
  key: TnaTemplateKey;
  name: string;
  steps: TnaTemplateStep[];
}

const step = (name: string, offsetDays: number): TnaTemplateStep => ({ name, offsetDays });

export const TNA_TEMPLATES: Record<TnaTemplateKey, TnaTemplate> = {
  GARMENT_KNIT: {
    key: "GARMENT_KNIT",
    name: "Knitwear / garments",
    steps: [
      step("Yarn booked", 60),
      step("Lab dip approved", 55),
      step("Fit/proto sample approved", 50),
      step("Knitting done", 42),
      step("Dyeing/compacting done", 35),
      step("PP sample approved", 30),
      step("Printing/embroidery done", 24),
      step("Cutting started", 21),
      step("Sewing started", 18),
      step("Sewing done", 8),
      step("Finishing & packing done", 5),
      step("Final inspection passed", 3),
      step("Ex-factory", 0),
    ],
  },
  HOME_TEXTILE: {
    key: "HOME_TEXTILE",
    name: "Home textiles",
    steps: [
      step("Yarn booked", 50),
      step("Strike-off approved", 45),
      step("Weaving done", 35),
      step("Processing done", 25),
      step("Stitching done", 15),
      step("Packing done", 5),
      step("Final inspection", 3),
      step("Ex-factory", 0),
    ],
  },
  LEATHER_FOOTWEAR: {
    key: "LEATHER_FOOTWEAR",
    name: "Leather footwear",
    steps: [
      step("Leather booked", 75),
      step("Sample approved", 60),
      step("Cutting done", 30),
      step("Closing done", 22),
      step("Lasting done", 15),
      step("Finishing & packing", 6),
      step("Final inspection", 3),
      step("Ex-factory", 0),
    ],
  },
  GENERIC: {
    key: "GENERIC",
    name: "Generic",
    steps: [
      step("Material in", 30),
      step("Production start", 20),
      step("Production done", 5),
      step("Inspection", 2),
      step("Dispatch", 0),
    ],
  },
};

export const TNA_TEMPLATE_KEYS = Object.keys(TNA_TEMPLATES) as TnaTemplateKey[];

const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` string as a UTC midnight date. */
export const asDate = (v: string | Date): Date =>
  v instanceof Date
    ? new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()))
    : new Date(`${v.slice(0, 10)}T00:00:00Z`);

export const iso = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (d: Date, days: number): Date =>
  new Date(asDate(d).getTime() + days * DAY_MS);

/** Whole days from `a` to `b` (b − a). */
export const daysBetween = (a: Date, b: Date): number =>
  Math.round((asDate(b).getTime() - asDate(a).getTime()) / DAY_MS);

export interface PlannedMilestone {
  seq: number;
  name: string;
  plannedDate: Date;
}

/**
 * The milestones of `template` for an order: each planned date is `exFactoryDate − offset`,
 * clamped so it is never before `orderDate`.
 */
export const generateMilestones = (
  template: TnaTemplateKey,
  orderDate: Date,
  exFactoryDate: Date
): PlannedMilestone[] => {
  const floor = asDate(orderDate).getTime();
  return TNA_TEMPLATES[template].steps.map((s, i) => {
    const planned = addDays(exFactoryDate, -s.offsetDays);
    return {
      seq: i + 1,
      name: s.name,
      plannedDate: planned.getTime() < floor ? asDate(orderDate) : planned,
    };
  });
};

export type MilestoneStatus = "PENDING" | "DONE" | "SKIPPED";

export interface MilestoneLike {
  id?: string;
  status: MilestoneStatus;
  plannedDate: Date;
  actualDate?: Date | null;
}

/**
 * Moving the ex-factory date shifts every PENDING milestone by the same number of days;
 * DONE and SKIPPED milestones keep their dates. Returns only the rows that move.
 */
export const shiftOpenMilestones = <T extends MilestoneLike>(
  milestones: T[],
  oldExFactory: Date,
  newExFactory: Date
): { milestone: T; plannedDate: Date }[] => {
  const delta = daysBetween(oldExFactory, newExFactory);
  if (delta === 0) return [];
  return milestones
    .filter((m) => m.status === "PENDING")
    .map((m) => ({ milestone: m, plannedDate: addDays(m.plannedDate, delta) }));
};

/** Delay in days of a done milestone (actual − planned); null while it is not done. */
export const delayDays = (m: MilestoneLike): number | null =>
  m.status === "DONE" && m.actualDate ? daysBetween(m.plannedDate, m.actualDate) : null;

export type Rag = "RED" | "AMBER" | "GREEN";

/** Days ahead a pending milestone turns an order amber. */
export const AMBER_WINDOW_DAYS = 3;

/**
 * RED when any PENDING milestone is past its planned date, AMBER when one is due within
 * `AMBER_WINDOW_DAYS`, otherwise GREEN.
 */
export const ragFor = (milestones: MilestoneLike[], today: Date): Rag => {
  const t = asDate(today);
  let amber = false;
  for (const m of milestones) {
    if (m.status !== "PENDING") continue;
    const d = daysBetween(t, m.plannedDate);
    if (d < 0) return "RED";
    if (d <= AMBER_WINDOW_DAYS) amber = true;
  }
  return amber ? "AMBER" : "GREEN";
};

/** Summary for a list row: RAG, the next pending milestone and how many are overdue. */
export const summarise = <T extends MilestoneLike & { name: string; seq: number }>(
  milestones: T[],
  today: Date
) => {
  const t = asDate(today);
  const pending = milestones
    .filter((m) => m.status === "PENDING")
    .sort((a, b) => a.plannedDate.getTime() - b.plannedDate.getTime() || a.seq - b.seq);
  return {
    rag: ragFor(milestones, t),
    nextMilestone: pending[0]
      ? { name: pending[0].name, plannedDate: iso(pending[0].plannedDate) }
      : null,
    overdueCount: pending.filter((m) => daysBetween(t, m.plannedDate) < 0).length,
  };
};
