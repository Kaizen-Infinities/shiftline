/**
 * GSTR-2B as the portal's offline utility writes it, and the shapes the reconciliation works in
 * (P1-13c).
 *
 * 2B is drawn from what the *supplier* filed, not from the company's own purchase register, so
 * these records are evidence rather than bookkeeping: they are imported or pulled, never typed,
 * and the company's only input is the IMS decision it takes on each one.
 */

/** One rate line of a supplier's document. */
export interface Gstr2bItem {
  num?: number;
  rt: number;
  txval: number;
  igst?: number;
  cgst?: number;
  sgst?: number;
  cess?: number;
}

/** A supplier invoice inside a `b2b` block. */
export interface Gstr2bInv {
  inum: string;
  /** R regular, SEWP/SEWOP SEZ, DE deemed export. */
  typ?: string;
  dt: string;
  val: number;
  pos?: string;
  rev?: "Y" | "N";
  /** Whether the portal makes the credit available, and why not when it does not. */
  itcavl?: "Y" | "N";
  rsn?: string | null;
  items: Gstr2bItem[];
}

/** A credit or debit note inside a `cdnr` block. */
export interface Gstr2bNote extends Omit<Gstr2bInv, "inum"> {
  nt_num: string;
  /** C credit note, D debit note. */
  ntty: "C" | "D";
}

export interface Gstr2bSupplierBlock<T> {
  ctin: string;
  trdnm?: string;
  /** The period the supplier filed in, and the day they filed. */
  supprd?: string;
  supfildt?: string;
  inv?: T[];
  nt?: T[];
}

/** An import of goods row; there is no supplier GSTIN, only a bill of entry. */
export interface Gstr2bImpg {
  boenum: string;
  boedt: string;
  portcode?: string;
  txval: number;
  igst?: number;
  cess?: number;
}

export interface Gstr2bJson {
  data?: {
    gstin?: string;
    rtnprd?: string;
    docdata?: Gstr2bDocData;
  };
  /** Some exports omit the `data` envelope. */
  gstin?: string;
  rtnprd?: string;
  docdata?: Gstr2bDocData;
}

export interface Gstr2bDocData {
  b2b?: Gstr2bSupplierBlock<Gstr2bInv>[];
  b2ba?: Gstr2bSupplierBlock<Gstr2bInv>[];
  cdnr?: Gstr2bSupplierBlock<Gstr2bNote>[];
  cdnra?: Gstr2bSupplierBlock<Gstr2bNote>[];
  impg?: Gstr2bImpg[];
  isd?: Gstr2bSupplierBlock<Gstr2bInv>[];
}

/** A record flattened out of the portal JSON, ready to be written to the ledger. */
export interface ParsedRecord {
  supplierGstin: string;
  supplierName: string | null;
  docType: "INV" | "CRN" | "DBN" | "ISD" | "IMPG";
  docNo: string;
  docDate: Date;
  docValue: number;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  itcAvailable: boolean;
  itcReason: string | null;
  filingPeriod: string | null;
  filingDate: Date | null;
  raw: unknown;
}

/** How far a book document may differ from a 2B record and still be the same document. */
export interface MatchTolerance {
  /** Days either side of the supplier's document date. */
  days: number;
  /** Rupees of difference in taxable value that still counts as a match. */
  value: number;
}

export const DEFAULT_TOLERANCE: MatchTolerance = { days: 7, value: 1 };

export interface MismatchField {
  field: "docDate" | "taxable" | "igst" | "cgst" | "sgst" | "cess" | "docValue";
  inBooks: number | string;
  inPortal: number | string;
  difference?: number;
}

/** A purchase document as the reconciliation sees it, whatever table it came from. */
export interface BookDocument {
  docType: "GRN" | "EXPENSE" | "PETTY_CASH";
  docId: string;
  docNo: string;
  docNoNorm: string;
  docDate: Date;
  supplierGstin: string | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  docValue: number;
}

export interface ReconciliationSummary {
  matched: number;
  mismatch: number;
  missingIn2b: number;
  missingInBooks: number;
  /** Credit the portal offers, and credit the books claim, so the gap is visible either way. */
  portalCredit: { igst: number; cgst: number; sgst: number; cess: number };
  bookCredit: { igst: number; cgst: number; sgst: number; cess: number };
}

/** Credentials come from the e-invoice configuration; a GSP login serves every portal API. */
export interface Gstr2bCredentials {
  baseUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  username: string | null;
  password: string | null;
  gstin: string;
}

export class Gstr2bProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "Gstr2bProviderError";
  }
}

export interface ImsPushItem {
  supplierGstin: string;
  docType: string;
  docNo: string;
  docDate: Date;
  /** A for accept, R for reject, P for pending, as the portal names them. */
  action: "A" | "R" | "P";
}

export interface ImsPushResult {
  /** The portal's reference for the push, stored against every action in it. */
  reference: string;
  accepted: number;
  rejected: number;
  pending: number;
  raw: unknown;
}

export interface Gstr2bProvider {
  readonly name: string;
  /** Pulls the 2B the portal drew for a period. */
  fetch2b(periodKey: string, creds: Gstr2bCredentials): Promise<Gstr2bJson>;
  pushImsActions(items: ImsPushItem[], creds: Gstr2bCredentials): Promise<ImsPushResult>;
  verify(creds: Gstr2bCredentials): Promise<{ ok: boolean; detail: string }>;
}
