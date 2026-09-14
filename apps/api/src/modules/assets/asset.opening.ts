import { parseCsv, normaliseHeader } from "../imports/imports.csv";

/**
 * Opening-balance rows for the fixed-asset register (P2-07): a company migrating in mid-life has
 * machines already part-depreciated, and this is the way they get onto the register without
 * being typed in one at a time and without a book journal every time — see `asset.service.ts`
 * for why the journal posts once per class rather than once per row.
 */
export interface OpeningRowInput {
  classCode: string;
  code: string;
  name: string;
  businessPlaceCode?: string;
  capitalisedOn: string;
  cost: number;
  accumulatedDepreciation: number;
  method?: "SLM" | "WDV";
  remainingLifeMonths?: number;
  wdvRatePercent?: number;
  itBlockName?: string;
  quantity?: number;
  serialNo?: string;
  location?: string;
  residualValue?: number;
}

export const OPENING_COLUMNS = [
  { key: "classCode", label: "Class code", required: true, example: "PM" },
  { key: "code", label: "Asset code", required: true, example: "FA-0101" },
  { key: "name", label: "Asset name", required: true, example: "Injection Moulding Machine" },
  { key: "businessPlaceCode", label: "Business place", required: false, example: "HO" },
  { key: "capitalisedOn", label: "Put to use on", required: true, example: "2023-06-15" },
  { key: "cost", label: "Cost", required: true, example: "850000" },
  {
    key: "accumulatedDepreciation",
    label: "Accumulated depreciation to date",
    required: true,
    example: "212500",
  },
  { key: "method", label: "Method (SLM or WDV)", required: false, example: "SLM" },
  {
    key: "remainingLifeMonths",
    label: "Remaining life (months) — SLM assets",
    required: false,
    example: "84",
  },
  {
    key: "wdvRatePercent",
    label: "WDV rate % — WDV assets",
    required: false,
    example: "18.1",
  },
  {
    key: "itBlockName",
    label: "Income-tax block (must match the class)",
    required: false,
    example: "Plant and machinery (general)",
  },
  { key: "quantity", label: "Quantity", required: false, example: "1" },
  { key: "serialNo", label: "Serial number", required: false, example: "" },
  { key: "location", label: "Location", required: false, example: "Shed 2" },
  {
    key: "residualValue",
    label: "Residual value (defaults to the class's percentage)",
    required: false,
    example: "",
  },
] as const;

const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const t = v.replace(/[,\s₹]/g, "").trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** Turns pasted or uploaded CSV text into rows plus per-row column values, header order agnostic. */
export const parseOpeningCsv = (
  csv: string
): { rows: Partial<Record<string, string>>[]; headerErrors: string[] } => {
  const { headers, rows } = parseCsv(csv);
  const known = new Map(OPENING_COLUMNS.map((c) => [normaliseHeader(c.label), c.key] as const));
  // Also accept the column key itself as a header (e.g. "classCode"), not only the label.
  for (const c of OPENING_COLUMNS) known.set(normaliseHeader(c.key), c.key);
  const mapped = headers.map((h) => known.get(normaliseHeader(h)));
  const headerErrors: string[] = [];
  for (const c of OPENING_COLUMNS) {
    if (c.required && !mapped.includes(c.key)) headerErrors.push(`Missing column: ${c.label}`);
  }
  const out = rows.map((cells) => {
    const row: Partial<Record<string, string>> = {};
    cells.forEach((cell, i) => {
      const key = mapped[i];
      if (key && cell.trim() !== "") row[key] = cell.trim();
    });
    return row;
  });
  return { rows: out, headerErrors };
};

export interface RowError {
  row: number;
  message: string;
}

/**
 * Turns one raw record (from CSV or the single-row endpoint) into a validated
 * `OpeningRowInput`, or a list of problems. Business checks that need the database (class exists,
 * code is free) happen in the service, which is why this only validates shape.
 */
export const parseOpeningRow = (
  raw: Partial<Record<string, string>>,
  rowNo: number
): { value?: OpeningRowInput; errors: RowError[] } => {
  const errors: RowError[] = [];
  const err = (message: string) => errors.push({ row: rowNo, message });

  const classCode = (raw.classCode ?? "").trim().toUpperCase();
  if (!classCode) err("Class code is required");
  const code = (raw.code ?? "").trim().toUpperCase();
  if (!code) err("Asset code is required");
  if (code.length > 30) err("Asset code is too long (30 characters)");
  const name = (raw.name ?? "").trim();
  if (!name) err("Asset name is required");

  const capitalisedOn = (raw.capitalisedOn ?? "").trim();
  if (!capitalisedOn || Number.isNaN(Date.parse(capitalisedOn))) {
    err("Put-to-use date is required and must be a real date (YYYY-MM-DD)");
  }

  const cost = num(raw.cost);
  if (cost === undefined || Number.isNaN(cost) || cost <= 0) err("Cost must be a positive number");
  const accumulatedDepreciation = num(raw.accumulatedDepreciation) ?? 0;
  if (Number.isNaN(accumulatedDepreciation) || accumulatedDepreciation < 0) {
    err("Accumulated depreciation cannot be negative");
  }
  if (
    cost !== undefined &&
    !Number.isNaN(cost) &&
    !Number.isNaN(accumulatedDepreciation) &&
    accumulatedDepreciation >= cost
  ) {
    err("Accumulated depreciation cannot be the same as, or more than, the cost");
  }

  let method: "SLM" | "WDV" | undefined;
  if (raw.method) {
    const m = raw.method.trim().toUpperCase();
    if (m === "SLM" || m === "WDV") method = m;
    else err("Method must be SLM or WDV");
  }

  const remainingLifeMonths = num(raw.remainingLifeMonths);
  if (
    remainingLifeMonths !== undefined &&
    (Number.isNaN(remainingLifeMonths) || remainingLifeMonths <= 0)
  ) {
    err("Remaining life must be a positive number of months");
  }
  const wdvRatePercent = num(raw.wdvRatePercent);
  if (
    wdvRatePercent !== undefined &&
    (Number.isNaN(wdvRatePercent) || wdvRatePercent <= 0 || wdvRatePercent >= 100)
  ) {
    err("The WDV rate must be a percentage between 0 and 100");
  }
  const effectiveMethod = method ?? undefined;
  if (effectiveMethod === "SLM" && remainingLifeMonths === undefined) {
    err("A straight-line asset needs its remaining life in months");
  }
  if (effectiveMethod === "WDV" && wdvRatePercent === undefined) {
    err("A written-down-value asset needs its WDV rate");
  }

  const quantity = num(raw.quantity);
  if (quantity !== undefined && (Number.isNaN(quantity) || quantity <= 0)) {
    err("Quantity must be a positive number");
  }
  const residualValue = num(raw.residualValue);
  if (residualValue !== undefined && (Number.isNaN(residualValue) || residualValue < 0)) {
    err("Residual value cannot be negative");
  }

  if (errors.length > 0) return { errors };
  return {
    errors: [],
    value: {
      classCode,
      code,
      name,
      businessPlaceCode: raw.businessPlaceCode?.trim() || undefined,
      capitalisedOn,
      cost: cost as number,
      accumulatedDepreciation,
      method,
      remainingLifeMonths,
      wdvRatePercent,
      itBlockName: raw.itBlockName?.trim() || undefined,
      quantity,
      serialNo: raw.serialNo?.trim() || undefined,
      location: raw.location?.trim() || undefined,
      residualValue,
    },
  };
};

/**
 * The useful life, in months, that makes Schedule II's WDV formula land on `ratePercent` for
 * this cost and residual. The Act gives a rate here, not a life, and the engine in
 * `depreciation.calc.ts` wants a life — this is the one place that runs the formula backwards, and
 * only for an opening import.
 */
export const usefulLifeMonthsFromWdvRate = (
  ratePercent: number,
  cost: number,
  residual: number
): number => {
  const rate = ratePercent / 100;
  const ratio = Math.max(residual, 0.01) / cost;
  if (rate <= 0 || rate >= 1 || ratio <= 0 || ratio >= 1) return 60;
  const years = Math.log(ratio) / Math.log(1 - rate);
  return Math.max(1, Math.round(years * 12));
};
