/**
 * Statutory filings that pass through the approval gate (P1-04, PC7). Each later package
 * (GST returns, TDS, payroll) registers its returns here; the gate is generic over the key.
 */
export type FilingCadence = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL";

export interface FilingDef {
  key: string;
  name: string;
  authority: "GST" | "INCOME_TAX" | "EPFO" | "ESIC" | "STATE" | "MCA";
  cadence: FilingCadence;
  /** Whether the filing is per GSTIN / business place rather than per company. */
  perBusinessPlace: boolean;
}

export const FILINGS: readonly FilingDef[] = [
  { key: "GSTR1", name: "GSTR-1", authority: "GST", cadence: "MONTHLY", perBusinessPlace: true },
  { key: "GSTR1A", name: "GSTR-1A", authority: "GST", cadence: "MONTHLY", perBusinessPlace: true },
  { key: "GSTR3B", name: "GSTR-3B", authority: "GST", cadence: "MONTHLY", perBusinessPlace: true },
  { key: "IMS", name: "IMS actions", authority: "GST", cadence: "MONTHLY", perBusinessPlace: true },
  { key: "GSTR9", name: "GSTR-9", authority: "GST", cadence: "ANNUAL", perBusinessPlace: true },
  {
    key: "ITC04",
    name: "ITC-04",
    authority: "GST",
    cadence: "HALF_YEARLY",
    perBusinessPlace: true,
  },
  {
    key: "TDS_26Q",
    name: "Form 26Q",
    authority: "INCOME_TAX",
    cadence: "QUARTERLY",
    perBusinessPlace: false,
  },
  {
    key: "TDS_27Q",
    name: "Form 27Q",
    authority: "INCOME_TAX",
    cadence: "QUARTERLY",
    perBusinessPlace: false,
  },
  {
    key: "TDS_24Q",
    name: "Form 24Q",
    authority: "INCOME_TAX",
    cadence: "QUARTERLY",
    perBusinessPlace: false,
  },
  {
    key: "TDS_CHALLAN",
    name: "TDS challan (ITNS 281)",
    authority: "INCOME_TAX",
    cadence: "MONTHLY",
    perBusinessPlace: false,
  },
  {
    key: "PF_ECR",
    name: "EPFO ECR",
    authority: "EPFO",
    cadence: "MONTHLY",
    perBusinessPlace: false,
  },
  {
    key: "ESI_MONTHLY",
    name: "ESIC monthly contribution",
    authority: "ESIC",
    cadence: "MONTHLY",
    perBusinessPlace: false,
  },
  {
    key: "PT_RETURN",
    name: "Professional tax return",
    authority: "STATE",
    cadence: "MONTHLY",
    perBusinessPlace: false,
  },
  {
    key: "PAYROLL_RUN",
    name: "Payroll run",
    authority: "MCA",
    cadence: "MONTHLY",
    perBusinessPlace: false,
  },
];

export const FILING_KEYS: readonly string[] = FILINGS.map((f) => f.key);

export const filingByKey = (key: string): FilingDef | undefined =>
  FILINGS.find((f) => f.key === key);

/** Period key format per cadence: 2026-08, 2026-Q2, 2026-H1, 2026-27. */
export const PERIOD_KEY_RE: Record<FilingCadence, RegExp> = {
  MONTHLY: /^\d{4}-(0[1-9]|1[0-2])$/,
  QUARTERLY: /^\d{4}-Q[1-4]$/,
  HALF_YEARLY: /^\d{4}-H[12]$/,
  ANNUAL: /^\d{4}-\d{2}$/,
};

export const isValidPeriodKey = (key: string, cadence: FilingCadence): boolean =>
  PERIOD_KEY_RE[cadence].test(key);

export const FILING_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "SUBMITTED"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];
