/**
 * E-invoice (P1-11, FI1). The request follows the Invoice Registration Portal's schema
 * version 1.1 (the JSON every GSP forwards to NIC), so a provider only carries transport,
 * authentication and the response envelope; the document mapping lives in
 * `e-invoice.payload.ts` and is provider-independent.
 */
/**
 * "JWC" (job-work challan) never has an e-invoice row — a challan carries no tax, nothing is
 * supplied — but it is a valid `docType` so `assertDocumentCancellable` can be called on it like
 * any other document's cancel path (P2-08); `forDocument` then always finds nothing and the
 * check is a no-op.
 */
export type EInvoiceDocType = "INV" | "CRN" | "DBN" | "JWC";

export interface IrnAddress {
  Gstin: string;
  LglNm: string;
  TrdNm?: string;
  Addr1: string;
  Addr2?: string;
  Loc: string;
  Pin: number;
  Stcd: string;
  Ph?: string;
  Em?: string;
}

export interface IrnShipTo {
  Gstin?: string;
  LglNm: string;
  TrdNm?: string;
  Addr1: string;
  Addr2?: string;
  Loc: string;
  Pin: number;
  Stcd: string;
}

export interface IrnItem {
  SlNo: string;
  PrdDesc: string;
  IsServc: "Y" | "N";
  HsnCd: string;
  Qty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  CesRt: number;
  CesAmt: number;
  TotItemVal: number;
}

export interface IrnRequest {
  Version: "1.1";
  TranDtls: {
    TaxSch: "GST";
    /** B2B | SEZWP | SEZWOP | EXPWP | EXPWOP | DEXP */
    SupTyp: string;
    RegRev: "Y" | "N";
    IgstOnIntra: "Y" | "N";
  };
  DocDtls: { Typ: EInvoiceDocType; No: string; Dt: string };
  SellerDtls: IrnAddress;
  BuyerDtls: IrnAddress & { Pos: string };
  ShipDtls?: IrnShipTo;
  ItemList: IrnItem[];
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    CesVal: number;
    Discount: number;
    OthChrg: number;
    RndOffAmt: number;
    TotInvVal: number;
  };
  /** The original document a credit or debit note refers to. */
  RefDtls?: { PrecDocDtls: { InvNo: string; InvDt: string }[] };
}

export interface IrnResult {
  irn: string;
  ackNo: string;
  ackDate: Date;
  signedInvoice: string;
  signedQr: string;
  status: "ACT";
  ewbNo?: string | null;
  ewbDate?: Date | null;
  ewbValidTill?: Date | null;
  raw: unknown;
}

export interface IrnCancelResult {
  irn: string;
  cancelDate: Date;
  raw: unknown;
}

/** NIC cancellation reasons. */
export const CANCEL_REASONS = {
  "1": "Duplicate",
  "2": "Data entry mistake",
  "3": "Order cancelled",
  "4": "Other",
} as const;
export type CancelReasonCode = keyof typeof CANCEL_REASONS;

export interface ProviderCredentials {
  baseUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  username: string | null;
  password: string | null;
  gstin: string;
}

/** An error the portal returned; the code is NIC's, the message is what the user sees. */
export class EInvoiceProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** Whether a retry can help (network, token) as opposed to a bad document. */
    public readonly retryable = false
  ) {
    super(message);
    this.name = "EInvoiceProviderError";
  }
}

export interface EInvoiceProvider {
  readonly name: string;
  generate(request: IrnRequest, creds: ProviderCredentials): Promise<IrnResult>;
  cancel(
    irn: string,
    reason: CancelReasonCode,
    remarks: string,
    creds: ProviderCredentials
  ): Promise<IrnCancelResult>;
  /** Proves the credentials work without registering anything. */
  verify(creds: ProviderCredentials): Promise<{ ok: boolean; detail: string }>;
}
