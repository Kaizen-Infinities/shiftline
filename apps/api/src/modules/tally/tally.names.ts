/**
 * What our books are called in Tally (P1-06).
 *
 * Tally creates a fixed set of groups in every company and will not let you rename them. Their
 * names are nearly ours but not quite — our "Cash in Hand" is its "Cash-in-Hand", our "Direct
 * Income" its "Direct Incomes" — and importing a group under our spelling does not fail. It
 * quietly creates a *second* group beside the reserved one, and from then on half the balance
 * sheet is in the wrong place with nothing to show for it.
 *
 * So the mapping below is the load-bearing part of this package. A reserved group is never
 * exported as a master, because Tally already has it; one of ours is created under the reserved
 * parent it belongs beneath.
 */
import type { LedgerType, TallyNameKind } from "@prisma/client";

/** What a tenant has renamed one of our records to on the Tally side. */
export interface TallyOverride {
  tallyName?: string;
  tallyParent?: string;
  /** False keeps the record out of the file entirely. */
  isExported: boolean;
}

/** The builders ask this per record rather than each loading the map themselves. */
export interface TallyNameLookup {
  override: (kind: TallyNameKind, sourceCode: string) => TallyOverride;
}

/** Our standard group code → the group Tally already has. */
export const TALLY_RESERVED_GROUPS: Readonly<Record<string, string>> = {
  FIXED_ASSETS: "Fixed Assets",
  INVESTMENTS: "Investments",
  CURRENT_ASSETS: "Current Assets",
  CASH_IN_HAND: "Cash-in-Hand",
  BANK_ACCOUNTS: "Bank Accounts",
  SUNDRY_DEBTORS: "Sundry Debtors",
  STOCK_IN_HAND: "Stock-in-Hand",
  LOANS_ADVANCES_ASSET: "Loans & Advances (Asset)",
  DEPOSITS_ASSET: "Deposits (Asset)",
  MISC_EXPENSES_ASSET: "Misc. Expenses (ASSET)",
  LOANS_LIABILITY: "Loans (Liability)",
  SECURED_LOANS: "Secured Loans",
  UNSECURED_LOANS: "Unsecured Loans",
  BANK_OD: "Bank OD A/c",
  CURRENT_LIABILITIES: "Current Liabilities",
  SUNDRY_CREDITORS: "Sundry Creditors",
  TAX_LIABILITIES: "Duties & Taxes",
  PROVISIONS: "Provisions",
  SUSPENSE: "Suspense A/c",
  CAPITAL: "Capital Account",
  RESERVES_SURPLUS: "Reserves & Surplus",
  SALES_ACCOUNTS: "Sales Accounts",
  DIRECT_INCOME: "Direct Incomes",
  INDIRECT_INCOME: "Indirect Incomes",
  PURCHASE_ACCOUNTS: "Purchase Accounts",
  DIRECT_EXPENSES: "Direct Expenses",
  INDIRECT_EXPENSES: "Indirect Expenses",
};

/**
 * Groups of ours that Tally has no equivalent for, and the reserved group each is created
 * beneath. Without this they would land at the top of the chart as primary groups, which changes
 * the balance sheet.
 */
export const TALLY_CUSTOM_GROUP_PARENTS: Readonly<Record<string, string>> = {
  TAX_ASSETS: "Current Assets",
  OTHER_CURRENT_ASSETS: "Current Assets",
  OTHER_CURRENT_LIABILITIES: "Current Liabilities",
  EMPLOYEE_COSTS: "Indirect Expenses",
  FINANCE_COSTS: "Indirect Expenses",
  DEPRECIATION: "Indirect Expenses",
};

/** Where a ledger goes when its group is unknown — by nature, never nowhere. */
export const FALLBACK_GROUP_BY_NATURE: Readonly<Record<LedgerType, string>> = {
  ASSET: "Current Assets",
  LIABILITY: "Current Liabilities",
  EQUITY: "Capital Account",
  INCOME: "Indirect Incomes",
  EXPENSE: "Indirect Expenses",
};

/**
 * Our voucher types in Tally's vocabulary. A return is a note there, and we have no "Expense"
 * voucher type to map to — see `tallyVoucherType` for what happens to those.
 */
export const TALLY_VOUCHER_TYPES: Readonly<Record<string, string>> = {
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  JOURNAL: "Journal",
  CONTRA: "Contra",
  SALES: "Sales",
  PURCHASE: "Purchase",
  SALES_RETURN: "Credit Note",
  PURCHASE_RETURN: "Debit Note",
  EXPENSE: "Journal",
};

/** The groups whose ledgers Tally will not accept inside a Journal voucher. */
export const CASH_BANK_GROUPS: ReadonlySet<string> = new Set([
  "CASH_IN_HAND",
  "BANK_ACCOUNTS",
  "BANK_OD",
]);

/** Ledgers Tally keeps a running bill-by-bill balance for. */
export const BILLWISE_GROUPS: ReadonlySet<string> = new Set(["SUNDRY_DEBTORS", "SUNDRY_CREDITORS"]);

/**
 * Tally rejects a name carrying its own field delimiters, and truncates past 160 characters
 * without telling anyone. Both are cheaper to handle here than to explain later.
 */
export const tallyName = (raw: string): string =>
  raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 160);

/** Tally dates are `YYYYMMDD`, always, everywhere. */
export const tallyDate = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

/** Tally reads amounts to two places and gets upset by exponent notation. */
export const tallyAmount = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
