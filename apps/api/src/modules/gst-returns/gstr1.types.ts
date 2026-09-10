/** GSTR-1 as the portal's offline tool reads it (JSON schema v3.x, the fields Shiftline fills). */
export interface Gstr1ItemDet {
  rt: number;
  txval: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt: number;
}
export interface Gstr1Item {
  num: number;
  itm_det: Gstr1ItemDet;
}
export interface Gstr1Inv {
  inum: string;
  idt: string;
  val: number;
  pos: string;
  rchrg: "Y" | "N";
  /** R regular, SEWP SEZ with payment, SEWOP SEZ without, DE deemed export, CBW custom bonded */
  inv_typ: "R" | "SEWP" | "SEWOP" | "DE";
  itms: Gstr1Item[];
}
export interface Gstr1B2b {
  ctin: string;
  inv: Gstr1Inv[];
}
export interface Gstr1B2clInv {
  inum: string;
  idt: string;
  val: number;
  itms: Gstr1Item[];
}
export interface Gstr1B2cl {
  pos: string;
  inv: Gstr1B2clInv[];
}
export interface Gstr1B2cs {
  sply_ty: "INTRA" | "INTER";
  rt: number;
  typ: "OE";
  pos: string;
  txval: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt: number;
}
export interface Gstr1Note {
  ntty: "C" | "D";
  nt_num: string;
  nt_dt: string;
  p_gst: "Y" | "N";
  val: number;
  pos: string;
  rchrg: "Y" | "N";
  inv_typ: "R" | "SEWP" | "SEWOP" | "DE";
  itms: Gstr1Item[];
}
export interface Gstr1Cdnr {
  ctin: string;
  nt: Gstr1Note[];
}
export interface Gstr1Cdnur {
  typ: "B2CL" | "EXPWP" | "EXPWOP";
  ntty: "C" | "D";
  nt_num: string;
  nt_dt: string;
  val: number;
  pos: string;
  itms: Gstr1Item[];
}
export interface Gstr1ExpInv {
  inum: string;
  idt: string;
  val: number;
  sbpcode?: string;
  sbnum?: string;
  sbdt?: string;
  itms: { txval: number; rt: number; iamt: number; csamt: number }[];
}
export interface Gstr1Exp {
  exp_typ: "WPAY" | "WOPAY";
  inv: Gstr1ExpInv[];
}
export interface Gstr1Hsn {
  num: number;
  hsn_sc: string;
  desc: string;
  uqc: string;
  qty: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
  rt: number;
}
export interface Gstr1DocIssue {
  doc_num: number;
  doc_typ: string;
  docs: {
    num: number;
    from: string;
    to: string;
    totnum: number;
    cancel: number;
    net_issue: number;
  }[];
}
export interface Gstr1Nil {
  inv: {
    sply_ty: "INTRB2B" | "INTRB2C" | "INTRAB2B" | "INTRAB2C";
    nil_amt: number;
    expt_amt: number;
    ngsup_amt: number;
  }[];
}

export interface Gstr1Json {
  gstin: string;
  fp: string;
  version: string;
  hash: string;
  b2b: Gstr1B2b[];
  b2cl: Gstr1B2cl[];
  b2cs: Gstr1B2cs[];
  cdnr: Gstr1Cdnr[];
  cdnur: Gstr1Cdnur[];
  exp: Gstr1Exp[];
  nil: Gstr1Nil;
  hsn: { data: Gstr1Hsn[] };
  doc_issue: { doc_det: Gstr1DocIssue[] };
}

export interface Gstr1Totals {
  invoices: number;
  creditNotes: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  total: number;
  byTable: Record<string, { count: number; taxable: number; tax: number }>;
}

export interface Gstr1Return {
  gstin: string;
  periodKey: string;
  fp: string;
  json: Gstr1Json;
  totals: Gstr1Totals;
  /** Documents that could not be placed (missing HSN, missing GSTIN on a B2B, and so on). */
  warnings: string[];
  payloadHash: string;
  filing: unknown;
}
