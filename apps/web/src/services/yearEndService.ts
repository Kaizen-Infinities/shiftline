import apiClient from "../api/apiClient";
import config from "../api/config";

/** Year-end closing (P1-09e) and the freeze date it moves. */
export interface ClosingLine {
  ledgerId: number;
  code: string;
  name: string;
  type: "INCOME" | "EXPENSE" | "EQUITY";
  side: "DEBIT" | "CREDIT";
  amount: number;
}

export type YearEndStatus = "PREPARED" | "APPROVED" | "REVERSED" | "DISCARDED";

export interface YearEndClosing {
  id: number;
  fyCode: string;
  fyStart: string;
  fyEnd: string;
  status: YearEndStatus;
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  lines: ClosingLine[];
  notes: string | null;
  preparedBy: string | null;
  preparedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
  closingVoucher: { id: number; voucherNo: string; status: string; date: string } | null;
}

export interface YearEndPreview {
  fy: { code: string; start: string; end: string; periodName: string };
  lines: ClosingLine[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  retainedEarnings: { id: number; code: string; name: string };
  payloadHash: string;
  existing: YearEndClosing | null;
  stale: boolean;
  blockers: string[];
  canPrepare: boolean;
}

export interface PeriodControl {
  booksFrozenUpTo: string | null;
  periods: {
    id: number;
    periodName: string;
    startDate: string;
    endDate: string;
    isClosed: boolean;
  }[];
  roles: { id: number; code: string; name: string; backdateDays: number | null }[];
}

/** The financial year that ended most recently, as `YYYY-YY`. */
export const previousFyCode = (today = new Date()): string => {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const prev = y - 1;
  return `${prev}-${String((prev + 1) % 100).padStart(2, "0")}`;
};

export const yearEndService = {
  list: async (): Promise<YearEndClosing[]> =>
    (await apiClient.get(config.yearEnd.base)).data.data as YearEndClosing[],

  preview: async (fyCode: string): Promise<YearEndPreview> =>
    (await apiClient.get(config.yearEnd.preview, { params: { fyCode } })).data
      .data as YearEndPreview,

  prepare: async (fyCode: string, notes?: string): Promise<YearEndClosing> =>
    (await apiClient.post(config.yearEnd.prepare, { fyCode, notes: notes || null })).data
      .data as YearEndClosing,

  approve: async (id: number): Promise<YearEndClosing> =>
    (await apiClient.post(`${config.yearEnd.base}/${id}/approve`)).data.data as YearEndClosing,

  reverse: async (id: number, reason: string): Promise<YearEndClosing> =>
    (await apiClient.post(`${config.yearEnd.base}/${id}/reverse`, { reason })).data
      .data as YearEndClosing,

  discard: async (id: number): Promise<YearEndClosing> =>
    (await apiClient.post(`${config.yearEnd.base}/${id}/discard`)).data.data as YearEndClosing,

  periodControl: async (): Promise<PeriodControl> =>
    (await apiClient.get(config.yearEnd.periodControl)).data.data as PeriodControl,

  setFreezeDate: async (
    booksFrozenUpTo: string | null,
    allowBack = false
  ): Promise<{ booksFrozenUpTo: string | null }> =>
    (await apiClient.put(config.yearEnd.periodControl, { booksFrozenUpTo, allowBack })).data
      .data as { booksFrozenUpTo: string | null },
};
