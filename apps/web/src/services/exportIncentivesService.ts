import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Export incentives and EPCG / Advance Authorisation obligations (TN-01). */
export type IncentiveScheme = "RODTEP" | "ROSCTL" | "DRAWBACK";
export type IncentiveStatus =
  | "DECLARED"
  | "SCROLLED"
  | "SCRIP_GENERATED"
  | "UTILISED"
  | "TRANSFERRED"
  | "CREDITED"
  | "REJECTED";
export type AuthorisationType = "EPCG" | "ADVANCE_AUTHORISATION";

export interface IncentiveClaim {
  id: string;
  scheme: IncentiveScheme;
  shippingBillNo: string;
  shippingBillDate: string;
  portCode: string | null;
  fobValueInr: string;
  ratePercent: string | null;
  expectedAmount: string;
  scrolledAmount: string | null;
  scripNo: string | null;
  scripExpiresOn: string | null;
  utilisedAmount: string;
  status: IncentiveStatus;
}

export interface IncentiveSummary {
  byScheme: Record<string, Record<string, { count: number; expected: number }>>;
  pendingReceivable: number;
  creditedThisFy: number;
  scrolledNoScrip: { id: string; shippingBillNo: string; scrolledOn: string | null }[];
  expiringScrips: {
    id: string;
    scripNo: string | null;
    scripExpiresOn: string;
    unutilised: number;
  }[];
}

export interface AuthorisationProgress {
  shippedFob: number;
  realisedFob: number;
  eoPercent: number;
  block1Percent: number | null;
  daysToDue: number;
}

export interface ObligationEntry {
  id: string;
  shippingBillNo: string;
  shippingBillDate: string;
  fobValueInr: string;
  realisedOn: string | null;
  brcNo: string | null;
}

export interface Authorisation {
  id: string;
  authType: AuthorisationType;
  authNo: string;
  issueDate: string;
  rlaOffice: string | null;
  dutySaved: string;
  exportObligationAmount: string;
  eoDueDate: string;
  block1DueDate: string | null;
  status: string;
  progress: AuthorisationProgress;
  entries?: ObligationEntry[];
}

const p = API_PATHS.exportIncentives;

export const exportIncentivesService = {
  listClaims: async (params: { scheme?: IncentiveScheme; status?: IncentiveStatus } = {}) =>
    (await apiClient.get(p.claims, { params })).data.data as IncentiveClaim[],
  summary: async () => (await apiClient.get(p.claimsSummary)).data.data as IncentiveSummary,
  createClaim: async (body: Record<string, unknown>) =>
    (await apiClient.post(p.claims, body)).data.data as IncentiveClaim,
  createFromInvoice: async (salesInvoiceId: string, body: Record<string, unknown>) =>
    (await apiClient.post(`${p.claimFromInvoice}/${salesInvoiceId}`, body)).data
      .data as IncentiveClaim,
  updateClaim: async (id: string, body: Record<string, unknown>) =>
    (await apiClient.patch(`${p.claims}/${id}`, body)).data.data as IncentiveClaim,
  deleteClaim: async (id: string) => (await apiClient.delete(`${p.claims}/${id}`)).data.data,
  listAuthorisations: async () =>
    (await apiClient.get(p.authorisations)).data.data as Authorisation[],
  getAuthorisation: async (id: string) =>
    (await apiClient.get(`${p.authorisations}/${id}`)).data.data as Authorisation,
  createAuthorisation: async (body: Record<string, unknown>) =>
    (await apiClient.post(p.authorisations, body)).data.data as Authorisation,
  updateAuthorisation: async (id: string, body: Record<string, unknown>) =>
    (await apiClient.patch(`${p.authorisations}/${id}`, body)).data.data as Authorisation,
  addEntry: async (id: string, body: Record<string, unknown>) =>
    (await apiClient.post(`${p.authorisations}/${id}/entries`, body)).data.data as Authorisation,
  removeEntry: async (id: string, entryId: string) =>
    (await apiClient.delete(`${p.authorisations}/${id}/entries/${entryId}`)).data
      .data as Authorisation,
};
