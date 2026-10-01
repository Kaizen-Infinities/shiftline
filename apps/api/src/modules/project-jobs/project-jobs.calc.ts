/**
 * Pure calculations for job / project costing (TN-09): cost by type, margin against the quote,
 * % complete from the stage plan, billed against cost and the advance balance. No database
 * access, so the unit test covers every rule. Money is summed in paise to avoid float drift.
 */

export const COST_TYPES = ["MATERIAL", "LABOUR", "SUBCONTRACT", "OVERHEAD"] as const;
export type CostType = (typeof COST_TYPES)[number];

export const STAGE_STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "SKIPPED"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const BILLING_KINDS = ["ADVANCE", "STAGE_INVOICE", "FINAL"] as const;
export type BillingKind = (typeof BILLING_KINDS)[number];

export const JOB_STATUSES = [
  "QUOTED",
  "IN_PROGRESS",
  "COMPLETED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type StagePlanKey = "BODY_BUILDING" | "FABRICATION" | "NONE";
export const STAGE_PLAN_KEYS: StagePlanKey[] = ["BODY_BUILDING", "FABRICATION", "NONE"];

/** Stage plans offered when a job is created; the user can add, rename and reorder later. */
export const STAGE_PLANS: Record<
  StagePlanKey,
  { key: StagePlanKey; name: string; stages: string[] }
> = {
  BODY_BUILDING: {
    key: "BODY_BUILDING",
    name: "Truck body building",
    stages: [
      "Chassis inward",
      "Fabrication",
      "Paneling",
      "Painting",
      "Electrical",
      "Finishing",
      "Delivery",
    ],
  },
  FABRICATION: {
    key: "FABRICATION",
    name: "Fabrication job",
    stages: [
      "Drawing approval",
      "Material procurement",
      "Cutting and fit-up",
      "Welding",
      "Inspection",
      "Painting",
      "Dispatch",
    ],
  },
  NONE: { key: "NONE", name: "No stages", stages: [] },
};

const paise = (n: number) => Math.round(n * 100);
const rupees = (p: number) => p / 100;

/** Line amount: qty x rate rounded to the paisa (labour: hours x rate per hour). */
export const lineAmount = (qty: number, rate: number): number =>
  rupees(Math.round(qty * rate * 100));

export interface CostLike {
  type: CostType;
  amount: number;
  status?: "DRAFT" | "POSTED";
}

export type CostByType = Record<CostType, number>;

export const costByType = (costs: CostLike[]): CostByType => {
  const acc: Record<CostType, number> = { MATERIAL: 0, LABOUR: 0, SUBCONTRACT: 0, OVERHEAD: 0 };
  for (const c of costs) acc[c.type] += paise(c.amount);
  return {
    MATERIAL: rupees(acc.MATERIAL),
    LABOUR: rupees(acc.LABOUR),
    SUBCONTRACT: rupees(acc.SUBCONTRACT),
    OVERHEAD: rupees(acc.OVERHEAD),
  };
};

export interface StageLike {
  status: StageStatus;
  weight: number;
}

/**
 * % complete: DONE weight over the weight of stages that count (SKIPPED stages drop out; an
 * IN_PROGRESS stage counts half). No stages → 0, or 100 once every stage is skipped.
 */
export const percentComplete = (stages: StageLike[]): number => {
  const counted = stages.filter((s) => s.status !== "SKIPPED");
  if (stages.length === 0) return 0;
  if (counted.length === 0) return 100;
  const total = counted.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  if (total === 0) return 0;
  const done = counted.reduce(
    (sum, s) =>
      sum +
      (s.status === "DONE" ? Math.max(0, s.weight) : s.status === "IN_PROGRESS" ? s.weight / 2 : 0),
    0
  );
  return Math.round((done / total) * 1000) / 10;
};

export interface BillingLike {
  kind: BillingKind;
  amount: number;
  advanceAdjusted: number;
}

export interface BillingTotals {
  /** Advances received. */
  advancesReceived: number;
  /** Stage and final invoices raised. */
  billed: number;
  /** Part of the invoices settled from advances. */
  advanceAdjusted: number;
  /** Advances received and not yet set off against an invoice. */
  advanceBalance: number;
}

export const billingTotals = (rows: BillingLike[]): BillingTotals => {
  let adv = 0;
  let billed = 0;
  let adjusted = 0;
  for (const r of rows) {
    if (r.kind === "ADVANCE") adv += paise(r.amount);
    else {
      billed += paise(r.amount);
      adjusted += paise(r.advanceAdjusted);
    }
  }
  return {
    advancesReceived: rupees(adv),
    billed: rupees(billed),
    advanceAdjusted: rupees(adjusted),
    advanceBalance: rupees(adv - adjusted),
  };
};

export interface JobSummary extends BillingTotals {
  quoted: number;
  costByType: CostByType;
  costToDate: number;
  draftCost: number;
  margin: number;
  /** Margin as % of the quote; null when the quote is zero. */
  marginPct: number | null;
  percentComplete: number;
  /** Billed minus cost to date (positive: billing ahead of spend). */
  billedVsCost: number;
  /** Quote not yet invoiced. */
  toBill: number;
  /** Cost to date above the quote. */
  overQuote: boolean;
  marginBand: "HEALTHY" | "THIN" | "LOSS";
}

/** Everything the job header shows; costToDate includes DRAFT lines (they are real spend). */
export const summariseJob = (input: {
  quoted: number;
  costs: CostLike[];
  stages: StageLike[];
  /** A COMPLETED or DELIVERED job is 100 % complete whatever its stages say. */
  finished?: boolean;
  billings: BillingLike[];
}): JobSummary => {
  const byType = costByType(input.costs);
  const costP = COST_TYPES.reduce((s, t) => s + paise(byType[t]), 0);
  const draftP = input.costs
    .filter((c) => c.status === "DRAFT")
    .reduce((s, c) => s + paise(c.amount), 0);
  const quotedP = paise(input.quoted);
  const marginP = quotedP - costP;
  const bill = billingTotals(input.billings);
  const marginPct = quotedP === 0 ? null : Math.round((marginP / quotedP) * 1000) / 10;
  return {
    quoted: rupees(quotedP),
    costByType: byType,
    costToDate: rupees(costP),
    draftCost: rupees(draftP),
    margin: rupees(marginP),
    marginPct,
    percentComplete: input.finished ? 100 : percentComplete(input.stages),
    ...bill,
    billedVsCost: rupees(paise(bill.billed) - costP),
    toBill: rupees(Math.max(0, quotedP - paise(bill.billed))),
    overQuote: costP > quotedP,
    marginBand: marginBandFor(marginPct, marginP),
  };
};

/** LOSS below zero, THIN under 10 % of the quote, otherwise HEALTHY. */
export const marginBandFor = (
  marginPct: number | null,
  margin: number
): "HEALTHY" | "THIN" | "LOSS" => {
  if (margin < 0) return "LOSS";
  if (marginPct === null || marginPct < 10) return "THIN";
  return "HEALTHY";
};

/** New order of stage ids → seq 1..n; throws when the list is not a permutation of `current`. */
export const reorderSeqs = (current: string[], wanted: string[]): Map<string, number> => {
  const set = new Set(current);
  if (wanted.length !== current.length || new Set(wanted).size !== wanted.length) {
    throw new Error("REORDER_MISMATCH");
  }
  for (const id of wanted) if (!set.has(id)) throw new Error("REORDER_MISMATCH");
  return new Map(wanted.map((id, i) => [id, i + 1]));
};

/** Allowed status moves; CANCELLED and DELIVERED are final. */
export const canMoveStatus = (from: JobStatus, to: JobStatus): boolean => {
  if (from === to) return true;
  if (from === "CANCELLED" || from === "DELIVERED") return false;
  const order: JobStatus[] = ["QUOTED", "IN_PROGRESS", "COMPLETED", "DELIVERED"];
  if (to === "CANCELLED") return true;
  return order.indexOf(to) >= order.indexOf(from) - 1 && order.indexOf(to) !== -1;
};

export const asDate = (v: string | Date): Date => {
  const s = typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
  return new Date(`${s}T00:00:00.000Z`);
};
export const iso = (d: Date): string => d.toISOString().slice(0, 10);
