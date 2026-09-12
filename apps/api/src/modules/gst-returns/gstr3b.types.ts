import type { FilingApproval } from "@prisma/client";

/** GSTR-3B tables (P1-13b). Field names follow the portal's table numbering, not the JSON API. */

export interface TaxAmounts {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

/** 3.1 Details of outward supplies and inward supplies liable to reverse charge. */
export interface Gstr3bTable31 {
  /** (a) Outward taxable supplies (other than zero rated, nil rated and exempted). */
  a: TaxAmounts;
  /** (b) Outward taxable supplies (zero rated): exports and supplies to an SEZ. */
  b: TaxAmounts;
  /** (c) Other outward supplies (nil rated, exempted). */
  c: TaxAmounts;
  /** (d) Inward supplies liable to reverse charge. */
  d: TaxAmounts;
  /** (e) Non-GST outward supplies. */
  e: TaxAmounts;
}

/** 3.1.1 Supplies notified under section 9(5). Not modelled yet; both rows are zero. */
export interface Gstr3bTable311 {
  /** (i) Taxable supplies on which the e-commerce operator pays the tax. */
  ecoPays: TaxAmounts;
  /** (ii) Taxable supplies made by a registered person through an e-commerce operator. */
  registeredThroughEco: TaxAmounts;
}

/** 3.2 Of the supplies in 3.1(a), inter-state supplies to these persons, by place of supply. */
export interface Gstr3bInterStateRow {
  pos: string;
  taxable: number;
  igst: number;
}
export interface Gstr3bTable32 {
  unregistered: Gstr3bInterStateRow[];
  composition: Gstr3bInterStateRow[];
  uin: Gstr3bInterStateRow[];
}

/** 4 Eligible ITC. */
export interface Gstr3bTable4 {
  /** (A) ITC available, whether in full or part. */
  available: {
    /** (1) Import of goods. */
    importGoods: TaxAmounts;
    /** (2) Import of services. */
    importServices: TaxAmounts;
    /** (3) Inward supplies liable to reverse charge (other than 1 and 2). */
    reverseCharge: TaxAmounts;
    /** (4) Inward supplies from an input service distributor. */
    isd: TaxAmounts;
    /** (5) All other ITC, including credit reclaimed under rule 37. */
    other: TaxAmounts;
    total: TaxAmounts;
  };
  /** (B) ITC reversed. */
  reversed: {
    /** (1) As per rules 38, 42 and 43 and section 17(5). */
    rules: TaxAmounts;
    /** (2) Others: rule 37 non-payment and credit given back on a purchase return. */
    others: TaxAmounts;
    total: TaxAmounts;
  };
  /** (C) Net ITC available (A − B). */
  net: TaxAmounts;
  /** (D) Other details. */
  other: {
    /** (1) ITC reclaimed which was reversed under rule 37 in an earlier period. */
    reclaimed: TaxAmounts;
    /** (2) Ineligible ITC under section 17(5). */
    ineligible: TaxAmounts;
  };
}

/** 5 Values of exempt, nil rated and non-GST inward supplies. */
export interface Gstr3bTable5 {
  interState: { composition: number; nilExempt: number; nonGst: number };
  intraState: { composition: number; nilExempt: number; nonGst: number };
}

/** 6.1 Payment of tax, one row per head, for the two liabilities the portal separates. */
export interface Gstr3bPaymentRow {
  head: "IGST" | "CGST" | "SGST" | "CESS";
  /** Tax payable for this head. */
  payable: number;
  /** Paid through ITC, by the head the credit came from. */
  paidThroughItc: { igst: number; cgst: number; sgst: number; cess: number };
  /** Paid in cash. */
  cash: number;
}
export interface Gstr3bTable61 {
  /** (A) Other than reverse charge: may be set off against credit. */
  otherThanReverseCharge: Gstr3bPaymentRow[];
  /** (B) Reverse charge: always paid in cash. */
  reverseCharge: Gstr3bPaymentRow[];
  /** What has to be paid into the cash ledger, by head. */
  cashPayable: { igst: number; cgst: number; sgst: number; cess: number; total: number };
  /** Credit that is left over after the set-off. */
  creditBalance: { igst: number; cgst: number; sgst: number; cess: number };
}

export interface Gstr3bReturn {
  gstin: string;
  periodKey: string;
  /** "MMYYYY" as the portal writes it. */
  fp: string;
  table31: Gstr3bTable31;
  table311: Gstr3bTable311;
  table32: Gstr3bTable32;
  table4: Gstr3bTable4;
  table5: Gstr3bTable5;
  table61: Gstr3bTable61;
  /** Ledger rows behind table 4, for the accountant who has to defend a figure. */
  itc: {
    id: string;
    docType: string;
    docNo: string;
    docDate: string;
    supplierGstin: string | null;
    source: string;
    status: string;
    rule: string | null;
    reason: string | null;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    taxable: number;
    periodKey: string;
    reversedPeriod: string | null;
    reclaimedPeriod: string | null;
  }[];
  warnings: string[];
  payloadHash: string;
  filing: FilingApproval | null;
}
