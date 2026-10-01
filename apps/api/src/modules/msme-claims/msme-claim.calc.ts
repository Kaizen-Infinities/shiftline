/**
 * MSME delayed-payment claim arithmetic (TN-05): sections 15 and 16 of the MSMED Act, 2006,
 * from the supplier's side. Pure functions only; the service feeds them invoices and payments.
 *
 * Section 15: the buyer must pay by the date agreed in writing, which may not be more than 45
 * days from the day of acceptance (or deemed acceptance); where nothing was agreed, the buyer
 * must pay before the "appointed day", the day after 15 days from acceptance.
 *
 * Section 16: a buyer who pays late owes compound interest **with monthly rests** at **three
 * times the bank rate** notified by the RBI, from the appointed day (or the day after the agreed
 * date) until payment. The interest is not a matter of contract: section 16 applies
 * "notwithstanding anything contained in any agreement".
 *
 * How this implementation reads it (documented so a reviewer can disagree precisely):
 *  - "Acceptance" defaults to the invoice date; the caller may pass a later acceptance date.
 *  - A written agreement is represented by `agreedDays` (the invoice's own due date or the
 *    customer's credit days). `null` means no agreement, so 15 days apply.
 *  - Interest runs for each day after the due date up to and including the as-of date (a
 *    payment made on a day still bears that day's interest).
 *  - Rests fall on each monthly anniversary of the first interest day. At a rest the interest of
 *    the month just ended is added to the balance and itself bears interest from then on.
 *    Within a rest period the monthly rate (annual / 12) is spread evenly over that period's
 *    days, so a whole month always earns exactly annual / 12 whatever its length.
 *  - A part-payment reduces the principal outstanding; interest already accrued is not
 *    reduced by it (it is claimed separately, as section 16 treats it).
 */

export const DAYS_WITHOUT_AGREEMENT = 15;
export const MAX_AGREED_DAYS = 45;
export const INTEREST_MULTIPLE = 3;
/** Default RBI bank rate used until the tenant sets its own (VERIFY against the RBI notice). */
export const DEFAULT_BANK_RATE = 6.75;
/** TReDS platforms discount invoices up to 180 days old. */
export const TREDS_MAX_AGE_DAYS = 180;

const DAY_MS = 86_400_000;

/** A calendar date at UTC midnight (dates here carry no time). */
export const asDate = (v: Date | string): Date => {
  const d = typeof v === "string" ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : v;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
export const iso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
export const daysBetween = (from: Date, to: Date): number =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / DAY_MS);

/**
 * The same day `n` months later, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb).
 * Always computed from the anchor, so rests never drift after a short month.
 */
export const addMonths = (anchor: Date, n: number): Date => {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchor.getUTCDate(), last)));
};

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Section 15 limit in days: the agreed term capped at 45, or 15 with no agreement. */
export const limitDaysFor = (agreedDays: number | null | undefined): number =>
  agreedDays === null || agreedDays === undefined || !Number.isFinite(agreedDays)
    ? DAYS_WITHOUT_AGREEMENT
    : Math.max(0, Math.min(Math.floor(agreedDays), MAX_AGREED_DAYS));

/** The last day the buyer may pay without interest. */
export const dueDateFor = (acceptedOn: Date, agreedDays: number | null | undefined): Date =>
  addDays(asDate(acceptedOn), limitDaysFor(agreedDays));

/** Annual interest rate under section 16, in per cent. */
export const interestRateFor = (bankRate: number): number => round4(bankRate * INTEREST_MULTIPLE);
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export interface ClaimPayment {
  date: Date | string;
  amount: number;
}

export interface ClaimInput {
  /** Invoice total the buyer owed. */
  amount: number;
  invoiceDate: Date | string;
  /** Day of acceptance; defaults to the invoice date. */
  acceptedOn?: Date | string | null;
  /** Agreed credit term in days; null or undefined when nothing was agreed in writing. */
  agreedDays?: number | null;
  payments: ClaimPayment[];
  /** RBI bank rate, per cent a year. */
  bankRate: number;
  asOf: Date | string;
}

export interface ClaimResult {
  acceptedOn: string;
  limitDays: number;
  dueDate: string;
  /** First day interest runs (the appointed day or the day after the agreed date). */
  interestFrom: string;
  annualRate: number;
  amount: number;
  /** Payments on or before the as-of date. */
  paid: number;
  /** Principal still unpaid on the as-of date. */
  principalOutstanding: number;
  /** Days between the due date and the as-of date (0 when not yet due). */
  daysLate: number;
  /** Rests passed (months of interest capitalised). */
  rests: number;
  /** Compound interest accrued up to the as-of date. */
  interest: number;
  /** True once the section 15 date has passed with money still unpaid, or was paid late. */
  late: boolean;
}

/**
 * Section 15 due date and section 16 interest for one invoice as of a date.
 * Payments after `asOf` are ignored (they have not happened yet as far as this answer goes).
 */
export const computeClaim = (input: ClaimInput): ClaimResult => {
  const asOf = asDate(input.asOf);
  const acceptedOn = asDate(input.acceptedOn ?? input.invoiceDate);
  const limitDays = limitDaysFor(input.agreedDays);
  const dueDate = addDays(acceptedOn, limitDays);
  const interestFrom = addDays(dueDate, 1);
  const annualRate = interestRateFor(input.bankRate);
  const monthlyRate = annualRate / 100 / 12;

  const payments = input.payments
    .map((p) => ({ date: asDate(p.date), amount: Number(p.amount) || 0 }))
    .filter((p) => p.amount > 0 && p.date.getTime() <= asOf.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  const amount = round2(input.amount);

  // Principal on the first interest day: what was paid by the due date never bears interest.
  let principal = amount;
  let pi = 0;
  while (pi < payments.length && payments[pi].date.getTime() <= dueDate.getTime()) {
    principal -= payments[pi].amount;
    pi += 1;
  }
  principal = Math.max(principal, 0);

  let capitalised = 0;
  let pending = 0;
  let rests = 0;
  let restStart = interestFrom;
  let nextRest = addMonths(interestFrom, 1);
  let periodDays = daysBetween(restStart, nextRest);

  for (let d = interestFrom; d.getTime() <= asOf.getTime(); d = addDays(d, 1)) {
    if (d.getTime() === nextRest.getTime()) {
      // A rest: the month's interest joins the balance and bears interest from today.
      capitalised += pending;
      pending = 0;
      rests += 1;
      restStart = nextRest;
      nextRest = addMonths(interestFrom, rests + 1);
      periodDays = daysBetween(restStart, nextRest);
    }
    if (principal <= 0.005 && capitalised <= 0.005 && pi >= payments.length) break;
    // Today's interest is on the balance before today's payments (the payment day bears interest).
    pending += ((principal + capitalised) * monthlyRate) / periodDays;
    while (pi < payments.length && payments[pi].date.getTime() <= d.getTime()) {
      principal = Math.max(principal - payments[pi].amount, 0);
      pi += 1;
    }
    // Once the principal is gone, the interest is frozen: section 16 runs "till payment".
    if (principal <= 0.005) break;
  }

  const interest = round2(capitalised + pending);
  const principalOutstanding = round2(Math.max(amount - paid, 0));
  const daysLate = Math.max(daysBetween(dueDate, asOf), 0);
  return {
    acceptedOn: iso(acceptedOn),
    limitDays,
    dueDate: iso(dueDate),
    interestFrom: iso(interestFrom),
    annualRate,
    amount,
    paid,
    principalOutstanding,
    daysLate,
    rests,
    interest,
    late: interest > 0 || (principalOutstanding > 0 && daysLate > 0),
  };
};

export type TredsFlag = "CHECK" | "NO";

/**
 * TReDS discounting: the platforms take accepted invoices up to 180 days old from MSME sellers
 * on large or PSU buyers. The buyer's turnover is not on file, so an invoice that passes the
 * checks we can make is shown as "CHECK", never as a flat yes.
 */
export const tredsFlag = (opts: {
  invoiceDate: Date | string;
  asOf: Date | string;
  accepted: boolean;
  principalOutstanding: number;
}): { flag: TredsFlag; reason: string } => {
  if (opts.principalOutstanding <= 0) return { flag: "NO", reason: "Nothing left to discount" };
  if (!opts.accepted) return { flag: "NO", reason: "The buyer has not accepted the invoice" };
  const age = daysBetween(asDate(opts.invoiceDate), asDate(opts.asOf));
  if (age > TREDS_MAX_AGE_DAYS) {
    return { flag: "NO", reason: `Older than ${TREDS_MAX_AGE_DAYS} days` };
  }
  return { flag: "CHECK", reason: "Check the buyer is registered on a TReDS platform" };
};

/** Claim workflow: a claim only moves forward (or is withdrawn before it settles). */
export const CLAIM_STATUSES = ["DRAFT", "FILED", "HEARING", "SETTLED", "WITHDRAWN"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const NEXT: Record<ClaimStatus, ClaimStatus[]> = {
  DRAFT: ["FILED", "WITHDRAWN"],
  FILED: ["HEARING", "SETTLED", "WITHDRAWN"],
  HEARING: ["SETTLED", "WITHDRAWN"],
  SETTLED: [],
  WITHDRAWN: [],
};

export const allowedNext = (from: ClaimStatus): ClaimStatus[] => NEXT[from];
export const canTransition = (from: ClaimStatus, to: ClaimStatus): boolean =>
  NEXT[from].includes(to);
