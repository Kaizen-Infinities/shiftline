import { createHash } from "node:crypto";

import { parseCsv } from "../imports/imports.csv";
import { ApiError } from "../../utils/ApiError";

/**
 * Reading a bank's statement export (P1-20).
 *
 * Every Indian bank exports a different CSV and none of them will change it for us, so the work
 * is in the normalisation rather than the parsing:
 *
 *  - **Dates** come as `dd/mm/yyyy`, `dd-mm-yy`, `dd-MMM-yyyy` and occasionally `yyyy-mm-dd`.
 *    The day-first reading is the right default here — a bank in India does not write 03/04 to
 *    mean the fourth of March — and a four-digit year settles the ambiguous cases.
 *  - **Amounts** carry commas in the Indian grouping, sometimes a `Cr`/`Dr` suffix, sometimes
 *    brackets for a negative, and sometimes arrive as one signed column instead of two.
 *  - **Headers** differ in wording and in case; each bank's aliases are listed rather than
 *    guessed at from the position, because the column order changes between exports too.
 */
export const STATEMENT_FORMATS = ["HDFC", "ICICI", "SBI", "AXIS", "KOTAK", "GENERIC"] as const;
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];

export interface ParsedStatementLine {
  txnDate: Date;
  valueDate: Date | null;
  description: string;
  refNo: string | null;
  debit: number;
  credit: number;
  runningBalance: number | null;
}

export interface ColumnMap {
  txnDate: string[];
  valueDate?: string[];
  description: string[];
  refNo?: string[];
  debit?: string[];
  credit?: string[];
  /** One signed column instead of a debit and a credit. */
  amount?: string[];
  balance?: string[];
}

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** What each bank calls its columns. Matched on the normalised header, in the order listed. */
export const COLUMN_MAPS: Record<StatementFormat, ColumnMap> = {
  HDFC: {
    txnDate: ["date"],
    valueDate: ["valuedt", "valuedate"],
    description: ["narration"],
    refNo: ["chqrefnumber", "chqrefno", "refno"],
    debit: ["withdrawalamt", "withdrawalamount"],
    credit: ["depositamt", "depositamount"],
    balance: ["closingbalance", "balance"],
  },
  ICICI: {
    txnDate: ["transactiondate", "txndate", "date"],
    valueDate: ["valuedate"],
    description: ["transactionremarks", "remarks", "description"],
    refNo: ["chequenumber", "cheque", "refno"],
    debit: ["withdrawalamountinr", "withdrawalamount", "debit"],
    credit: ["depositamountinr", "depositamount", "credit"],
    balance: ["balanceinr", "balance"],
  },
  SBI: {
    txnDate: ["txndate", "date"],
    valueDate: ["valuedate"],
    description: ["description", "particulars"],
    refNo: ["refnochequeno", "chequeno", "refno"],
    debit: ["debit"],
    credit: ["credit"],
    balance: ["balance"],
  },
  AXIS: {
    txnDate: ["trandate", "transactiondate", "date"],
    valueDate: ["valuedate"],
    description: ["particulars", "description"],
    refNo: ["chqno", "chequeno", "refno"],
    debit: ["debit", "withdrawal"],
    credit: ["credit", "deposit"],
    balance: ["balance"],
  },
  KOTAK: {
    txnDate: ["date", "transactiondate"],
    valueDate: ["valuedate"],
    description: ["description", "narration"],
    refNo: ["chqrefno", "chequereferenceno", "refno"],
    // Kotak exports one signed column, and a "Dr/Cr" marker beside it.
    amount: ["amount"],
    debit: ["withdrawal"],
    credit: ["deposit"],
    balance: ["balance"],
  },
  GENERIC: {
    txnDate: ["date", "txndate", "transactiondate"],
    valueDate: ["valuedate"],
    description: ["description", "narration", "particulars", "remarks"],
    refNo: ["refno", "reference", "chequeno", "chqno"],
    debit: ["debit", "withdrawal", "withdrawalamount"],
    credit: ["credit", "deposit", "depositamount"],
    amount: ["amount"],
    balance: ["balance", "closingbalance"],
  },
};

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * A bank's date, whatever order it decided on.
 *
 * Day-first is the default because that is what an Indian bank writes; `yyyy-mm-dd` is detected
 * by the four-digit leading year, and a two-digit year is read as this century.
 */
export const parseBankDate = (raw: string): Date | null => {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  // 2026-08-05 or 2026/08/05
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // 05-Aug-2026
  m = /^(\d{1,2})[-/\s]([A-Za-z]{3})[a-z]*[-/\s](\d{2,4})/.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) return null;
    const year = Number(m[3]);
    return new Date(Date.UTC(year < 100 ? 2000 + year : year, month, Number(m[1])));
  }
  // 05/08/2026 — day first, which is what the banks here print.
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(text);
  if (m) {
    const year = Number(m[3]);
    return new Date(Date.UTC(year < 100 ? 2000 + year : year, Number(m[2]) - 1, Number(m[1])));
  }
  return null;
};

/** An amount with the commas, the brackets and the Cr/Dr marker taken off. */
export const parseAmount = (raw: string): number => {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text) || /\bdr\b/i.test(text) || text.startsWith("-");
  const digits = text.replace(/[^0-9.]/g, "");
  if (!digits) return 0;
  const value = Math.round((Number(digits) || 0) * 100) / 100;
  return negative ? -value : value;
};

/**
 * The reference with the noise taken out, so that "CHQ 000123" and "chq-123" are the same
 * reference — which is what makes an automatic match possible at all.
 */
export const normaliseRef = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const stripped = String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!stripped) return null;
  // Drop the zeros padding the final numeric run, as a cheque number is written both ways.
  return stripped.replace(/\d+$/, (d) => d.replace(/^0+(?=\d)/, "")).slice(0, 60);
};

/** Date, amount and reference: enough to know a row has been imported before. */
export const dedupeHash = (line: ParsedStatementLine): string =>
  createHash("sha256")
    .update(
      [
        line.txnDate.toISOString().slice(0, 10),
        line.debit.toFixed(2),
        line.credit.toFixed(2),
        normaliseRef(line.refNo) ?? "",
        line.description.trim().slice(0, 120).toUpperCase(),
      ].join("|")
    )
    .digest("hex");

const pick = (headers: string[], aliases: string[] | undefined): number => {
  if (!aliases) return -1;
  for (const alias of aliases) {
    const i = headers.indexOf(alias);
    if (i >= 0) return i;
  }
  return -1;
};

export const parseStatement = (
  csv: string,
  format: StatementFormat,
  override?: Partial<ColumnMap>
): ParsedStatementLine[] => {
  const parsed = parseCsv(csv);
  if (parsed.headers.length === 0) throw new ApiError(400, "That file has no header row");
  const headers = parsed.headers.map(norm);
  const map = { ...COLUMN_MAPS[format], ...(override ?? {}) };

  const iDate = pick(headers, map.txnDate);
  const iDesc = pick(headers, map.description);
  if (iDate < 0) {
    throw new ApiError(
      400,
      "No date column was found; check the format or supply a column mapping",
      "NO_DATE_COLUMN"
    );
  }
  const iValue = pick(headers, map.valueDate);
  const iRef = pick(headers, map.refNo);
  const iDebit = pick(headers, map.debit);
  const iCredit = pick(headers, map.credit);
  const iAmount = pick(headers, map.amount);
  const iBalance = pick(headers, map.balance);

  const out: ParsedStatementLine[] = [];
  for (const row of parsed.rows) {
    const txnDate = parseBankDate(row[iDate] ?? "");
    // A bank's export has a header block and a footer; rows without a readable date are those.
    if (!txnDate) continue;
    let debit = iDebit >= 0 ? Math.abs(parseAmount(row[iDebit] ?? "")) : 0;
    let credit = iCredit >= 0 ? Math.abs(parseAmount(row[iCredit] ?? "")) : 0;
    if (debit === 0 && credit === 0 && iAmount >= 0) {
      // One signed column: negative is money leaving the account.
      const amount = parseAmount(row[iAmount] ?? "");
      if (amount < 0) debit = Math.abs(amount);
      else credit = amount;
    }
    if (debit === 0 && credit === 0) continue;
    out.push({
      txnDate,
      valueDate: iValue >= 0 ? parseBankDate(row[iValue] ?? "") : null,
      description: (row[iDesc] ?? "").trim().slice(0, 400),
      refNo: iRef >= 0 ? (row[iRef] ?? "").trim().slice(0, 60) || null : null,
      debit,
      credit,
      runningBalance: iBalance >= 0 ? parseAmount(row[iBalance] ?? "") : null,
    });
  }
  if (out.length === 0) {
    throw new ApiError(400, "No transactions could be read from that file", "NO_ROWS");
  }
  return out;
};
