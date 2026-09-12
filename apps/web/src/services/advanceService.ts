import apiClient from "../api/apiClient";
import { API_PATHS } from "@shiftline/shared";

/** Advances received and the currency master behind foreign-currency documents (P1-14). */
export interface AdvanceAdjustmentRow {
  id: string;
  kind: "ADJUSTED" | "REFUNDED";
  amount: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  refundVoucherNo: string | null;
  adjustedOn: string;
  salesInvoiceId: string | null;
}
export interface AdvanceRow {
  id: string;
  receiptNo: string;
  receiptDate: string;
  customerId: string;
  customer?: { id: string; firmName: string; displayName: string | null };
  amount: number;
  taxable: number;
  gstRate: number;
  igst: number;
  cgst: number;
  sgst: number;
  placeOfSupply: string | null;
  paymentMethod: string;
  referenceNumber: string | null;
  narration: string | null;
  adjustedAmount: number;
  refundedAmount: number;
  balance: number;
  status: "OPEN" | "PART_ADJUSTED" | "CLOSED";
  adjustments?: AdvanceAdjustmentRow[];
}

export interface CurrencyRow {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
  isActive: boolean;
}
export interface ExchangeRateRow {
  id: string;
  currencyCode: string;
  rateDate: string;
  rate: number;
  source: "MANUAL" | "RBI" | "IMPORT";
}

const base = API_PATHS.advances.base;
const cur = API_PATHS.currencies;

export const advanceService = {
  list: async (q: { customerId?: string; status?: string } = {}): Promise<AdvanceRow[]> =>
    (await apiClient.get(base, { params: q })).data.data,
  get: async (id: string): Promise<AdvanceRow> => (await apiClient.get(`${base}/${id}`)).data.data,
  open: async (customerId: string): Promise<AdvanceRow[]> =>
    (await apiClient.get(API_PATHS.advances.open, { params: { customerId } })).data.data,
  create: async (body: {
    customerId: string;
    receiptDate: string;
    amount: number;
    gstRate?: number;
    placeOfSupply?: string;
    paymentMethod?: string;
    referenceNumber?: string | null;
    narration?: string | null;
  }): Promise<AdvanceRow> => (await apiClient.post(base, body)).data.data,
  adjust: async (
    id: string,
    body: { salesInvoiceId: string; amount: number; on?: string }
  ): Promise<AdvanceAdjustmentRow> =>
    (await apiClient.post(`${base}/${id}/adjust`, body)).data.data,
  refund: async (
    id: string,
    body: { amount: number; on?: string; reason?: string | null }
  ): Promise<AdvanceAdjustmentRow> =>
    (await apiClient.post(`${base}/${id}/refund`, body)).data.data,
};

export const currencyService = {
  list: async (all = false): Promise<CurrencyRow[]> =>
    (await apiClient.get(cur.base, { params: { all } })).data.data,
  save: async (body: {
    code: string;
    name: string;
    symbol?: string | null;
    decimals?: number;
    isActive?: boolean;
  }): Promise<CurrencyRow> => (await apiClient.post(cur.base, body)).data.data,
  rates: async (q: { currencyCode?: string } = {}): Promise<ExchangeRateRow[]> =>
    (await apiClient.get(cur.rates, { params: q })).data.data,
  setRate: async (body: {
    currencyCode: string;
    rateDate: string;
    rate: number;
    source?: string;
  }): Promise<ExchangeRateRow> => (await apiClient.post(cur.rates, body)).data.data,
};
