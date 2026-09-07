import axios, { AxiosError, type AxiosInstance } from "axios";

import { logger } from "../../../lib/logger";
import {
  EwayBillProviderError,
  type CancelRequest,
  type ConsolidateRequest,
  type ConsolidateResult,
  type EwayBillProvider,
  type EwbByIrnRequest,
  type EwbCredentials,
  type EwbRequest,
  type EwbResult,
  type ExtendRequest,
  type ExtendResult,
  type PartBRequest,
} from "../eway-bill.types";

/**
 * A GSP's e-way bill API (NIC v1.03) plus the e-invoice portal's generate-by-IRN. Same auth as
 * the e-invoice adapter (token from client credentials and the taxpayer's API user); paths
 * follow the common GSP layout and are pinned per GSP at the first sandbox session.
 */
interface TokenEntry {
  token: string;
  expiresAt: number;
}

const nicDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?/);
  if (m) {
    return new Date(
      `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}+05:30`
    );
  }
  const d = new Date(v.replace(" ", "T") + (v.includes("+") || v.endsWith("Z") ? "" : "+05:30"));
  return Number.isNaN(d.getTime()) ? null : d;
};

export class EwbGspProvider implements EwayBillProvider {
  readonly name = "GSP";
  private readonly tokens = new Map<string, TokenEntry>();

  private client(creds: EwbCredentials): AxiosInstance {
    if (!creds.baseUrl) throw new EwayBillProviderError("CONFIG", "GSP base URL is not set");
    return axios.create({ baseURL: creds.baseUrl, timeout: 20_000 });
  }

  private async token(creds: EwbCredentials): Promise<string> {
    const key = `${creds.baseUrl}|${creds.clientId}|${creds.gstin}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    if (!creds.clientId || !creds.clientSecret || !creds.username || !creds.password) {
      throw new EwayBillProviderError("CONFIG", "GSP credentials are incomplete");
    }
    try {
      const res = await this.client(creds).post(
        "/ewaybillapi/v1.03/auth",
        { username: creds.username, password: creds.password },
        {
          headers: {
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            gstin: creds.gstin,
          },
        }
      );
      const data = res.data?.data ?? res.data;
      const token = data?.authtoken ?? data?.AuthToken ?? data?.access_token;
      if (!token) throw new EwayBillProviderError("AUTH", "GSP did not return a token", true);
      this.tokens.set(key, { token, expiresAt: Date.now() + 5 * 60_000 });
      return token;
    } catch (err) {
      throw this.wrap(err, "Could not authenticate with the GSP");
    }
  }

  private wrap(err: unknown, fallback: string): EwayBillProviderError {
    if (err instanceof EwayBillProviderError) return err;
    const ax = err as AxiosError<{
      errorCodes?: string;
      error?: { message?: string };
      message?: string;
    }>;
    const body = ax.response?.data;
    if (body?.errorCodes)
      return new EwayBillProviderError(String(body.errorCodes), body.error?.message ?? fallback);
    const status = ax.response?.status;
    logger.warn({ err, status }, "gsp e-way bill call failed");
    return new EwayBillProviderError(
      status ? String(status) : "NETWORK",
      status && status < 500 ? (body?.message ?? fallback) : `${fallback} (temporary)`,
      !status || status >= 500 || status === 401
    );
  }

  private headers(creds: EwbCredentials, token: string) {
    return {
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      gstin: creds.gstin,
      authtoken: token,
      Authorization: `Bearer ${token}`,
    };
  }

  private async post<T>(
    path: string,
    body: unknown,
    creds: EwbCredentials,
    fallback: string
  ): Promise<T> {
    const token = await this.token(creds);
    try {
      const res = await this.client(creds).post(path, body, {
        headers: this.headers(creds, token),
      });
      const out = res.data;
      if (out?.status === "0" || out?.status === 0 || out?.errorCodes) {
        throw this.wrap({ response: { status: 400, data: out } } as AxiosError, fallback);
      }
      return (out?.data ?? out) as T;
    } catch (err) {
      throw this.wrap(err, fallback);
    }
  }

  async generate(request: EwbRequest, creds: EwbCredentials): Promise<EwbResult> {
    const d = await this.post<{
      ewayBillNo: string | number;
      ewayBillDate: string;
      validUpto?: string;
      alert?: string;
    }>("/ewaybillapi/v1.03/ewayapi/genewaybill", request, creds, "E-way bill was not generated");
    return {
      ewbNo: String(d.ewayBillNo),
      ewbDate: nicDate(d.ewayBillDate) ?? new Date(),
      validUpto: nicDate(d.validUpto),
      alert: d.alert ?? null,
      raw: d,
    };
  }

  async generateByIrn(request: EwbByIrnRequest, creds: EwbCredentials): Promise<EwbResult> {
    const d = await this.post<{
      EwbNo: string | number;
      EwbDt: string;
      EwbValidTill?: string;
      Remarks?: string;
    }>("/eiewb/v1.03/ewaybill", request, creds, "E-way bill was not generated from the IRN");
    return {
      ewbNo: String(d.EwbNo),
      ewbDate: nicDate(d.EwbDt) ?? new Date(),
      validUpto: nicDate(d.EwbValidTill),
      alert: d.Remarks ?? null,
      raw: d,
    };
  }

  async updatePartB(request: PartBRequest, creds: EwbCredentials) {
    const d = await this.post<{ ewayBillNo: string | number; validUpto?: string }>(
      "/ewaybillapi/v1.03/ewayapi/vehewb",
      request,
      creds,
      "Part B was not updated"
    );
    return {
      ewbNo: String(d.ewayBillNo ?? request.ewbNo),
      validUpto: nicDate(d.validUpto),
      raw: d,
    };
  }

  async extend(request: ExtendRequest, creds: EwbCredentials): Promise<ExtendResult> {
    const d = await this.post<{ ewayBillNo: string | number; validUpto: string }>(
      "/ewaybillapi/v1.03/ewayapi/extendvalidity",
      request,
      creds,
      "Validity was not extended"
    );
    return {
      ewbNo: String(d.ewayBillNo ?? request.ewbNo),
      validUpto: nicDate(d.validUpto) ?? new Date(),
      raw: d,
    };
  }

  async cancel(request: CancelRequest, creds: EwbCredentials) {
    const d = await this.post<{ ewayBillNo: string | number; cancelDate: string }>(
      "/ewaybillapi/v1.03/ewayapi/canewb",
      request,
      creds,
      "E-way bill was not cancelled"
    );
    return {
      ewbNo: String(d.ewayBillNo ?? request.ewbNo),
      cancelDate: nicDate(d.cancelDate) ?? new Date(),
      raw: d,
    };
  }

  async consolidate(
    request: ConsolidateRequest,
    creds: EwbCredentials
  ): Promise<ConsolidateResult> {
    const d = await this.post<{ cEWBNo: string | number; cEWBDate: string }>(
      "/ewaybillapi/v1.03/ewayapi/gencewb",
      request,
      creds,
      "Consolidated e-way bill was not generated"
    );
    return { cEwbNo: String(d.cEWBNo), cEwbDate: nicDate(d.cEWBDate) ?? new Date(), raw: d };
  }
}

export const ewbGspProvider = new EwbGspProvider();
