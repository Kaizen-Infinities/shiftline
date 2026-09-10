import axios, { AxiosError, type AxiosInstance } from "axios";

import { logger } from "../../../lib/logger";
import {
  EInvoiceProviderError,
  type CancelReasonCode,
  type EInvoiceProvider,
  type IrnCancelResult,
  type IrnRequest,
  type IrnResult,
  type ProviderCredentials,
} from "../e-invoice.types";

/**
 * A GST Suvidha Provider over HTTPS. GSPs wrap NIC's API in the same shape: an auth call
 * that trades client credentials plus the taxpayer's API user for a short-lived token, then
 * `/invoice` (generate), `/invoice/cancel`, and `/invoice/irn/:irn`. Paths and header names
 * vary by GSP, so they are configurable through the base URL; the payload and the error
 * codes are NIC's. Credentials are per company and decrypted just before the call.
 *
 * Nothing here has been exercised against a live sandbox yet: the contract fixtures in
 * `test/fixtures/e-invoice/` are the recorded shapes it is written to, and the first
 * sandbox session (see the hand-off) is where the paths get pinned per GSP.
 */
interface TokenEntry {
  token: string;
  expiresAt: number;
}

const parseNicDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  // NIC: "2026-09-07 14:22:10" (IST) or dd/mm/yyyy
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00+05:30`);
  const d = new Date(v.replace(" ", "T") + (v.includes("+") || v.endsWith("Z") ? "" : "+05:30"));
  return Number.isNaN(d.getTime()) ? null : d;
};

export class GspProvider implements EInvoiceProvider {
  readonly name = "GSP";
  private readonly tokens = new Map<string, TokenEntry>();

  private client(creds: ProviderCredentials): AxiosInstance {
    if (!creds.baseUrl) throw new EInvoiceProviderError("CONFIG", "GSP base URL is not set");
    return axios.create({ baseURL: creds.baseUrl, timeout: 20_000 });
  }

  private async token(creds: ProviderCredentials): Promise<string> {
    const key = `${creds.baseUrl}|${creds.clientId}|${creds.gstin}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    if (!creds.clientId || !creds.clientSecret || !creds.username || !creds.password) {
      throw new EInvoiceProviderError("CONFIG", "GSP credentials are incomplete");
    }
    try {
      const res = await this.client(creds).post(
        "/eivital/v1.04/auth",
        {
          UserName: creds.username,
          Password: creds.password,
          AppKey: "",
          ForceRefreshAccessToken: true,
        },
        {
          headers: {
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            gstin: creds.gstin,
          },
        }
      );
      const data = res.data?.Data ?? res.data;
      const token = data?.AuthToken ?? data?.access_token;
      if (!token) throw new EInvoiceProviderError("AUTH", "GSP did not return a token", true);
      const expiresAt = parseNicDate(data?.TokenExpiry)?.getTime() ?? Date.now() + 5 * 60_000;
      this.tokens.set(key, { token, expiresAt });
      return token;
    } catch (err) {
      throw this.wrap(err, "Could not authenticate with the GSP");
    }
  }

  private wrap(err: unknown, fallback: string): EInvoiceProviderError {
    if (err instanceof EInvoiceProviderError) return err;
    const ax = err as AxiosError<{
      ErrorDetails?: { ErrorCode?: string; ErrorMessage?: string }[];
      message?: string;
    }>;
    const details = ax.response?.data?.ErrorDetails;
    if (Array.isArray(details) && details.length > 0) {
      const codes = details.map((d) => d.ErrorCode ?? "?").join(",");
      const text = details
        .map((d) => d.ErrorMessage ?? "")
        .filter(Boolean)
        .join("; ");
      return new EInvoiceProviderError(codes, text || fallback);
    }
    const status = ax.response?.status;
    logger.warn({ err, status }, "gsp call failed");
    return new EInvoiceProviderError(
      status ? String(status) : "NETWORK",
      status && status < 500 ? (ax.response?.data?.message ?? fallback) : `${fallback} (temporary)`,
      !status || status >= 500 || status === 401
    );
  }

  private headers(creds: ProviderCredentials, token: string) {
    return {
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      gstin: creds.gstin,
      user_name: creds.username ?? "",
      AuthToken: token,
      Authorization: `Bearer ${token}`,
    };
  }

  async generate(request: IrnRequest, creds: ProviderCredentials): Promise<IrnResult> {
    const token = await this.token(creds);
    try {
      const res = await this.client(creds).post("/eicore/v1.03/Invoice", request, {
        headers: this.headers(creds, token),
      });
      const body = res.data;
      const data = body?.Data ?? body;
      if (body?.Status === 0 || body?.Status === "0" || !data?.Irn) {
        throw this.wrap(
          { response: { status: 400, data: body } } as AxiosError,
          "IRN was not generated"
        );
      }
      return {
        irn: data.Irn,
        ackNo: String(data.AckNo),
        ackDate: parseNicDate(data.AckDt) ?? new Date(),
        signedInvoice: data.SignedInvoice ?? "",
        signedQr: data.SignedQRCode ?? "",
        status: "ACT",
        ewbNo: data.EwbNo ? String(data.EwbNo) : null,
        ewbDate: parseNicDate(data.EwbDt),
        ewbValidTill: parseNicDate(data.EwbValidTill),
        raw: body,
      };
    } catch (err) {
      throw this.wrap(err, "IRN was not generated");
    }
  }

  async cancel(
    irn: string,
    reason: CancelReasonCode,
    remarks: string,
    creds: ProviderCredentials
  ): Promise<IrnCancelResult> {
    const token = await this.token(creds);
    try {
      const res = await this.client(creds).post(
        "/eicore/v1.03/Invoice/Cancel",
        { Irn: irn, CnlRsn: reason, CnlRem: remarks },
        { headers: this.headers(creds, token) }
      );
      const body = res.data;
      const data = body?.Data ?? body;
      if (body?.Status === 0 || body?.Status === "0" || !data?.Irn) {
        throw this.wrap(
          { response: { status: 400, data: body } } as AxiosError,
          "IRN was not cancelled"
        );
      }
      return { irn: data.Irn, cancelDate: parseNicDate(data.CancelDate) ?? new Date(), raw: body };
    } catch (err) {
      throw this.wrap(err, "IRN was not cancelled");
    }
  }

  async verify(creds: ProviderCredentials) {
    try {
      await this.token(creds);
      return { ok: true, detail: "Authenticated with the GSP" };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "Authentication failed" };
    }
  }
}

export const gspProvider = new GspProvider();
