import type { FilingApproval } from "@prisma/client";
import type { TaxAmounts } from "./gstr3b.types";

/**
 * GSTR-9 working papers (P1-13d). Field names follow the portal's table numbering.
 *
 * These are working papers, not a return: the annual return is reconciled against the books by
 * a person and filed on the portal. What the tables give them is the twelve months added up the
 * way the portal asks, with every figure traceable to the monthly return it came from.
 */

/** 4 Details of advances and of supplies on which tax is payable. */
export interface Gstr9Table4 {
  /** (A) Supplies to unregistered persons (B2C). */
  b2c: TaxAmounts;
  /** (B) Supplies to registered persons (B2B). */
  b2b: TaxAmounts;
  /** (C) Zero-rated supply (export) on payment of tax, excluding supplies to SEZs. */
  exportWithTax: TaxAmounts;
  /** (D) Supply to SEZs on payment of tax. */
  sezWithTax: TaxAmounts;
  /** (E) Deemed exports. */
  deemedExport: TaxAmounts;
  /** (F) Advances on which tax has been paid but invoice has not been issued. */
  advances: TaxAmounts;
  /** (G) Inward supplies on which tax is to be paid on reverse charge. */
  reverseCharge: TaxAmounts;
  /** (H) Sub-total (A to G). */
  subTotal: TaxAmounts;
  /** (I) Credit notes issued against (A) to (E). */
  creditNotes: TaxAmounts;
  /** (J) Debit notes issued against (A) to (E). */
  debitNotes: TaxAmounts;
  /** (K) and (L) amendments; not modelled, both zero. */
  amendments: TaxAmounts;
  /** (N) Supplies and advances on which tax is to be paid. */
  total: TaxAmounts;
}

/** 5 Details of outward supplies on which tax is not payable. */
export interface Gstr9Table5 {
  /** (A) Zero-rated supply (export) without payment of tax. */
  exportWithoutTax: TaxAmounts;
  /** (B) Supply to SEZs without payment of tax. */
  sezWithoutTax: TaxAmounts;
  /** (C) Supplies on which tax is to be paid by the recipient on reverse charge. */
  reverseChargeOutward: TaxAmounts;
  /** (D) Exempted, (E) Nil rated, (F) Non-GST supply. */
  exempted: TaxAmounts;
  nilRated: TaxAmounts;
  nonGst: TaxAmounts;
  /** (H) and (I) notes against (A) to (F). */
  creditNotes: TaxAmounts;
  debitNotes: TaxAmounts;
  /** (N) Total turnover on which tax is not to be paid. */
  total: TaxAmounts;
  /** (O) Total turnover including advances, (P) less the reverse-charge inward supplies. */
  grossTurnover: number;
  turnoverForTheYear: number;
}

/** 6 Details of ITC availed as declared in the returns filed during the financial year. */
export interface Gstr9Table6 {
  /** (A) Total ITC availed through GSTR-3B, which is the sum of its table 4(A). */
  availedIn3b: TaxAmounts;
  /** (B) Inward supplies other than imports and inward supplies liable to reverse charge. */
  inward: TaxAmounts;
  /** (C) Inward supplies from unregistered persons liable to reverse charge. */
  reverseChargeUnregistered: TaxAmounts;
  /** (D) Inward supplies from registered persons liable to reverse charge. */
  reverseChargeRegistered: TaxAmounts;
  /** (E) Import of goods, (F) import of services, (G) credit from an ISD. */
  importGoods: TaxAmounts;
  importServices: TaxAmounts;
  isd: TaxAmounts;
  /** (H) Amount of ITC reclaimed under rule 37. */
  reclaimed: TaxAmounts;
  /** (I) Sub-total (B to H). */
  subTotal: TaxAmounts;
  /** (J) Difference (I − A): it should be zero, and when it is not that is the finding. */
  difference: TaxAmounts;
  /** (K) and (L) transition credit; not modelled, zero. */
  transition: TaxAmounts;
  /** (O) Total ITC availed. */
  total: TaxAmounts;
}

/** 7 Details of ITC reversed and ineligible ITC. */
export interface Gstr9Table7 {
  /** (A) rule 37 (non-payment within 180 days). */
  rule37: TaxAmounts;
  /** (B) rule 39 (ISD), (C) rule 42, (D) rule 43, (E) section 17(5). */
  rule39: TaxAmounts;
  rule42: TaxAmounts;
  rule43: TaxAmounts;
  section17_5: TaxAmounts;
  /** (F) and (G) TRAN-I and TRAN-II; not modelled, zero. */
  transition: TaxAmounts;
  /** (H) Other reversals. */
  other: TaxAmounts;
  /** (I) Total ITC reversed, (J) net ITC available for utilisation. */
  total: TaxAmounts;
  net: TaxAmounts;
}

/** 8 Other ITC-related information: the books against what the suppliers filed. */
export interface Gstr9Table8 {
  /** (A) ITC as per GSTR-2B for the year. */
  asPer2b: TaxAmounts;
  /** (B) ITC as per the sum of 6(B) and 6(H). */
  asPerBooks: TaxAmounts;
  /** (C) ITC on inward supplies of this year availed in the next one; entered by hand. */
  availedNextYear: TaxAmounts;
  /** (D) Difference (A − B − C): credit the suppliers filed and the company did not take. */
  difference: TaxAmounts;
  /** (G) IGST paid on import of goods, (H) the credit availed on it, (I) the difference. */
  igstOnImports: TaxAmounts;
  igstCreditAvailed: TaxAmounts;
  importDifference: TaxAmounts;
}

/** 9 Details of tax paid as declared in the returns filed during the financial year. */
export interface Gstr9Table9Row {
  head: "IGST" | "CGST" | "SGST" | "CESS" | "INTEREST" | "LATE_FEE";
  payable: number;
  paidInCash: number;
  paidThroughItc: { igst: number; cgst: number; sgst: number; cess: number };
}

/** 17 and 18 HSN-wise summary of outward and inward supplies. */
export interface Gstr9HsnRow {
  hsn: string;
  uqc: string;
  quantity: number;
  taxable: number;
  rate: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr9Return {
  gstin: string;
  /** Financial year `2026-27`. */
  fyKey: string;
  /** The twelve month keys the tables were added up from, in order. */
  months: string[];
  table4: Gstr9Table4;
  table5: Gstr9Table5;
  table6: Gstr9Table6;
  table7: Gstr9Table7;
  table8: Gstr9Table8;
  table9: Gstr9Table9Row[];
  table17: Gstr9HsnRow[];
  table18: Gstr9HsnRow[];
  /** Month by month, so a figure in a table can be traced to the return it came from. */
  monthly: {
    periodKey: string;
    outputTax: TaxAmounts;
    netItc: TaxAmounts;
    cashPaid: number;
  }[];
  warnings: string[];
  payloadHash: string;
  filing: FilingApproval | null;
}
