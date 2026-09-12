import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Bank reconciliation and cheques (P1-20). */
export type StatementFormat = "HDFC" | "ICICI" | "SBI" | "AXIS" | "KOTAK" | "GENERIC";
export type ChequeKind = "RECEIVED" | "ISSUED";
export type ChequeStatus = "IN_HAND" | "DEPOSITED" | "CLEARED" | "BOUNCED" | "CANCELLED";

export interface StatementRow {
  id: string;
  format: string;
  fileName: string | null;
  fromDate: string;
  toDate: string;
  openingBalance: string;
  closingBalance: string;
  rowCount: number;
  duplicateCount: number;
  bankAccount?: { bankName: string; accountNumber: string | null };
}

export interface StatementLineRow {
  id: string;
  txnDate: string;
  description: string;
  refNo: string | null;
  debit: string;
  credit: string;
  runningBalance: string | null;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  matchedVoucherId: number | null;
  matchConfidence: number | null;
  notes: string | null;
}

export interface MatchCandidate {
  voucherId: number;
  voucherNo: string;
  date: string;
  amount: number;
  narration: string | null;
  confidence: number;
  why: string[];
}

export interface Brs {
  asOn: string;
  bookBalance: number;
  bankBalance: number | null;
  reconcilingItems: {
    chequesIssuedNotPresented: number;
    depositsNotYetCredited: number;
    chargesNotInBooks: number;
    creditsNotInBooks: number;
  };
  reconciledBalance: number;
  difference: number | null;
  unmatchedLines: number;
}

export interface ChequeRow {
  id: string;
  kind: ChequeKind;
  chequeNo: string;
  chequeDate: string;
  bankName: string | null;
  partyName: string | null;
  amount: string;
  status: ChequeStatus;
  depositedOn: string | null;
  clearedOn: string | null;
  bouncedOn: string | null;
  bounceCharges: string;
  bounceReason: string | null;
}

const p = API_PATHS.banking;

export const bankingService = {
  statements: async (bankAccountId?: string): Promise<StatementRow[]> =>
    (await apiClient.get(p.statements, { params: { bankAccountId } })).data.data,
  importStatement: async (body: {
    bankAccountId: string;
    format: StatementFormat;
    csv: string;
    fileName?: string;
  }) =>
    (await apiClient.post(`${p.statements}/import`, body)).data.data as StatementRow & {
      read: number;
      imported: number;
      skippedAsDuplicates: number;
    },
  lines: async (q: { bankAccountId?: string; status?: string } = {}): Promise<StatementLineRow[]> =>
    (await apiClient.get(p.lines, { params: q })).data.data,
  candidates: async (lineId: string): Promise<MatchCandidate[]> =>
    (await apiClient.get(`${p.lines}/${lineId}/candidates`)).data.data,
  match: async (lineId: string, voucherId: number) =>
    (await apiClient.post(`${p.lines}/${lineId}/match`, { voucherId })).data.data,
  unmatch: async (lineId: string) =>
    (await apiClient.post(`${p.lines}/${lineId}/unmatch`)).data.data,
  ignore: async (lineId: string, note: string) =>
    (await apiClient.post(`${p.lines}/${lineId}/ignore`, { note })).data.data,
  autoMatch: async (bankAccountId: string) =>
    (await apiClient.post(p.autoMatch, { bankAccountId })).data.data as {
      considered: number;
      matched: number;
      leftForAPerson: number;
    },
  brs: async (bankAccountId: string, asOn?: string): Promise<Brs> =>
    (await apiClient.get(p.brs, { params: { bankAccountId, asOn } })).data.data,
  cheques: async (q: { kind?: ChequeKind; status?: ChequeStatus } = {}): Promise<ChequeRow[]> =>
    (await apiClient.get(p.cheques, { params: q })).data.data,
  addCheque: async (body: {
    kind: ChequeKind;
    chequeNo: string;
    chequeDate: string;
    amount: number;
    partyName?: string | null;
    bankName?: string | null;
    bankAccountId?: string | null;
  }): Promise<ChequeRow> => (await apiClient.post(p.cheques, body)).data.data,
  setChequeStatus: async (
    id: string,
    body: {
      status: "DEPOSITED" | "CLEARED" | "BOUNCED" | "CANCELLED";
      on?: string;
      bounceCharges?: number;
      bounceReason?: string;
    }
  ): Promise<ChequeRow> => (await apiClient.post(`${p.cheques}/${id}/status`, body)).data.data,
};
