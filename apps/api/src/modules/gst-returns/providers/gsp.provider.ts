import axios, { AxiosError, type AxiosInstance } from "axios";

import { logger } from "../../../lib/logger";
import {
  Gstr2bProviderError,
  type Gstr2bCredentials,
  type Gstr2bJson,
  type Gstr2bProvider,
  type ImsPushItem,
  type ImsPushResult,
} from "../gstr2b.types";

/**
 * The returns and IMS APIs through a GST Suvidha Provider. The same login serves every portal
 * API, so the credentials are the ones already stored for e-invoicing: `/gstr2b` for the
 * statement the portal drew, `/ims/invoices` for the inward records and `/ims/action` for the
 * decisions going back.
 *
 * Like the e-invoice adapter, this has not met a live sandbox: the paths and header names
 * follow the common GSP layout and have to be pinned in the first sandbox session. Until the
 * owner supplies credentials the fixture provider is what runs, and the shapes below are what
 * the parser is written against.
 */
interface TokenEntry {
  token: string;
  expiresAt: number;
}

const dmy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;

/** `2026-08` → `082026`, the return period as every portal API writes it. */
const rtnprd = (periodKey: string) => {
  const [y, m] = periodKey.split("-");
  return `${m}${y}`;
};

export class Gstr2bGspProvider implements Gstr2bProvider {
  readonly name = "GSP";
  private readonly tokens = new Map<string, TokenEntry>();

  private client(creds: Gstr2bCredentials): AxiosInstance {
    if (!creds.baseUrl) throw new Gstr2bProviderError("CONFIG", "GSP base URL is not set");
    return axios.create({ baseURL: creds.baseUrl, timeout: 30_000 });
  }

  private async token(creds: Gstr2bCredentials): Promise<string> {
    const key = `${creds.baseUrl}|${creds.clientId}|${creds.gstin}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    if (!creds.clientId || !creds.clientSecret || !creds.username || !creds.password) {
      throw new Gstr2bProviderError("CONFIG", "GSP credentials are incomplete");
    }
    try {
      const res = await this.client(creds).post(
        "/gstapi/v1.0/authenticate",
        { action: "ACCESSTOKEN", username: creds.username, password: creds.password },
        {
          headers: {
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            gstin: creds.gstin,
          },
        }
      );
      const body = res.data ?? {};
      const token = body.access_token ?? body.AuthToken ?? body.Data?.AuthToken;
      if (!token) throw new Gstr2bProviderError("AUTH", "The GSP returned no token");
      const expiresIn = Number(body.expires_in ?? 3600);
      this.tokens.set(key, { token, expiresAt: Date.now() + expiresIn * 1000 });
      return token;
    } catch (err) {
      throw this.wrap(err, "AUTH", "Could not sign in to the GSP");
    }
  }

  /** The portal's error code and message, or a network failure marked retryable. */
  private wrap(err: unknown, fallbackCode: string, fallbackMessage: string): Gstr2bProviderError {
    const ax = err as AxiosError<{ error?: { error_cd?: string; message?: string }[] }>;
    if (err instanceof Gstr2bProviderError) return err;
    const portal = Array.isArray(ax.response?.data?.error) ? ax.response?.data?.error?.[0] : null;
    if (portal?.error_cd) {
      return new Gstr2bProviderError(portal.error_cd, portal.message ?? fallbackMessage, false);
    }
    const status = ax.response?.status ?? 0;
    // The portal is often simply busy; a 5xx or a timeout is worth another attempt.
    const retryable = status === 0 || status >= 500 || status === 429;
    logger.error({ err, status }, "[GSTR-2B GSP] request failed");
    return new Gstr2bProviderError(fallbackCode, fallbackMessage, retryable);
  }

  private async headers(creds: Gstr2bCredentials) {
    return {
      "auth-token": await this.token(creds),
      client_id: creds.clientId ?? "",
      client_secret: creds.clientSecret ?? "",
      gstin: creds.gstin,
    };
  }

  async fetch2b(periodKey: string, creds: Gstr2bCredentials): Promise<Gstr2bJson> {
    try {
      const res = await this.client(creds).get("/gstapi/v1.0/returns/gstr2b", {
        params: { gstin: creds.gstin, rtnprd: rtnprd(periodKey) },
        headers: await this.headers(creds),
      });
      return res.data as Gstr2bJson;
    } catch (err) {
      throw this.wrap(err, "GSTR2B", `Could not fetch the 2B for ${periodKey}`);
    }
  }

  async pushImsActions(items: ImsPushItem[], creds: Gstr2bCredentials): Promise<ImsPushResult> {
    if (items.length === 0) throw new Gstr2bProviderError("NO_ACTIONS", "There is nothing to push");
    try {
      const res = await this.client(creds).post(
        "/gstapi/v1.0/ims/action",
        {
          gstin: creds.gstin,
          invdata: items.map((i) => ({
            stin: i.supplierGstin,
            dty: i.docType,
            dnum: i.docNo,
            ddt: dmy(i.docDate),
            action: i.action,
          })),
        },
        { headers: await this.headers(creds) }
      );
      const body = res.data ?? {};
      const reference = body.reference_id ?? body.ref_id ?? body.Data?.reference_id;
      if (!reference)
        throw new Gstr2bProviderError(
          "IMS_NO_REF",
          "The portal accepted no reference for the push"
        );
      return {
        reference: String(reference).slice(0, 64),
        accepted: items.filter((i) => i.action === "A").length,
        rejected: items.filter((i) => i.action === "R").length,
        pending: items.filter((i) => i.action === "P").length,
        raw: body,
      };
    } catch (err) {
      throw this.wrap(err, "IMS_PUSH", "The portal refused the IMS actions");
    }
  }

  async verify(creds: Gstr2bCredentials) {
    try {
      await this.token(creds);
      return { ok: true, detail: `Signed in to the GSP as ${creds.username}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}

export const gstr2bGspProvider = new Gstr2bGspProvider();
