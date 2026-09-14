import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";

/** GST returns computed from the books (P1-13): GSTR-1, 3B, 2B/IMS, GSTR-9 and the calendar. */
export interface TaxAmounts {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}
export interface GstinScopeRow {
  gstin: string;
  name: string;
  stateCode: string;
  businessPlaceId: string | null;
}
export interface FilingRow {
  id: string;
  status: string;
  filingType: string;
  periodKey: string;
  payloadHash: string;
  submissionRef: string | null;
}

export interface Gstr1Return {
  gstin: string;
  periodKey: string;
  fp: string;
  json: Record<string, unknown>;
  totals: {
    invoices: number;
    creditNotes: number;
    taxable: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    total: number;
    byTable: Record<string, { count: number; taxable: number; tax: number }>;
  };
  warnings: string[];
  payloadHash: string;
  filing: FilingRow | null;
}

export interface Gstr3bPaymentRow {
  head: "IGST" | "CGST" | "SGST" | "CESS";
  payable: number;
  paidThroughItc: { igst: number; cgst: number; sgst: number; cess: number };
  cash: number;
}
export interface Gstr3bReturn {
  gstin: string;
  periodKey: string;
  fp: string;
  table31: { a: TaxAmounts; b: TaxAmounts; c: TaxAmounts; d: TaxAmounts; e: TaxAmounts };
  table32: {
    unregistered: { pos: string; taxable: number; igst: number }[];
    composition: { pos: string; taxable: number; igst: number }[];
    uin: { pos: string; taxable: number; igst: number }[];
  };
  table4: {
    available: {
      importGoods: TaxAmounts;
      importServices: TaxAmounts;
      reverseCharge: TaxAmounts;
      isd: TaxAmounts;
      other: TaxAmounts;
      total: TaxAmounts;
    };
    reversed: { rules: TaxAmounts; others: TaxAmounts; total: TaxAmounts };
    net: TaxAmounts;
    other: { reclaimed: TaxAmounts; ineligible: TaxAmounts };
  };
  table61: {
    otherThanReverseCharge: Gstr3bPaymentRow[];
    reverseCharge: Gstr3bPaymentRow[];
    cashPayable: { igst: number; cgst: number; sgst: number; cess: number; total: number };
    creditBalance: { igst: number; cgst: number; sgst: number; cess: number };
  };
  itc: {
    id: string;
    docType: string;
    docNo: string;
    docDate: string;
    supplierGstin: string | null;
    source: string;
    status: string;
    rule: string | null;
    reason: string | null;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  }[];
  warnings: string[];
  payloadHash: string;
  filing: FilingRow | null;
}

export type MatchStatus = "MATCHED" | "MISMATCH" | "MISSING_IN_2B" | "MISSING_IN_BOOKS";
export type ImsStatus = "PENDING" | "ACCEPTED" | "REJECTED";
export interface MismatchField {
  field: string;
  inBooks: number | string;
  inPortal: number | string;
  difference?: number;
}
export interface Gstr2bRecordRow {
  id: string;
  periodKey: string;
  supplierGstin: string;
  supplierName: string | null;
  docType: string;
  docNo: string;
  docDate: string;
  docValue: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  itcAvailable: boolean;
  itcReason: string | null;
  matchStatus: MatchStatus | null;
  matchedDocType: string | null;
  matchedDocId: string | null;
  mismatchFields: MismatchField[] | null;
  imsAction: { status: ImsStatus; reason: string | null; pushedAt: string | null } | null;
  imsStatus?: ImsStatus;
}
export interface Gstr2bSummary {
  periodKey: string;
  gstin: string;
  summary: {
    matched: number;
    mismatch: number;
    missingIn2b: number;
    missingInBooks: number;
    portalCredit: { igst: number; cgst: number; sgst: number; cess: number };
    bookCredit: { igst: number; cgst: number; sgst: number; cess: number };
  };
  records: Gstr2bRecordRow[];
  missingIn2b: {
    docType: string;
    docId: string;
    docNo: string;
    docDate: string;
    taxable: number;
    supplierGstin: string | null;
  }[];
  followUps: LastFollowUp[];
}

export interface Gstr9Return {
  gstin: string;
  fyKey: string;
  months: string[];
  table4: Record<string, TaxAmounts>;
  table5: Record<string, TaxAmounts | number>;
  table6: Record<string, TaxAmounts>;
  table7: Record<string, TaxAmounts>;
  table8: Record<string, TaxAmounts>;
  table9: {
    head: string;
    payable: number;
    paidInCash: number;
    paidThroughItc: { igst: number; cgst: number; sgst: number; cess: number };
  }[];
  table17: { hsn: string; uqc: string; quantity: number; taxable: number; rate: number }[];
  table18: { hsn: string; uqc: string; quantity: number; taxable: number; rate: number }[];
  monthly: { periodKey: string; outputTax: TaxAmounts; netItc: TaxAmounts; cashPaid: number }[];
  warnings: string[];
  payloadHash: string;
  filing: FilingRow | null;
}

export interface Gstr2bSettingsRow {
  dateToleranceDays: number;
  valueTolerance: number;
  /** FIXTURE never reaches a live gateway; LIVE sends through WhatsApp/email for real (P2-18). */
  followUpProvider?: "FIXTURE" | "LIVE";
  /** Days an unfollowed MISSING_IN_2B/MISMATCH record sits before the daily nudge flags it. */
  nudgeAfterDays?: number;
}
export interface FollowUpLine {
  docNo: string;
  docDate: string;
  taxable: number;
  differs: string | null;
}
export interface FollowUpPreview {
  supplierGstin: string;
  supplierName: string | null;
  message: string;
  lines: FollowUpLine[];
}
export interface FollowUpRow {
  id: string;
  supplierGstin: string;
  supplierName: string | null;
  channel: "WHATSAPP" | "EMAIL";
  recipient: string;
  status: "SENT" | "FAILED";
  sentAt: string;
}
export interface LastFollowUp {
  supplierGstin: string;
  channel: "WHATSAPP" | "EMAIL";
  status: "SENT" | "FAILED";
  sentAt: string;
  recipient: string;
}

export interface ComplianceDue {
  filingType: string;
  name: string;
  authority: string;
  cadence: string;
  periodKey: string;
  dueDate: string;
  daysLeft: number;
  status: "NOT_STARTED" | "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "SUBMITTED";
  filingId: string | null;
  overdue: boolean;
}

const p = API_PATHS.gstReturns;
const get = async <T>(path: string, params?: Record<string, unknown>): Promise<T> =>
  (await apiClient.get(path, { params })).data.data;
const post = async <T>(path: string, body: Record<string, unknown>): Promise<T> =>
  (await apiClient.post(path, body)).data.data;

export const gstReturnsService = {
  gstins: () => get<GstinScopeRow[]>(p.gstins),

  gstr1: (period: string, gstin?: string) => get<Gstr1Return>(p.gstr1, { period, gstin }),
  gstr1Register: (period: string, gstin?: string) =>
    post<Gstr1Return>(`${p.gstr1}/register`, { period, gstin }),
  gstr1Filed: (period: string, gstin: string | undefined, submissionRef: string | null) =>
    post<Gstr1Return>(`${p.gstr1}/filed`, { period, gstin, submissionRef }),
  /** The portal's offline JSON, downloaded through the browser. */
  gstr1JsonUrl: (period: string, gstin?: string) =>
    `${p.gstr1}/json?period=${encodeURIComponent(period)}${gstin ? `&gstin=${gstin}` : ""}`,

  gstr3b: (period: string, gstin?: string) => get<Gstr3bReturn>(p.gstr3b, { period, gstin }),
  gstr3bRegister: (period: string, gstin?: string) =>
    post<Gstr3bReturn>(`${p.gstr3b}/register`, { period, gstin }),
  gstr3bFiled: (period: string, gstin: string | undefined, submissionRef: string | null) =>
    post<Gstr3bReturn>(`${p.gstr3b}/filed`, { period, gstin, submissionRef }),

  gstr2b: (period: string, gstin?: string, status?: MatchStatus) =>
    get<Gstr2bRecordRow[]>(p.gstr2b, { period, gstin, status }),
  gstr2bSummary: (period: string, gstin?: string) =>
    get<Gstr2bSummary>(p.gstr2bSummary, { period, gstin }),
  gstr2bImport: (period: string, gstin: string | undefined, json: unknown) =>
    post<Gstr2bSummary>(p.gstr2bImport, { period, gstin, json }),
  gstr2bPull: (period: string, gstin?: string) =>
    post<Gstr2bSummary>(p.gstr2bPull, { period, gstin }),

  ims: (period: string, gstin?: string, status?: ImsStatus) =>
    get<Gstr2bRecordRow[]>(p.ims, { period, gstin, status }),
  imsPending: (period: string, gstin?: string) =>
    get<{ pending: number; credit: TaxAmounts }>(p.imsPending, { period, gstin }),
  imsAct: (id: string, status: ImsStatus, reason?: string | null) =>
    post(`${p.ims}/${id}/act`, { status, reason }),
  imsRule: (period: string, gstin: string | undefined, rule: string) =>
    post<{ decided: number }>(p.imsRule, { period, gstin, rule }),
  imsRegister: (period: string, gstin?: string) =>
    post<FilingRow>(p.imsRegister, { period, gstin }),
  imsPush: (period: string, gstin?: string) =>
    post<{ pushed: number; reference: string }>(p.imsPush, { period, gstin }),

  gstr9: (fy: string, gstin?: string) => get<Gstr9Return>(p.gstr9, { fy, gstin }),
  gstr9Register: (fy: string, gstin?: string) =>
    post<Gstr9Return>(`${p.gstr9}/register`, { fy, gstin }),

  calendar: () => get<ComplianceDue[]>(p.calendar),

  gstr2bSettings: () => get<Gstr2bSettingsRow>(p.gstr2bSettings),
  gstr2bSettingsUpdate: (input: Gstr2bSettingsRow) =>
    (async () => (await apiClient.put(p.gstr2bSettings, input)).data.data as Gstr2bSettingsRow)(),

  gstr2bFollowUpPreview: (
    period: string,
    body: {
      gstin?: string;
      supplierId?: number;
      supplierGstin?: string;
      channel: "WHATSAPP" | "EMAIL";
      recordIds: string[];
    }
  ) => post<FollowUpPreview>(`${p.gstr2bFollowUpBase}/${period}/follow-up/preview`, body),
  gstr2bFollowUp: (
    period: string,
    body: {
      gstin?: string;
      supplierId?: number;
      supplierGstin?: string;
      channel: "WHATSAPP" | "EMAIL";
      recordIds: string[];
    }
  ) => post<FollowUpRow>(`${p.gstr2bFollowUpBase}/${period}/follow-up`, body),
};
