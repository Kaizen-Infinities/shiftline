import apiClient from "../api/apiClient";
import type { LedgerStatementEntry } from "./accountService";

/** Books of prime entry and the cash flow statement (P1-10b). */
export interface DayBookLine {
  ledgerId: number | null;
  code: string | null;
  name: string | null;
  debit: number;
  credit: number;
  narration: string | null;
}

export interface DayBookVoucher {
  id: number;
  voucherNo: string;
  type: string;
  status: string;
  narration: string | null;
  refDocType: string | null;
  refDocId: string | null;
  total: number;
  lines: DayBookLine[];
}

export interface DayBookDay {
  date: string;
  vouchers: DayBookVoucher[];
  totalDebit: number;
  totalCredit: number;
}

export interface DayBook {
  startDate: string | null;
  endDate: string | null;
  days: DayBookDay[];
  voucherCount: number;
  totalDebit: number;
  totalCredit: number;
  truncated: boolean;
}

export interface BookLedger {
  id: number;
  code: string;
  name: string;
  ledgerGroup: { code: string } | null;
}

export interface BookStatement {
  openingBalance: number;
  closingBalance: number;
  entries: LedgerStatementEntry[];
}

export interface CashBook extends BookStatement {
  ledgers: BookLedger[];
}

export interface BankBook {
  ledgers: BookLedger[];
  statement: BookStatement | null;
}

export interface CashFlowLedgerLine {
  ledgerId: number;
  code: string;
  name: string;
  amount: number;
}

export interface CashFlowGroupLine {
  groupCode: string;
  groupName: string;
  amount: number;
  ledgers: CashFlowLedgerLine[];
}

export interface CashFlowStatement {
  startDate: string;
  endDate: string;
  operating: {
    netProfit: number;
    depreciation: number;
    workingCapital: CashFlowGroupLine[];
    total: number;
  };
  investing: { lines: CashFlowGroupLine[]; total: number };
  financing: { lines: CashFlowGroupLine[]; total: number };
  netChange: number;
  openingCash: number;
  closingCash: number;
  cashLedgers: CashFlowLedgerLine[];
  difference: number;
  reconciles: boolean;
}

export interface BooksParams {
  startDate?: string;
  endDate?: string;
  type?: string;
  includeCancelled?: boolean;
  search?: string;
}

const clean = (o: BooksParams) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== "" && v !== false)
      .map(([k, v]) => [k, String(v)])
  );

export const booksService = {
  dayBook: async (params: BooksParams): Promise<DayBook> =>
    (await apiClient.get("/accounts/day-book", { params: clean(params) })).data.data,
  cashBook: async (params: BooksParams): Promise<CashBook> =>
    (await apiClient.get("/accounts/cash-book", { params: clean(params) })).data.data,
  bankBook: async (ledgerId: number | null, params: BooksParams): Promise<BankBook> =>
    (
      await apiClient.get(ledgerId ? `/accounts/bank-book/${ledgerId}` : "/accounts/bank-book", {
        params: clean(params),
      })
    ).data.data,
  cashFlow: async (startDate: string, endDate: string): Promise<CashFlowStatement> =>
    (await apiClient.get("/accounts/cash-flow", { params: { startDate, endDate } })).data.data,
};

/** First day of the current Indian financial year (1 April). */
export const fyStart = (d = new Date()) => {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
};
export const todayIso = () => new Date().toISOString().slice(0, 10);
