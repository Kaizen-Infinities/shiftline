/**
 * Subsidy and scheme claim arithmetic (TN-10). Pure functions only; the service feeds them the
 * scheme's kind-specific inputs and its claims.
 *
 * Every rate, cap and period here is the tenant's own entry, taken from its sanction order or the
 * Government Order (G.O.) it applied under. `SUGGESTED_DEFAULTS` only pre-fills the form and is
 * always shown with `VERIFY_NOTE`: scheme rules change by G.O. and this code never asserts them.
 *
 *  - Capital subsidy: entitlement = min((rate% + extra%) × eligible plant & machinery, cap).
 *  - LTPT power subsidy: rate% of the base tariff paid each month, for N months from the start
 *    month. Each month is UPCOMING (not over yet), CLAIMED / RECEIVED (covered by a live claim),
 *    DUE (over, unclaimed) or MISSED (over, unclaimed, and either a later month has already been
 *    claimed or the tenant's claim window has run out).
 *  - Interest subvention: rate% a year on the principal outstanding each day of the period
 *    (actual/365), from the balances the tenant records, with an optional annual cap pro rata.
 */

export const SCHEME_KINDS = [
  "CAPITAL_SUBSIDY",
  "POWER_SUBSIDY_LTPT",
  "INTEREST_SUBVENTION",
  "NEEDS",
  "PLI",
  "STATE_OTHER",
  "CENTRAL_OTHER",
] as const;
export type SchemeKind = (typeof SCHEME_KINDS)[number];

export const SCHEME_STATUSES = ["APPLIED", "SANCTIONED", "ACTIVE", "CLOSED", "REJECTED"] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];

export const CLAIM_STATUSES = ["DRAFT", "FILED", "APPROVED", "DISBURSED", "REJECTED"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** A claim that has been filed pending disbursement longer than this is flagged. */
export const PENDING_DISBURSEMENT_DAYS = 90;
/** An active scheme whose validity ends within this many days is flagged. */
export const EXPIRING_WITHIN_DAYS = 60;

export const VERIFY_NOTE =
  "Suggested defaults only. Verify every rate, cap and period with the current G.O. and your sanction order.";

/** Form pre-fills, never applied silently by the server. */
export const SUGGESTED_DEFAULTS = {
  CAPITAL_SUBSIDY: { ratePct: 25, extraPct: 0, cap: 15_000_000 },
  POWER_SUBSIDY_LTPT: { ratePct: 20, months: 36 },
  INTEREST_SUBVENTION: { subventionPct: 3 },
} as const;

// ── Status machines ─────────────────────────────────────────────────────────

const SCHEME_NEXT: Record<SchemeStatus, SchemeStatus[]> = {
  APPLIED: ["SANCTIONED", "REJECTED"],
  SANCTIONED: ["ACTIVE", "CLOSED"],
  ACTIVE: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
};

const CLAIM_NEXT: Record<ClaimStatus, ClaimStatus[]> = {
  DRAFT: ["FILED"],
  FILED: ["APPROVED", "DISBURSED", "REJECTED"],
  APPROVED: ["DISBURSED", "REJECTED"],
  DISBURSED: [],
  REJECTED: [],
};

export const schemeNext = (from: SchemeStatus): SchemeStatus[] => SCHEME_NEXT[from];
export const canMoveScheme = (from: SchemeStatus, to: SchemeStatus): boolean =>
  SCHEME_NEXT[from].includes(to);
export const claimNext = (from: ClaimStatus): ClaimStatus[] => CLAIM_NEXT[from];
export const canMoveClaim = (from: ClaimStatus, to: ClaimStatus): boolean =>
  CLAIM_NEXT[from].includes(to);

/** Claims can be raised only once the scheme is sanctioned and until it is closed. */
export const schemeTakesClaims = (s: SchemeStatus): boolean => s === "SANCTIONED" || s === "ACTIVE";

// ── Dates ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** A calendar date at UTC midnight. */
export const asDate = (v: Date | string): Date => {
  const d = typeof v === "string" ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : v;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
export const iso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(asDate(d).getTime() + n * DAY_MS);
export const daysBetween = (from: Date, to: Date): number =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / DAY_MS);

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** "2026-04" + 13 → "2027-05". */
export const addMonthKey = (key: string, n: number): string => {
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
};
export const monthStart = (key: string): Date => asDate(`${key}-01`);
export const monthEnd = (key: string): Date => addDays(monthStart(addMonthKey(key, 1)), -1);
export const monthKeyOf = (d: Date | string): string => iso(asDate(d)).slice(0, 7);

const overlaps = (aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): boolean =>
  aFrom.getTime() <= bTo.getTime() && bFrom.getTime() <= aTo.getTime();

export const periodsOverlap = (
  a: { from: Date | string; to: Date | string },
  b: { from: Date | string; to: Date | string }
): boolean => overlaps(asDate(a.from), asDate(a.to), asDate(b.from), asDate(b.to));

// ── Capital subsidy ─────────────────────────────────────────────────────────

export interface CapitalInput {
  eligiblePlantMachinery: number;
  ratePct: number;
  /** Additional % (micro unit, women / SC-ST entrepreneur, backward block ...) per the G.O. */
  extraPct?: number | null;
  /** Ceiling in rupees; null or absent means none was entered. */
  cap?: number | null;
}

export interface CapitalResult {
  effectivePct: number;
  gross: number;
  entitlement: number;
  capped: boolean;
}

export const capitalEntitlement = (c: CapitalInput): CapitalResult => {
  const effectivePct = c.ratePct + (c.extraPct ?? 0);
  const gross = round2((c.eligiblePlantMachinery * effectivePct) / 100);
  const capped = c.cap !== null && c.cap !== undefined && gross > c.cap;
  return { effectivePct, gross, entitlement: capped ? round2(c.cap as number) : gross, capped };
};

// ── Claims (shared shape) ───────────────────────────────────────────────────

export interface ClaimLike {
  id?: string;
  claimNo?: string;
  periodFrom: Date | string;
  periodTo: Date | string;
  amountClaimed: number;
  status: ClaimStatus;
  filedOn?: Date | string | null;
  disbursedAmount?: number | null;
}

const live = (c: ClaimLike) => c.status !== "REJECTED";

// ── LTPT power subsidy ──────────────────────────────────────────────────────

export interface LtptInput {
  /** First month of the subsidy, "YYYY-MM". */
  startMonth: string;
  months: number;
  ratePct: number;
  /** Base tariff (consumption charges) paid in a typical month. */
  monthlyBaseTariff: number;
  /** Actual base tariff for particular months, "YYYY-MM" → rupees. */
  tariffByMonth?: Record<string, number> | null;
  /** Days after a month ends within which it must be claimed; absent means not tracked. */
  claimWindowDays?: number | null;
}

export type LtptMonthState = "UPCOMING" | "DUE" | "MISSED" | "CLAIMED" | "RECEIVED";

export interface LtptMonth {
  month: string;
  index: number;
  from: string;
  to: string;
  tariff: number;
  entitlement: number;
  state: LtptMonthState;
  claimNo: string | null;
  claimStatus: ClaimStatus | null;
  /** Last day to claim, when the tenant entered a claim window. */
  claimBy: string | null;
}

export interface LtptSchedule {
  months: LtptMonth[];
  firstMonth: string;
  lastMonth: string;
  totals: {
    entitlement: number;
    claimed: number;
    received: number;
    due: number;
    missed: number;
    upcoming: number;
    dueMonths: number;
    missedMonths: number;
  };
}

const tariffFor = (l: LtptInput, key: string): number => {
  const t = l.tariffByMonth?.[key];
  return t !== undefined && t !== null && Number.isFinite(t) ? t : l.monthlyBaseTariff;
};

export const ltptSchedule = (
  l: LtptInput,
  claims: ClaimLike[],
  asOfIn: Date | string
): LtptSchedule => {
  const asOf = asDate(asOfIn);
  const liveClaims = claims.filter(live);
  const rows: LtptMonth[] = [];
  for (let i = 0; i < l.months; i++) {
    const key = addMonthKey(l.startMonth, i);
    const from = monthStart(key);
    const to = monthEnd(key);
    const tariff = round2(tariffFor(l, key));
    const cover = liveClaims
      .filter((c) => overlaps(from, to, asDate(c.periodFrom), asDate(c.periodTo)))
      // A disbursed claim wins over one still in progress for the same month.
      .sort((a, b) => Number(b.status === "DISBURSED") - Number(a.status === "DISBURSED"))[0];
    const over = asOf.getTime() > to.getTime();
    const claimBy =
      l.claimWindowDays !== null && l.claimWindowDays !== undefined
        ? addDays(to, l.claimWindowDays)
        : null;
    let state: LtptMonthState;
    if (cover) state = cover.status === "DISBURSED" ? "RECEIVED" : "CLAIMED";
    else if (!over) state = "UPCOMING";
    else if (claimBy && asOf.getTime() > claimBy.getTime()) state = "MISSED";
    else state = "DUE";
    rows.push({
      month: key,
      index: i + 1,
      from: iso(from),
      to: iso(to),
      tariff,
      entitlement: round2((tariff * l.ratePct) / 100),
      state,
      claimNo: cover?.claimNo ?? null,
      claimStatus: cover?.status ?? null,
      claimBy: claimBy ? iso(claimBy) : null,
    });
  }
  // A month left unclaimed while a later month has been claimed was skipped: missed.
  let laterClaimed = false;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.state === "CLAIMED" || r.state === "RECEIVED") laterClaimed = true;
    else if (r.state === "DUE" && laterClaimed) r.state = "MISSED";
  }
  const sum = (s: LtptMonthState[]) =>
    round2(rows.filter((r) => s.includes(r.state)).reduce((a, r) => a + r.entitlement, 0));
  return {
    months: rows,
    firstMonth: l.startMonth,
    lastMonth: addMonthKey(l.startMonth, l.months - 1),
    totals: {
      entitlement: sum(["UPCOMING", "DUE", "MISSED", "CLAIMED", "RECEIVED"]),
      claimed: sum(["CLAIMED", "RECEIVED"]),
      received: sum(["RECEIVED"]),
      due: sum(["DUE"]),
      missed: sum(["MISSED"]),
      upcoming: sum(["UPCOMING"]),
      dueMonths: rows.filter((r) => r.state === "DUE").length,
      missedMonths: rows.filter((r) => r.state === "MISSED").length,
    },
  };
};

/** Entitlement for the scheme months that fall (even partly) inside a claim period. */
export const ltptEntitlementFor = (
  l: LtptInput,
  fromIn: Date | string,
  toIn: Date | string
): { months: string[]; amount: number } => {
  const from = asDate(fromIn);
  const to = asDate(toIn);
  const months: string[] = [];
  let amount = 0;
  for (let i = 0; i < l.months; i++) {
    const key = addMonthKey(l.startMonth, i);
    if (!overlaps(monthStart(key), monthEnd(key), from, to)) continue;
    months.push(key);
    amount += round2((tariffFor(l, key) * l.ratePct) / 100);
  }
  return { months, amount: round2(amount) };
};

// ── Interest subvention ─────────────────────────────────────────────────────

export interface InterestInput {
  sanctionedLoan: number;
  subventionPct: number;
  /** Ceiling a year in rupees, applied pro rata to the period's days. */
  annualCap?: number | null;
  /** Principal outstanding from each date on; before the first entry the sanctioned loan. */
  balances?: { from: string; principal: number }[] | null;
}

export interface InterestResult {
  days: number;
  averagePrincipal: number;
  gross: number;
  amount: number;
  capped: boolean;
}

/** Subvention for [from, to], both days included: Σ principal(day) × rate / 365. */
export const interestSubvention = (
  i: InterestInput,
  fromIn: Date | string,
  toIn: Date | string
): InterestResult => {
  const from = asDate(fromIn);
  const to = asDate(toIn);
  const days = daysBetween(from, to) + 1;
  if (days <= 0) return { days: 0, averagePrincipal: 0, gross: 0, amount: 0, capped: false };
  const steps = [...(i.balances ?? [])]
    .map((b) => ({ at: asDate(b.from), principal: b.principal }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const principalOn = (d: Date): number => {
    let p = i.sanctionedLoan;
    for (const s of steps) {
      if (s.at.getTime() <= d.getTime()) p = s.principal;
      else break;
    }
    return p;
  };
  // Walk the period in segments between balance changes rather than day by day.
  const cuts = steps
    .map((s) => s.at)
    .filter((d) => d.getTime() > from.getTime() && d.getTime() <= to.getTime());
  let principalDays = 0;
  let segStart = from;
  for (const cut of [...cuts, addDays(to, 1)]) {
    principalDays += principalOn(segStart) * daysBetween(segStart, cut);
    segStart = cut;
  }
  const gross = round2((principalDays * i.subventionPct) / 100 / 365);
  const periodCap =
    i.annualCap !== null && i.annualCap !== undefined ? round2((i.annualCap * days) / 365) : null;
  const capped = periodCap !== null && gross > periodCap;
  return {
    days,
    averagePrincipal: round2(principalDays / days),
    gross,
    amount: capped ? (periodCap as number) : gross,
    capped,
  };
};

// ── Totals ──────────────────────────────────────────────────────────────────

export interface ClaimTotals {
  sanctioned: number | null;
  /** Filed, approved or disbursed: what has gone to the authority. */
  claimed: number;
  drafted: number;
  disbursed: number;
  /** Filed or approved, money not yet received. */
  pending: number;
  rejected: number;
  /** Claimed and disbursed but less money than claimed. */
  shortfall: number;
  /** Sanctioned less claimed and drafted; null without a sanctioned amount. */
  unclaimed: number | null;
}

export const claimTotals = (sanctioned: number | null, claims: ClaimLike[]): ClaimTotals => {
  const sum = (pick: (c: ClaimLike) => number, pred: (c: ClaimLike) => boolean) =>
    round2(claims.filter(pred).reduce((a, c) => a + pick(c), 0));
  const amt = (c: ClaimLike) => c.amountClaimed;
  const claimed = sum(amt, (c) => ["FILED", "APPROVED", "DISBURSED"].includes(c.status));
  const drafted = sum(amt, (c) => c.status === "DRAFT");
  const disbursed = sum(
    (c) => c.disbursedAmount ?? 0,
    (c) => c.status === "DISBURSED"
  );
  return {
    sanctioned,
    claimed,
    drafted,
    disbursed,
    pending: sum(amt, (c) => c.status === "FILED" || c.status === "APPROVED"),
    rejected: sum(amt, (c) => c.status === "REJECTED"),
    shortfall: round2(
      sum(amt, (c) => c.status === "DISBURSED") -
        sum(
          (c) => c.disbursedAmount ?? 0,
          (c) => c.status === "DISBURSED"
        )
    ),
    unclaimed: sanctioned === null ? null : round2(Math.max(sanctioned - claimed - drafted, 0)),
  };
};

/** Claims filed more than `days` ago and still waiting for money. */
export const pendingTooLong = (
  claims: ClaimLike[],
  asOfIn: Date | string,
  days = PENDING_DISBURSEMENT_DAYS
): (ClaimLike & { daysPending: number })[] => {
  const asOf = asDate(asOfIn);
  return claims
    .filter((c) => (c.status === "FILED" || c.status === "APPROVED") && c.filedOn)
    .map((c) => ({ ...c, daysPending: daysBetween(asDate(c.filedOn as Date | string), asOf) }))
    .filter((c) => c.daysPending > days);
};
