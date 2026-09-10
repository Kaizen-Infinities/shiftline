/**
 * Tax arithmetic for expenses and petty cash (P1-08b). The bill total stays in
 * `amount`; GST is split by the vendor's state against the paying branch, and
 * TDS is worked out from the taxable value when only a rate is given.
 */
import type { Db } from "../../lib/prisma";
import { splitGst, supplyTypeFor } from "../gst/gst.calc";
import { companyGstProfile, resolveIssuingPlace, stateOfGstin } from "../gst/gst.context";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ExpenseTaxInput {
  amount: number;
  businessPlaceId?: string | number | bigint | null;
  vendorGstin?: string | null;
  taxableAmount?: number | null;
  gstRate?: number | null;
  reverseCharge?: boolean | null;
  itcEligible?: boolean | null;
  tdsRate?: number | null;
  tdsAmount?: number | null;
}

export async function computeExpenseTax(db: Db, input: ExpenseTaxInput) {
  const profile = await companyGstProfile(db);
  const place = await resolveIssuingPlace(input.businessPlaceId, profile, db);
  const rate = Number(input.gstRate ?? 0);
  const reverseCharge = Boolean(input.reverseCharge);
  const amount = Number(input.amount);
  // Forward charge: the bill includes GST. Reverse charge: the vendor bills without GST.
  const taxable =
    input.taxableAmount !== undefined && input.taxableAmount !== null
      ? Number(input.taxableAmount)
      : rate > 0 && !reverseCharge
        ? round2(amount / (1 + rate / 100))
        : amount;
  const supplyType = supplyTypeFor({
    fromStateCode: stateOfGstin(input.vendorGstin) ?? place.stateCode,
    toStateCode: place.stateCode,
  });
  const split = splitGst(taxable, rate, supplyType);
  const tdsRate = Number(input.tdsRate ?? 0);
  const tdsAmount =
    input.tdsAmount !== undefined && input.tdsAmount !== null
      ? round2(Number(input.tdsAmount))
      : round2((taxable * tdsRate) / 100);
  return {
    businessPlaceId: place.id,
    vendorGstin: input.vendorGstin ?? null,
    taxableAmount: taxable,
    gstRate: rate,
    cgstAmount: split.cgstAmount,
    sgstAmount: split.sgstAmount,
    igstAmount: split.igstAmount,
    supplyType,
    reverseCharge,
    itcEligible: input.itcEligible ?? true,
    tdsRate,
    tdsAmount,
  };
}
