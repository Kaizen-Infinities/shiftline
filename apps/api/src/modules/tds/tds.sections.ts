/**
 * The sections tax is deducted or collected under, as they stand for FY 2026-27 (P1-15).
 *
 * The Income-tax Act 2025 renumbers deduction at source into section 393 and collection into
 * 394, each a table of items. Nobody says that out loud: challans, the return utilities and
 * every accountant still say 194C and 194J. So both travel together — `code` is the familiar
 * one and what the return carries, `actCode` says where it now sits — and a tenant can edit
 * either, because rates move with every Finance Act and a hard-coded list would be wrong within
 * a year.
 *
 * Rates and thresholds below are the seed a tenant starts from, not the last word.
 */
export interface TdsSectionSeed {
  code: string;
  actCode: string;
  name: string;
  isTcs?: boolean;
  rateCompany: number;
  rateIndividual: number;
  rateNoPan?: number;
  thresholdSingle?: number;
  thresholdAnnual?: number;
  ledgerCode: string;
}

export const TDS_SECTION_SEEDS: readonly TdsSectionSeed[] = [
  {
    code: "194C",
    actCode: "393 Table item 2",
    name: "Payments to contractors and sub-contractors",
    // A contractor who is an individual or HUF is deducted at 1%, anyone else at 2%.
    rateCompany: 2,
    rateIndividual: 1,
    thresholdSingle: 30000,
    thresholdAnnual: 100000,
    ledgerCode: "TDS-194C",
  },
  {
    code: "194J",
    actCode: "393 Table item 6",
    name: "Fees for professional or technical services",
    rateCompany: 10,
    rateIndividual: 10,
    thresholdAnnual: 30000,
    ledgerCode: "TDS-194J",
  },
  {
    code: "194H",
    actCode: "393 Table item 4",
    name: "Commission or brokerage",
    rateCompany: 5,
    rateIndividual: 5,
    thresholdAnnual: 15000,
    ledgerCode: "TDS-194H",
  },
  {
    code: "194I(a)",
    actCode: "393 Table item 5",
    name: "Rent of plant and machinery",
    rateCompany: 2,
    rateIndividual: 2,
    thresholdAnnual: 240000,
    ledgerCode: "TDS-194IA",
  },
  {
    code: "194I(b)",
    actCode: "393 Table item 5",
    name: "Rent of land, building or furniture",
    rateCompany: 10,
    rateIndividual: 10,
    thresholdAnnual: 240000,
    ledgerCode: "TDS-194IB",
  },
  {
    code: "194Q",
    actCode: "393 Table item 9",
    name: "Purchase of goods above ₹50 lakh in the year",
    // 0.1% of the value *above* the threshold, not of the whole purchase.
    rateCompany: 0.1,
    rateIndividual: 0.1,
    rateNoPan: 5,
    thresholdAnnual: 5000000,
    ledgerCode: "TDS-194Q",
  },
  {
    code: "194A",
    actCode: "393 Table item 1",
    name: "Interest other than on securities",
    rateCompany: 10,
    rateIndividual: 10,
    thresholdAnnual: 40000,
    ledgerCode: "TDS-194A",
  },
  {
    code: "206C(1)",
    actCode: "394 Table item 1",
    name: "Collection at source on scrap",
    isTcs: true,
    rateCompany: 1,
    rateIndividual: 1,
    rateNoPan: 5,
    ledgerCode: "TCS-206C1",
  },
  {
    code: "206C(1H)",
    actCode: "394 Table item 8",
    name: "Collection at source on sale of goods above ₹50 lakh",
    isTcs: true,
    rateCompany: 0.1,
    rateIndividual: 0.1,
    rateNoPan: 1,
    thresholdAnnual: 5000000,
    ledgerCode: "TCS-206C1H",
  },
];

/** PAN: five letters, four digits, a letter. The fourth letter says what kind of holder it is. */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const isValidPan = (pan: string | null | undefined): boolean =>
  typeof pan === "string" && PAN_RE.test(pan.trim().toUpperCase());

/**
 * The holder type encoded in a PAN's fourth character. It is the cheapest check there is that a
 * PAN belongs to the kind of payee the deduction assumes — a company PAN on a line deducted at
 * the individual rate is a mistake worth catching before the return is filed.
 */
export const panHolderType = (pan: string): string | null => {
  if (!isValidPan(pan)) return null;
  const map: Record<string, string> = {
    C: "COMPANY",
    P: "INDIVIDUAL_HUF",
    H: "INDIVIDUAL_HUF",
    F: "FIRM",
    A: "AOP_BOI",
    B: "AOP_BOI",
    T: "AOP_BOI",
    L: "LOCAL_AUTHORITY",
    J: "LOCAL_AUTHORITY",
    G: "LOCAL_AUTHORITY",
  };
  return map[pan.trim().toUpperCase()[3]] ?? null;
};

/** The Indian financial year and quarter a date falls in. */
export const fyAndQuarter = (d: Date): { fyCode: string; quarter: string } => {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  const startYear = m >= 3 ? y : y - 1;
  const fyCode = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  // Q1 is April to June, so the quarter is offset by three months.
  const quarter = `Q${Math.floor(((m - 3 + 12) % 12) / 3) + 1}`;
  return { fyCode, quarter };
};
