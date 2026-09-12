import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Foreign exchange and imports (P1-17). */
export interface FxLine {
  documentType: string;
  documentId: string;
  documentNo: string;
  partyName: string;
  currencyCode: string;
  foreignAmount: number;
  bookedRate: number;
  bookedInr: number;
  closingRate: number;
  restatedInr: number;
  difference: number;
}

export interface FxRevaluationRow {
  id: string;
  periodKey: string;
  asOn: string;
  status: "DRAFT" | "POSTED" | "REVERSED";
  netAmount: string;
  voucherId: number | null;
  reversalVoucherId: number | null;
  postedAt: string | null;
}

export interface BillOfEntryRow {
  id: string;
  beNumber: string;
  beDate: string;
  portCode: string | null;
  currencyCode: string;
  exchangeRate: string;
  foreignValue: string;
  assessableValue: string;
  basicDuty: string;
  socialWelfareSurcharge: string;
  igst: string;
  cess: string;
  otherCharges: string;
  landedCost: string;
  supplier: { legalName: string } | null;
}

const p = API_PATHS.fx;

export const fxService = {
  pullRates: async (body: { on?: string; provider?: "FIXTURE" | "RBI" } = {}) =>
    (await apiClient.post(`${p.rates}/pull`, body)).data.data as {
      provider: string;
      fetched: number;
      missing: string[];
    },
  exposure: async (asOn?: string): Promise<FxLine[]> =>
    (await apiClient.get(p.exposure, { params: { asOn } })).data.data,
  revaluations: async (): Promise<FxRevaluationRow[]> =>
    (await apiClient.get(p.revaluations)).data.data,
  previewRevaluation: async (
    periodKey: string
  ): Promise<{ periodKey: string; asOn: string; netAmount: number; lines: FxLine[] }> =>
    (await apiClient.get(`${p.revaluations}/preview/${periodKey}`)).data.data,
  revalue: async (periodKey: string): Promise<FxRevaluationRow> =>
    (await apiClient.post(`${p.revaluations}/${periodKey}`)).data.data,
  billsOfEntry: async (): Promise<BillOfEntryRow[]> =>
    (await apiClient.get(p.billsOfEntry)).data.data,
  createBillOfEntry: async (body: {
    beNumber: string;
    beDate: string;
    portCode?: string | null;
    currencyCode?: string;
    exchangeRate: number;
    foreignValue: number;
    assessableValue?: number;
    basicDuty?: number;
    socialWelfareSurcharge?: number;
    igst?: number;
    otherCharges?: number;
  }): Promise<BillOfEntryRow> => (await apiClient.post(p.billsOfEntry, body)).data.data,
};
