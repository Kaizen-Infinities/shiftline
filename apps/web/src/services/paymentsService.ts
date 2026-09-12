import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Payment links and the gateway's settings (P1-21). */
export type PaymentLinkStatus = "CREATED" | "PARTIALLY_PAID" | "PAID" | "EXPIRED" | "CANCELLED";

export interface PaymentCaptureRow {
  id: string;
  providerPaymentId: string;
  amount: string;
  fee: string;
  feeTax: string;
  method: string | null;
  capturedAt: string;
  status: "CAPTURED" | "FAILED" | "REFUNDED";
}

export interface PaymentLinkRow {
  id: string;
  linkNo: string;
  provider: string;
  shortUrl: string | null;
  salesInvoiceId: string | null;
  amount: string;
  amountPaid: string;
  status: PaymentLinkStatus;
  description: string | null;
  expiresAt: string | null;
  createdAt: string;
  captures?: PaymentCaptureRow[];
}

export interface GatewaySettings {
  provider: string;
  enabled: boolean;
  keyId: string | null;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  bankLedgerCode: string;
  feeLedgerCode: string;
  expiryHours: number;
  webhookPath: string;
  lastVerifiedAt: string | null;
}

export interface GatewaySettingsInput {
  provider: string;
  enabled: boolean;
  keyId?: string | null;
  keySecret?: string | null;
  webhookSecret?: string | null;
  bankLedgerCode: string;
  feeLedgerCode: string;
  expiryHours: number;
}

const p = API_PATHS.payments;

export const paymentsService = {
  links: async (
    params: { status?: PaymentLinkStatus; salesInvoiceId?: string } = {}
  ): Promise<PaymentLinkRow[]> => (await apiClient.get(p.links, { params })).data.data,
  link: async (id: string): Promise<PaymentLinkRow> =>
    (await apiClient.get(`${p.links}/${id}`)).data.data,
  create: async (body: {
    salesInvoiceId?: string | null;
    amount?: number | null;
    description?: string | null;
    notifyEmail?: string | null;
    notifyPhone?: string | null;
  }): Promise<PaymentLinkRow> => (await apiClient.post(p.links, body)).data.data,
  cancel: async (id: string, reason?: string): Promise<PaymentLinkRow> =>
    (await apiClient.post(`${p.links}/${id}/cancel`, { reason })).data.data,
  refresh: async (id: string): Promise<PaymentLinkRow> =>
    (await apiClient.post(`${p.links}/${id}/refresh`)).data.data,
  /** Fixture gateway only: the signed callback a payer would cause. */
  simulate: async (
    id: string,
    body: { amount?: number | null; fail?: boolean } = {}
  ): Promise<{ body: string; signature: string }> =>
    (await apiClient.post(`${p.links}/${id}/simulate`, body)).data.data,
  settings: async (): Promise<GatewaySettings> => (await apiClient.get(p.settings)).data.data,
  saveSettings: async (body: GatewaySettingsInput): Promise<GatewaySettings> =>
    (await apiClient.put(p.settings, body)).data.data,
  verify: async (): Promise<{ ok: boolean; detail: string }> =>
    (await apiClient.post(`${p.settings}/verify`)).data.data,
  rotateToken: async (): Promise<GatewaySettings> =>
    (await apiClient.post(`${p.settings}/rotate-token`)).data.data,
};
