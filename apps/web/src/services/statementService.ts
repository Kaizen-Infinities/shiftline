import apiClient from "../api/apiClient";
import type { LedgerStatementEntry } from "./accountService";
import type { AgedDocument, BucketTotals } from "./ageingService";

/** Statements of account for customers and suppliers (P1-10c). */
export type StatementPartyType = "customer" | "supplier";

export interface Statement {
  company: {
    name: string;
    gstin: string | null;
    address: string;
    email: string | null;
    phone: string | null;
  };
  party: {
    type: StatementPartyType;
    id: string;
    code: string;
    name: string;
    email: string | null;
    phone: string | null;
    gstin: string | null;
    address: string | null;
  };
  startDate: string | null;
  endDate: string;
  openingBalance: number;
  closingBalance: number;
  entries: LedgerStatementEntry[];
  ageing: {
    buckets: BucketTotals;
    total: number;
    overdue: number;
    interest: number;
    documents: AgedDocument[];
  } | null;
}

export interface StatementPeriod {
  startDate?: string;
  endDate?: string;
}

const clean = (p: StatementPeriod) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ""));

export const statementService = {
  get: async (type: StatementPartyType, id: string, period: StatementPeriod): Promise<Statement> =>
    (await apiClient.get(`/accounts/statements/${type}/${id}`, { params: clean(period) })).data
      .data,

  /** Opens the PDF in a new tab (the access token travels in the header, so no plain link). */
  openPdf: async (type: StatementPartyType, id: string, period: StatementPeriod) => {
    const res = await apiClient.get(`/accounts/statements/${type}/${id}/pdf`, {
      params: clean(period),
      responseType: "blob",
    });
    const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  send: async (
    type: StatementPartyType,
    id: string,
    input: StatementPeriod & { channel: "email" | "whatsapp"; to?: string; message?: string }
  ): Promise<{ channel: string; to: string; filename: string }> =>
    (await apiClient.post(`/accounts/statements/${type}/${id}/send`, input)).data.data,
};
