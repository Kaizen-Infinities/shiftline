/**
 * GST arithmetic (P1-08): the nature of a supply from the two state codes and
 * the party's registration, and the CGST/SGST/IGST split of a tax amount.
 * Pure functions; every document service uses these instead of comparing
 * state names.
 */
import type { GstRegistrationType, SalesDocumentType, SupplyType } from "@prisma/client";

import { ApiError } from "../../utils/ApiError";

export interface SupplyContext {
  /** State code of the place the supply is made from (the business place). */
  fromStateCode: string | null | undefined;
  /** State code of the recipient (place of supply for goods). */
  toStateCode: string | null | undefined;
  partyRegistration?: GstRegistrationType | string | null;
}

/** Throws ApiError(400) when a state code needed for the split is unknown (export and SEZ need none). */
export const supplyTypeFor = ({
  fromStateCode,
  toStateCode,
  partyRegistration,
}: SupplyContext): SupplyType => {
  if (partyRegistration === "OVERSEAS") return "EXPORT";
  if (partyRegistration === "SEZ") return "SEZ";
  // An unknown state is never assumed local: it would silently mis-tax the document.
  if (!toStateCode) {
    throw new ApiError(
      400,
      "Place of supply state code is missing for this customer — set the state (or GSTIN) on the customer or shipping address"
    );
  }
  if (!fromStateCode) {
    throw new ApiError(
      400,
      "State code is missing for the issuing business place — set the state (or GSTIN) on the business place or company"
    );
  }
  return fromStateCode === toStateCode ? "INTRA_STATE" : "INTER_STATE";
};

/** Where IGST applies: any supply that leaves the state, plus exports and SEZ supplies. */
export const isIgstSupply = (supplyType: SupplyType) => supplyType !== "INTRA_STATE";

export interface GstSplit {
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Splits `rate` percent of `taxable` into CGST/SGST or IGST for the supply type. */
export const splitGst = (taxable: number, rate: number, supplyType: SupplyType): GstSplit => {
  const taxAmount = round2((taxable * rate) / 100);
  if (isIgstSupply(supplyType)) {
    return {
      cgstRate: 0,
      sgstRate: 0,
      igstRate: rate,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: taxAmount,
      taxAmount,
    };
  }
  const half = round2(taxAmount / 2);
  return {
    cgstRate: rate / 2,
    sgstRate: rate / 2,
    igstRate: 0,
    cgstAmount: half,
    sgstAmount: round2(taxAmount - half),
    igstAmount: 0,
    taxAmount,
  };
};

/** A composition or unregistered supplier issues bills of supply and charges no GST. */
export const canChargeGst = (companyRegistration: GstRegistrationType | string) =>
  companyRegistration === "REGULAR" || companyRegistration === "SEZ";

export const salesDocumentTypeFor = (
  companyRegistration: GstRegistrationType | string,
  supplyType: SupplyType
): SalesDocumentType => {
  if (!canChargeGst(companyRegistration)) return "BILL_OF_SUPPLY";
  if (supplyType === "EXPORT") return "EXPORT_INVOICE";
  return "TAX_INVOICE";
};
