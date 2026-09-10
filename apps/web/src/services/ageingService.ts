import apiClient from "../api/apiClient";

/** Receivable and payable ageing (P1-10): unpaid balances by days past due. */
export type AgeingBucket = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90_plus";

export const AGEING_BUCKET_LABELS: Record<AgeingBucket, string> = {
  notDue: "Not due",
  d0_30: "0–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90_plus: "90+",
};

export type BucketTotals = Record<AgeingBucket, number>;

export interface AgedDocument {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  amount: number;
  paid: number;
  balance: number;
  daysOverdue: number;
  bucket: AgeingBucket;
  interest: number;
}

export interface AgeingRow {
  partyId: string;
  code: string;
  name: string;
  phone: string | null;
  creditDays: number | null;
  interestRate: number | null;
  buckets: BucketTotals;
  total: number;
  overdue: number;
  interest: number;
  oldestDueDate: string | null;
  documents?: AgedDocument[];
}

export interface AgeingReport {
  asOnDate: string;
  buckets: AgeingBucket[];
  rows: AgeingRow[];
  totals: BucketTotals & { total: number; overdue: number; interest: number };
}

export interface AgeingParams {
  asOnDate?: string;
  partyId?: string;
  search?: string;
}

const clean = (o: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));

export const ageingService = {
  receivable: async (p: AgeingParams): Promise<AgeingReport> =>
    (
      await apiClient.get("/accounts/receivable/ageing", {
        params: clean({ asOnDate: p.asOnDate, customerId: p.partyId, search: p.search }),
      })
    ).data.data as AgeingReport,

  payable: async (p: AgeingParams): Promise<AgeingReport> =>
    (
      await apiClient.get("/accounts/payable/ageing", {
        params: clean({ asOnDate: p.asOnDate, supplierId: p.partyId, search: p.search }),
      })
    ).data.data as AgeingReport,
};
