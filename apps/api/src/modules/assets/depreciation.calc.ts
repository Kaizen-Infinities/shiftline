import type { DepreciationMethod } from "@prisma/client";

/**
 * The two depreciation calculations an Indian company has to keep (P1-18).
 *
 * They are not variations of one another and must never be made to agree:
 *
 *  - **Schedule II of the Companies Act** depreciates *each asset* over its useful life,
 *    pro-rated by days from the date it was put to use, down to a residual value. This is what
 *    the books say and what gets posted.
 *  - **Section 32 of the Income-tax Act** depreciates a *block* — every asset of one class pooled
 *    together — at a fixed rate on the block's written-down value, with a half-rate year for
 *    anything used for less than 180 days, and no per-asset figure at all. This is a report.
 *
 * Posting the tax figure into the books, or filing the book figure on the return, is the mistake
 * this file is arranged to make difficult.
 */
const n2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const DAY = 86400000;

export const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/** The first and last day of a `2026-08` period. */
export const monthRange = (periodKey: string): { from: Date; to: Date } => {
  const [y, m] = periodKey.split("-").map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m - 1, daysInMonth(y, m - 1))),
  };
};

/**
 * The written-down-value rate Schedule II implies.
 *
 * The Act gives a life and a residual, not a rate; the rate that takes cost down to residual over
 * that life is `1 - (residual/cost)^(1/life)`. Typing a rate instead would quietly disagree with
 * the life on the same row, and the auditor reconciles to the life.
 */
export const wdvRate = (cost: number, residual: number, usefulLifeMonths: number): number => {
  const years = usefulLifeMonths / 12;
  if (cost <= 0 || years <= 0) return 0;
  const ratio = Math.max(residual, 0.01) / cost;
  if (ratio >= 1) return 0;
  return 1 - Math.pow(ratio, 1 / years);
};

export interface ChargeInput {
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  /** Depreciation already charged in the books. */
  accumulated: number;
  /** The day the asset was put to use; nothing is charged before it. */
  capitalisedOn: Date;
  /** The day it left, when it did. */
  disposedOn?: Date | null;
  period: { from: Date; to: Date };
}

export interface Charge {
  daysInUse: number;
  openingWdv: number;
  amount: number;
  closingWdv: number;
}

/**
 * One month's charge for one asset under Schedule II.
 *
 * Pro-rating is by days, which is what the Act requires for additions and disposals — a machine
 * bought on the 20th is not a month's depreciation, and treating it as one overstates the charge
 * on every purchase the company makes.
 */
export const monthlyCharge = (input: ChargeInput): Charge => {
  const cost = n2(input.cost);
  const residual = n2(input.residualValue);
  const accumulated = n2(input.accumulated);
  const openingWdv = n2(cost - accumulated);
  const depreciable = n2(cost - residual);
  const empty: Charge = { daysInUse: 0, openingWdv, amount: 0, closingWdv: openingWdv };

  if (depreciable <= 0 || input.usefulLifeMonths <= 0) return empty;
  // Once it is down to residual there is nothing left to charge, however much life is left.
  const remaining = n2(depreciable - accumulated);
  if (remaining <= 0) return empty;

  const start = input.capitalisedOn > input.period.from ? input.capitalisedOn : input.period.from;
  const end =
    input.disposedOn && input.disposedOn < input.period.to ? input.disposedOn : input.period.to;
  if (end < start) return empty;
  const daysInUse = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  const monthDays = Math.round((input.period.to.getTime() - input.period.from.getTime()) / DAY) + 1;
  const fraction = Math.min(daysInUse / monthDays, 1);

  let amount: number;
  if (input.method === "SLM") {
    amount = (depreciable / input.usefulLifeMonths) * fraction;
  } else {
    // WDV is an annual rate on the opening written-down value, apportioned across the month.
    const annual = wdvRate(cost, residual, input.usefulLifeMonths);
    amount = openingWdv * annual * (daysInUse / 365);
  }
  // Never below residual: the last month of an asset's life is whatever is left, not a full slice.
  amount = n2(Math.min(n2(amount), remaining));
  return {
    daysInUse,
    openingWdv,
    amount,
    closingWdv: n2(openingWdv - amount),
  };
};

export interface ItBlockAsset {
  cost: number;
  capitalisedOn: Date;
  disposedOn?: Date | null;
  disposalProceeds?: number;
}

export interface ItBlockResult {
  openingWdv: number;
  additionsFullRate: number;
  additionsHalfRate: number;
  deletions: number;
  depreciation: number;
  closingWdv: number;
}

/**
 * A block of assets under section 32 for one financial year.
 *
 * The rules that make this different from the book charge, and which the report exists to get
 * right: the block is a pool, so there is no per-asset figure; an asset **put to use for fewer
 * than 180 days** in the year gets half the rate; sale proceeds come off the block rather than
 * producing a profit or loss; and the block never goes below zero.
 */
export const itBlockDepreciation = (
  openingWdv: number,
  rate: number,
  assets: ItBlockAsset[],
  fyStart: Date,
  fyEnd: Date
): ItBlockResult => {
  const halfYear = new Date(fyStart.getTime() + 179 * DAY);
  let full = 0;
  let half = 0;
  let deletions = 0;
  for (const a of assets) {
    if (a.capitalisedOn >= fyStart && a.capitalisedOn <= fyEnd) {
      // Fewer than 180 days of use in the year of purchase halves the rate for that year only.
      if (a.capitalisedOn <= halfYear) full += a.cost;
      else half += a.cost;
    }
    if (a.disposedOn && a.disposedOn >= fyStart && a.disposedOn <= fyEnd) {
      deletions += a.disposalProceeds ?? 0;
    }
  }
  const base = n2(openingWdv + full + half - deletions);
  if (base <= 0) {
    // A block sold for more than its written-down value is a short-term capital gain, not
    // negative depreciation; the block simply closes at nil.
    return {
      openingWdv: n2(openingWdv),
      additionsFullRate: n2(full),
      additionsHalfRate: n2(half),
      deletions: n2(deletions),
      depreciation: 0,
      closingWdv: 0,
    };
  }
  const r = rate / 100;
  // The half-rate additions are depreciated at half; everything else in the block at the rate.
  const halfPart = Math.min(half, base);
  const fullPart = n2(base - halfPart);
  const depreciation = n2(fullPart * r + halfPart * (r / 2));
  return {
    openingWdv: n2(openingWdv),
    additionsFullRate: n2(full),
    additionsHalfRate: n2(half),
    deletions: n2(deletions),
    depreciation,
    closingWdv: n2(base - depreciation),
  };
};
