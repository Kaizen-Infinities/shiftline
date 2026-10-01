import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Subsidies and scheme claims (TN-10). */
export type SchemeKind =
  | "CAPITAL_SUBSIDY"
  | "POWER_SUBSIDY_LTPT"
  | "INTEREST_SUBVENTION"
  | "NEEDS"
  | "PLI"
  | "STATE_OTHER"
  | "CENTRAL_OTHER";
export type SchemeStatus = "APPLIED" | "SANCTIONED" | "ACTIVE" | "CLOSED" | "REJECTED";
export type ClaimStatus = "DRAFT" | "FILED" | "APPROVED" | "DISBURSED" | "REJECTED";
export type LtptMonthState = "UPCOMING" | "DUE" | "MISSED" | "CLAIMED" | "RECEIVED";

export interface CapitalDetails {
  eligiblePlantMachinery: number;
  ratePct: number;
  extraPct?: number | null;
  cap?: number | null;
}
export interface LtptDetails {
  startMonth: string;
  months: number;
  ratePct: number;
  monthlyBaseTariff: number;
  tariffByMonth?: Record<string, number> | null;
  claimWindowDays?: number | null;
}
export interface InterestDetails {
  loanAccountRef: string;
  lender?: string | null;
  sanctionedLoan: number;
  subventionPct: number;
  annualCap?: number | null;
  balances?: { from: string; principal: number }[] | null;
}
export type SchemeDetails = CapitalDetails | LtptDetails | InterestDetails | null;

export interface ClaimTotals {
  sanctioned: number | null;
  claimed: number;
  drafted: number;
  disbursed: number;
  pending: number;
  rejected: number;
  shortfall: number;
  unclaimed: number | null;
}

export interface SubsidyScheme {
  id: string;
  schemeCode: string;
  kind: SchemeKind;
  kindLabel: string;
  name: string;
  authority: string | null;
  sanctionOrderNo: string | null;
  sanctionDate: string | null;
  sanctionedAmount: number | null;
  eligibilityNotes: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: SchemeStatus;
  nextStatuses: SchemeStatus[];
  takesClaims: boolean;
  details: SchemeDetails;
  expected: number | null;
  totals: ClaimTotals;
  claimCount: number;
  ltptDueMonths: number;
  ltptMissedMonths: number;
  verifyNote: string;
  updatedAt: string;
}

export interface SubsidyClaim {
  id: string;
  schemeId: string;
  claimNo: string;
  periodFrom: string;
  periodTo: string;
  amountClaimed: number;
  status: ClaimStatus;
  nextStatuses: ClaimStatus[];
  filedOn: string | null;
  referenceNo: string | null;
  approvedOn: string | null;
  approvedAmount: number | null;
  disbursedAmount: number | null;
  disbursedOn: string | null;
  bankRef: string | null;
  rejectionReason: string | null;
  notes: string | null;
  daysPending: number | null;
  createdAt: string;
}

export interface LtptMonth {
  month: string;
  index: number;
  from: string;
  to: string;
  tariff: number;
  entitlement: number;
  state: LtptMonthState;
  claimNo: string | null;
  claimStatus: ClaimStatus | null;
  claimBy: string | null;
}

export type SchemeCalc =
  | { type: "CAPITAL"; effectivePct: number; gross: number; entitlement: number; capped: boolean }
  | {
      type: "LTPT";
      months: LtptMonth[];
      firstMonth: string;
      lastMonth: string;
      totals: {
        entitlement: number;
        claimed: number;
        received: number;
        due: number;
        missed: number;
        upcoming: number;
        dueMonths: number;
        missedMonths: number;
      };
    }
  | {
      type: "INTEREST";
      fyFrom: string;
      fyToDate: {
        days: number;
        averagePrincipal: number;
        gross: number;
        amount: number;
        capped: boolean;
      };
      fullYearAtSanction: number;
    }
  | null;

export interface SubsidySchemeDetail extends SubsidyScheme {
  calc: SchemeCalc;
  claims: SubsidyClaim[];
}

export interface SubsidySummary {
  asOf: string;
  schemes: number;
  sanctioned: number;
  claimed: number;
  drafted: number;
  received: number;
  pending: number;
  rejected: number;
  shortfall: number;
  byStatus: Partial<Record<SchemeStatus, number>>;
  byKind: Partial<Record<SchemeKind, number>>;
  reminderCount: number;
  defaults: {
    CAPITAL_SUBSIDY: { ratePct: number; extraPct: number; cap: number };
    POWER_SUBSIDY_LTPT: { ratePct: number; months: number };
    INTEREST_SUBVENTION: { subventionPct: number };
  };
  verifyNote: string;
}

export interface SubsidyReminder {
  type: "LTPT_DUE" | "LTPT_MISSED" | "PENDING_DISBURSEMENT" | "EXPIRING";
  severity: "warning" | "danger" | "info";
  schemeId: string;
  schemeCode: string;
  schemeName: string;
  message: string;
  amount: number | null;
  months?: string[];
  claimId?: string;
  claimNo?: string;
  days?: number;
}

export interface SchemeInput {
  schemeCode?: string;
  kind?: SchemeKind;
  name?: string;
  authority?: string | null;
  sanctionOrderNo?: string | null;
  sanctionDate?: string | null;
  sanctionedAmount?: number | null;
  eligibilityNotes?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  status?: "APPLIED" | "SANCTIONED" | "ACTIVE";
  details?: SchemeDetails;
}

export interface ClaimInput {
  claimNo?: string;
  periodFrom: string;
  periodTo: string;
  amountClaimed: number;
  notes?: string | null;
}

export interface ClaimStatusChange {
  status: ClaimStatus;
  filedOn?: string;
  referenceNo?: string;
  approvedOn?: string;
  approvedAmount?: number;
  disbursedAmount?: number;
  disbursedOn?: string;
  bankRef?: string;
  rejectionReason?: string;
}

const p = API_PATHS.subsidySchemes;

export const subsidySchemesService = {
  summary: async (): Promise<SubsidySummary> => (await apiClient.get(p.summary)).data.data,

  reminders: async (): Promise<{ asOf: string; items: SubsidyReminder[] }> =>
    (await apiClient.get(p.reminders)).data.data,

  list: async (
    params: { status?: SchemeStatus; kind?: SchemeKind } = {}
  ): Promise<SubsidyScheme[]> => (await apiClient.get(p.base, { params })).data.data,

  get: async (id: string): Promise<SubsidySchemeDetail> =>
    (await apiClient.get(`${p.base}/${id}`)).data.data,

  create: async (body: SchemeInput): Promise<SubsidySchemeDetail> =>
    (await apiClient.post(p.base, body)).data.data,

  update: async (id: string, body: SchemeInput): Promise<SubsidySchemeDetail> =>
    (await apiClient.patch(`${p.base}/${id}`, body)).data.data,

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`${p.base}/${id}`);
  },

  setStatus: async (
    id: string,
    body: {
      status: SchemeStatus;
      sanctionOrderNo?: string;
      sanctionDate?: string;
      sanctionedAmount?: number;
    }
  ): Promise<SubsidySchemeDetail> =>
    (await apiClient.patch(`${p.base}/${id}/status`, body)).data.data,

  entitlement: async (
    id: string,
    from: string,
    to: string
  ): Promise<{ amount: number | null; basis: string; months?: string[] }> =>
    (await apiClient.get(`${p.base}/${id}/entitlement`, { params: { from, to } })).data.data,

  createClaim: async (id: string, body: ClaimInput): Promise<SubsidySchemeDetail> =>
    (await apiClient.post(`${p.base}/${id}/claims`, body)).data.data,

  updateClaim: async (
    id: string,
    claimId: string,
    body: Partial<ClaimInput>
  ): Promise<SubsidySchemeDetail> =>
    (await apiClient.patch(`${p.base}/${id}/claims/${claimId}`, body)).data.data,

  setClaimStatus: async (
    id: string,
    claimId: string,
    body: ClaimStatusChange
  ): Promise<SubsidySchemeDetail> =>
    (await apiClient.patch(`${p.base}/${id}/claims/${claimId}/status`, body)).data.data,

  downloadCsv: async (): Promise<void> => {
    const res = await apiClient.get(p.exportCsv, { responseType: "blob" });
    const href = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = "subsidy-schemes.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  },
};
