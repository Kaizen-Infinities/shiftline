/**
 * The standard chart-of-accounts tree (P1-09c): Tally-style primary groups under each
 * nature, each mapped to the Schedule III line it rolls up to. Seeded per tenant by
 * `ledgerGroupService.ensureLedgerGroups()`; a tenant may add custom groups beneath.
 */
import { LedgerType } from "@prisma/client";

export interface StandardLedgerGroup {
  code: string;
  name: string;
  nature: LedgerType;
  parent?: string;
  scheduleHead: string;
}

export const SCHEDULE_III = {
  // Equity and liabilities
  SHARE_CAPITAL: "Share capital",
  RESERVES: "Reserves and surplus",
  LT_BORROWINGS: "Long-term borrowings",
  ST_BORROWINGS: "Short-term borrowings",
  TRADE_PAYABLES: "Trade payables",
  OTHER_CL: "Other current liabilities",
  ST_PROVISIONS: "Short-term provisions",
  // Assets
  PPE: "Property, plant and equipment",
  NC_INVESTMENTS: "Non-current investments",
  OTHER_NCA: "Other non-current assets",
  INVENTORIES: "Inventories",
  TRADE_RECEIVABLES: "Trade receivables",
  CASH: "Cash and cash equivalents",
  ST_LOANS: "Short-term loans and advances",
  OTHER_CA: "Other current assets",
  // Statement of profit and loss
  REVENUE: "Revenue from operations",
  OTHER_INCOME: "Other income",
  MATERIALS: "Cost of materials consumed",
  EMPLOYEE: "Employee benefits expense",
  FINANCE: "Finance costs",
  DEPRECIATION: "Depreciation and amortisation expense",
  OTHER_EXPENSES: "Other expenses",
} as const;

const A = LedgerType.ASSET;
const L = LedgerType.LIABILITY;
const Q = LedgerType.EQUITY;
const I = LedgerType.INCOME;
const E = LedgerType.EXPENSE;

/** Order here is the display order within a nature. */
export const STANDARD_LEDGER_GROUPS: StandardLedgerGroup[] = [
  { code: "FIXED_ASSETS", name: "Fixed Assets", nature: A, scheduleHead: SCHEDULE_III.PPE },
  {
    code: "INVESTMENTS",
    name: "Investments",
    nature: A,
    scheduleHead: SCHEDULE_III.NC_INVESTMENTS,
  },
  {
    code: "CURRENT_ASSETS",
    name: "Current Assets",
    nature: A,
    scheduleHead: SCHEDULE_III.OTHER_CA,
  },
  {
    code: "CASH_IN_HAND",
    name: "Cash in Hand",
    nature: A,
    parent: "CURRENT_ASSETS",
    scheduleHead: SCHEDULE_III.CASH,
  },
  {
    code: "BANK_ACCOUNTS",
    name: "Bank Accounts",
    nature: A,
    parent: "CURRENT_ASSETS",
    scheduleHead: SCHEDULE_III.CASH,
  },
  {
    code: "SUNDRY_DEBTORS",
    name: "Sundry Debtors",
    nature: A,
    parent: "CURRENT_ASSETS",
    scheduleHead: SCHEDULE_III.TRADE_RECEIVABLES,
  },
  {
    code: "STOCK_IN_HAND",
    name: "Stock-in-Hand",
    nature: A,
    parent: "CURRENT_ASSETS",
    scheduleHead: SCHEDULE_III.INVENTORIES,
  },
  {
    code: "LOANS_ADVANCES_ASSET",
    name: "Loans & Advances (Asset)",
    nature: A,
    parent: "CURRENT_ASSETS",
    scheduleHead: SCHEDULE_III.ST_LOANS,
  },
  {
    code: "DEPOSITS_ASSET",
    name: "Deposits (Asset)",
    nature: A,
    parent: "CURRENT_ASSETS",
    scheduleHead: SCHEDULE_III.OTHER_CA,
  },
  {
    code: "TAX_ASSETS",
    name: "Tax Assets (Input Credit)",
    nature: A,
    parent: "CURRENT_ASSETS",
    scheduleHead: SCHEDULE_III.OTHER_CA,
  },
  {
    code: "OTHER_CURRENT_ASSETS",
    name: "Other Current Assets",
    nature: A,
    parent: "CURRENT_ASSETS",
    scheduleHead: SCHEDULE_III.OTHER_CA,
  },
  {
    code: "MISC_EXPENSES_ASSET",
    name: "Misc. Expenses (Asset)",
    nature: A,
    scheduleHead: SCHEDULE_III.OTHER_NCA,
  },

  {
    code: "LOANS_LIABILITY",
    name: "Loans (Liability)",
    nature: L,
    scheduleHead: SCHEDULE_III.LT_BORROWINGS,
  },
  {
    code: "SECURED_LOANS",
    name: "Secured Loans",
    nature: L,
    parent: "LOANS_LIABILITY",
    scheduleHead: SCHEDULE_III.LT_BORROWINGS,
  },
  {
    code: "UNSECURED_LOANS",
    name: "Unsecured Loans",
    nature: L,
    parent: "LOANS_LIABILITY",
    scheduleHead: SCHEDULE_III.LT_BORROWINGS,
  },
  {
    code: "BANK_OD",
    name: "Bank OD A/c",
    nature: L,
    parent: "LOANS_LIABILITY",
    scheduleHead: SCHEDULE_III.ST_BORROWINGS,
  },
  {
    code: "CURRENT_LIABILITIES",
    name: "Current Liabilities",
    nature: L,
    scheduleHead: SCHEDULE_III.OTHER_CL,
  },
  {
    code: "SUNDRY_CREDITORS",
    name: "Sundry Creditors",
    nature: L,
    parent: "CURRENT_LIABILITIES",
    scheduleHead: SCHEDULE_III.TRADE_PAYABLES,
  },
  {
    code: "TAX_LIABILITIES",
    name: "Duties & Taxes",
    nature: L,
    parent: "CURRENT_LIABILITIES",
    scheduleHead: SCHEDULE_III.OTHER_CL,
  },
  {
    code: "PROVISIONS",
    name: "Provisions",
    nature: L,
    parent: "CURRENT_LIABILITIES",
    scheduleHead: SCHEDULE_III.ST_PROVISIONS,
  },
  {
    code: "OTHER_CURRENT_LIABILITIES",
    name: "Other Current Liabilities",
    nature: L,
    parent: "CURRENT_LIABILITIES",
    scheduleHead: SCHEDULE_III.OTHER_CL,
  },
  { code: "SUSPENSE", name: "Suspense A/c", nature: L, scheduleHead: SCHEDULE_III.OTHER_CL },

  { code: "CAPITAL", name: "Capital Account", nature: Q, scheduleHead: SCHEDULE_III.SHARE_CAPITAL },
  {
    code: "RESERVES_SURPLUS",
    name: "Reserves & Surplus",
    nature: Q,
    scheduleHead: SCHEDULE_III.RESERVES,
  },

  { code: "SALES_ACCOUNTS", name: "Sales Accounts", nature: I, scheduleHead: SCHEDULE_III.REVENUE },
  { code: "DIRECT_INCOME", name: "Direct Income", nature: I, scheduleHead: SCHEDULE_III.REVENUE },
  {
    code: "INDIRECT_INCOME",
    name: "Indirect Income",
    nature: I,
    scheduleHead: SCHEDULE_III.OTHER_INCOME,
  },

  {
    code: "PURCHASE_ACCOUNTS",
    name: "Purchase Accounts",
    nature: E,
    scheduleHead: SCHEDULE_III.MATERIALS,
  },
  {
    code: "DIRECT_EXPENSES",
    name: "Direct Expenses",
    nature: E,
    scheduleHead: SCHEDULE_III.MATERIALS,
  },
  {
    code: "INDIRECT_EXPENSES",
    name: "Indirect Expenses",
    nature: E,
    scheduleHead: SCHEDULE_III.OTHER_EXPENSES,
  },
  {
    code: "EMPLOYEE_COSTS",
    name: "Employee Benefits",
    nature: E,
    scheduleHead: SCHEDULE_III.EMPLOYEE,
  },
  { code: "FINANCE_COSTS", name: "Finance Costs", nature: E, scheduleHead: SCHEDULE_III.FINANCE },
  {
    code: "DEPRECIATION",
    name: "Depreciation & Amortisation",
    nature: E,
    scheduleHead: SCHEDULE_III.DEPRECIATION,
  },
];

/** Group codes the system ledgers belong to (overrides the free-text `group`). */
export const SYSTEM_LEDGER_GROUPS: Record<string, string> = {
  "CASH-001": "CASH_IN_HAND",
  "PCASH-001": "CASH_IN_HAND",
  "BANK-001": "BANK_ACCOUNTS",
  "DEBT-001": "SUNDRY_DEBTORS",
  "CRED-001": "SUNDRY_CREDITORS",
  "PURCH-001": "PURCHASE_ACCOUNTS",
  "PRT-001": "PURCHASE_ACCOUNTS",
  "SALES-001": "SALES_ACCOUNTS",
  "SRT-001": "SALES_ACCOUNTS",
  "EXP-001": "INDIRECT_EXPENSES",
  // P1-18: accumulated depreciation is a negative asset, so it sits beside the asset it reduces
  // rather than under a liability head; the balance sheet nets the two.
  "FA-001": "FIXED_ASSETS",
  "FA-ACC-001": "FIXED_ASSETS",
  "DEP-001": "DEPRECIATION",
  "ASSET-PL-001": "INDIRECT_INCOME",
  "FX-GAIN-001": "INDIRECT_INCOME",
  "FX-LOSS-001": "INDIRECT_EXPENSES",
  "CUSTOMS-PAY-001": "OTHER_CURRENT_LIABILITIES",
  "STOCK-001": "STOCK_IN_HAND",
  "STOCK-CHG-001": "DIRECT_EXPENSES",
  "EQ-001": "CAPITAL",
  "EQ-002": "RESERVES_SURPLUS",
  "CGST-LIA-001": "TAX_LIABILITIES",
  "SGST-LIA-001": "TAX_LIABILITIES",
  "IGST-LIA-001": "TAX_LIABILITIES",
  "RCM-LIA-001": "TAX_LIABILITIES",
  "CESS-LIA-001": "TAX_LIABILITIES",
  "TDS-LIA-001": "TAX_LIABILITIES",
  "CGST-REC-001": "TAX_ASSETS",
  "SGST-REC-001": "TAX_ASSETS",
  "IGST-REC-001": "TAX_ASSETS",
  "RCM-REC-001": "TAX_ASSETS",
  "CESS-REC-001": "TAX_ASSETS",
};

const FALLBACK_BY_NATURE: Record<LedgerType, string> = {
  ASSET: "OTHER_CURRENT_ASSETS",
  LIABILITY: "OTHER_CURRENT_LIABILITIES",
  EQUITY: "CAPITAL",
  INCOME: "INDIRECT_INCOME",
  EXPENSE: "INDIRECT_EXPENSES",
};

/** Where a ledger with only a free-text `group` belongs in the tree. */
export const legacyGroupCode = (ledger: {
  code: string;
  type: LedgerType;
  group?: string | null;
  customerId?: string | null;
  supplierId?: number | null;
}): string => {
  const system = SYSTEM_LEDGER_GROUPS[ledger.code];
  if (system) return system;
  if (ledger.customerId) return "SUNDRY_DEBTORS";
  if (ledger.supplierId) return "SUNDRY_CREDITORS";
  const g = (ledger.group ?? "").trim().toLowerCase();
  const byName = STANDARD_LEDGER_GROUPS.find(
    (s) => s.name.toLowerCase() === g && s.nature === ledger.type
  );
  if (byName) return byName.code;
  const has = (...words: string[]) => words.some((w) => g.includes(w));
  if (ledger.type === "ASSET") {
    if (has("petty", "cash")) return has("bank") ? "BANK_ACCOUNTS" : "CASH_IN_HAND";
    if (has("bank")) return "BANK_ACCOUNTS";
    if (has("debtor", "receivable")) return "SUNDRY_DEBTORS";
    if (has("stock", "inventor")) return "STOCK_IN_HAND";
    if (has("fixed", "plant", "machinery", "vehicle", "furniture", "building"))
      return "FIXED_ASSETS";
    if (has("invest")) return "INVESTMENTS";
    if (has("loan", "advance")) return "LOANS_ADVANCES_ASSET";
    if (has("deposit")) return "DEPOSITS_ASSET";
    if (has("tax", "gst", "tds", "input")) return "TAX_ASSETS";
    if (has("current")) return "OTHER_CURRENT_ASSETS";
  }
  if (ledger.type === "LIABILITY") {
    if (has("creditor", "payable") && !has("tax")) return "SUNDRY_CREDITORS";
    if (has("tax", "gst", "tds", "dut")) return "TAX_LIABILITIES";
    if (has("provision")) return "PROVISIONS";
    if (has("secured") && !has("unsecured")) return "SECURED_LOANS";
    if (has("unsecured")) return "UNSECURED_LOANS";
    if (has("overdraft", " od")) return "BANK_OD";
    if (has("loan")) return "LOANS_LIABILITY";
    if (has("suspense")) return "SUSPENSE";
  }
  if (ledger.type === "EQUITY") {
    if (has("reserve", "surplus", "retained")) return "RESERVES_SURPLUS";
    return "CAPITAL";
  }
  if (ledger.type === "INCOME") {
    if (has("sales")) return "SALES_ACCOUNTS";
    if (has("direct")) return "SALES_ACCOUNTS";
  }
  if (ledger.type === "EXPENSE") {
    if (has("purchase")) return "PURCHASE_ACCOUNTS";
    if (has("direct")) return "DIRECT_EXPENSES";
    if (has("salar", "wage", "employee", "staff", "payroll")) return "EMPLOYEE_COSTS";
    if (has("interest", "finance", "bank charge")) return "FINANCE_COSTS";
    if (has("depreciation", "amortis")) return "DEPRECIATION";
  }
  return FALLBACK_BY_NATURE[ledger.type];
};

/** Schedule III presentation order for the balance sheet. */
export const BALANCE_SHEET_LAYOUT = {
  equityAndLiabilities: [
    { section: "Shareholders' funds", heads: [SCHEDULE_III.SHARE_CAPITAL, SCHEDULE_III.RESERVES] },
    { section: "Non-current liabilities", heads: [SCHEDULE_III.LT_BORROWINGS] },
    {
      section: "Current liabilities",
      heads: [
        SCHEDULE_III.ST_BORROWINGS,
        SCHEDULE_III.TRADE_PAYABLES,
        SCHEDULE_III.OTHER_CL,
        SCHEDULE_III.ST_PROVISIONS,
      ],
    },
  ],
  assets: [
    {
      section: "Non-current assets",
      heads: [SCHEDULE_III.PPE, SCHEDULE_III.NC_INVESTMENTS, SCHEDULE_III.OTHER_NCA],
    },
    {
      section: "Current assets",
      heads: [
        SCHEDULE_III.INVENTORIES,
        SCHEDULE_III.TRADE_RECEIVABLES,
        SCHEDULE_III.CASH,
        SCHEDULE_III.ST_LOANS,
        SCHEDULE_III.OTHER_CA,
      ],
    },
  ],
} as const;

/** Schedule III presentation order for the statement of profit and loss. */
export const PROFIT_AND_LOSS_LAYOUT = {
  income: [SCHEDULE_III.REVENUE, SCHEDULE_III.OTHER_INCOME],
  expenses: [
    SCHEDULE_III.MATERIALS,
    SCHEDULE_III.EMPLOYEE,
    SCHEDULE_III.FINANCE,
    SCHEDULE_III.DEPRECIATION,
    SCHEDULE_III.OTHER_EXPENSES,
  ],
} as const;
