/**
 * Ageing (P1-10): how long a document's unpaid balance has been past its due date. The due date
 * is the document date plus the party's credit days; a document with no due date falls due on
 * its own date. Buckets follow the usual Indian practice: not yet due, then 0–30, 31–60, 61–90
 * and over 90 days overdue.
 */
export const AGEING_BUCKETS = ["notDue", "d0_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export const AGEING_BUCKET_LABELS: Record<AgeingBucket, string> = {
  notDue: "Not due",
  d0_30: "0–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "Over 90 days",
};

const DAY = 24 * 60 * 60 * 1000;
const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** `date` plus `creditDays` (0 or null means due on the day itself). */
export const dueDateFrom = (date: Date, creditDays: number | null | undefined): Date => {
  const due = dayStart(date);
  due.setUTCDate(due.getUTCDate() + Math.max(0, creditDays ?? 0));
  return due;
};

/** Whole days `asOn` is past `due`; negative while not yet due. */
export const daysOverdue = (due: Date, asOn: Date): number =>
  Math.floor((dayStart(asOn).getTime() - dayStart(due).getTime()) / DAY);

export const bucketFor = (overdue: number): AgeingBucket => {
  if (overdue < 0) return "notDue";
  if (overdue <= 30) return "d0_30";
  if (overdue <= 60) return "d31_60";
  if (overdue <= 90) return "d61_90";
  return "d90_plus";
};

export type BucketTotals = Record<AgeingBucket, number>;
export const emptyBuckets = (): BucketTotals => ({
  notDue: 0,
  d0_30: 0,
  d31_60: 0,
  d61_90: 0,
  d90_plus: 0,
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Simple interest on an overdue balance at an annual rate, for the days it has been overdue. */
export const overdueInterest = (
  balance: number,
  overdue: number,
  annualRate: number | null | undefined
): number => {
  if (!annualRate || overdue <= 0 || balance <= 0) return 0;
  return round2((balance * (annualRate / 100) * overdue) / 365);
};
