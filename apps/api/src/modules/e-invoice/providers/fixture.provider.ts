import { createHash } from "node:crypto";

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
 * Recorded-behaviour provider: what the portal does, without the portal. Used by tests, the
 * demo tenant and any tenant that has not connected a GSP yet. Deterministic: the IRN is the
 * portal's own formula (SHA-256 of GSTIN, financial year, document type and number), the
 * acknowledgement is derived from it, the signed fields are unsigned JSON marked as such.
 * It refuses the same things the portal refuses so the surrounding code is exercised.
 */
const fyOf = (dt: string) => {
  // dd/mm/yyyy → Indian financial year "2026-27"
  const [, mm, yyyy] = dt.split("/").map(Number);
  const start = mm >= 4 ? yyyy : yyyy - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

export const computeIrn = (gstin: string, docDate: string, docType: string, docNo: string) =>
  createHash("sha256")
    .update(`${gstin}${fyOf(docDate)}${docType}${docNo}`)
    .digest("hex");

export class FixtureProvider implements EInvoiceProvider {
  readonly name = "FIXTURE";
  private readonly cancelled = new Set<string>();

  async generate(request: IrnRequest, creds: ProviderCredentials): Promise<IrnResult> {
    if (request.SellerDtls.Gstin !== creds.gstin) {
      throw new EInvoiceProviderError("2150", "Seller GSTIN does not match the logged-in GSTIN");
    }
    if (request.BuyerDtls.Gstin === request.SellerDtls.Gstin) {
      throw new EInvoiceProviderError("2262", "Supplier and recipient GSTIN cannot be the same");
    }
    if (request.ItemList.length === 0) {
      throw new EInvoiceProviderError("2183", "Item list cannot be empty");
    }
    const total = request.ValDtls.TotInvVal;
    const sum = request.ItemList.reduce((s, i) => s + i.TotItemVal, 0) + request.ValDtls.OthChrg;
    if (Math.abs(total - sum - request.ValDtls.RndOffAmt) > 1) {
      throw new EInvoiceProviderError("2240", "Invoice value does not match the sum of items");
    }
    const irn = computeIrn(
      request.SellerDtls.Gstin,
      request.DocDtls.Dt,
      request.DocDtls.Typ,
      request.DocDtls.No
    );
    const ackDate = new Date();
    const ackNo = String(BigInt(`0x${irn.slice(0, 12)}`) % 10n ** 15n).padStart(15, "1");
    const signed = { irn, ackNo, ackDate: ackDate.toISOString(), request, fixture: true };
    const signedInvoice = `fixture.${Buffer.from(JSON.stringify(signed)).toString("base64url")}`;
    const qr = {
      SellerGstin: request.SellerDtls.Gstin,
      BuyerGstin: request.BuyerDtls.Gstin,
      DocNo: request.DocDtls.No,
      DocTyp: request.DocDtls.Typ,
      DocDt: request.DocDtls.Dt,
      TotInvVal: total,
      ItemCnt: request.ItemList.length,
      MainHsnCode: request.ItemList[0].HsnCd,
      Irn: irn,
      IrnDt: ackDate.toISOString(),
    };
    const signedQr = `fixture.${Buffer.from(JSON.stringify(qr)).toString("base64url")}`;
    return {
      irn,
      ackNo,
      ackDate,
      signedInvoice,
      signedQr,
      status: "ACT",
      raw: { Irn: irn, AckNo: ackNo, AckDt: ackDate.toISOString(), Status: "ACT" },
    };
  }

  async cancel(irn: string, reason: CancelReasonCode, remarks: string): Promise<IrnCancelResult> {
    if (this.cancelled.has(irn)) {
      throw new EInvoiceProviderError("2270", "The IRN is already cancelled");
    }
    if (!remarks.trim()) {
      throw new EInvoiceProviderError("2272", "Cancellation remarks are required");
    }
    this.cancelled.add(irn);
    const cancelDate = new Date();
    return { irn, cancelDate, raw: { Irn: irn, CancelDate: cancelDate.toISOString(), reason } };
  }

  async verify(creds: ProviderCredentials) {
    return { ok: Boolean(creds.gstin), detail: "Fixture provider: nothing is sent anywhere" };
  }
}

export const fixtureProvider = new FixtureProvider();
