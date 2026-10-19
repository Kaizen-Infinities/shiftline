import { GST_STATES, stateCodeOfGstin } from "@shiftline/shared";

/** Registration types the API accepts (supplier.validation.ts, GstRegistrationType). */
export const GST_REG_TYPES = [
  "REGULAR",
  "COMPOSITION",
  "UNREGISTERED",
  "SEZ",
  "OVERSEAS",
  "UIN",
] as const;
export type GstRegType = (typeof GST_REG_TYPES)[number];

/** GSTN code for "Other Territory": a party whose state is not on the Indian list. */
const OTHER_TERRITORY_CODE = "97";

/** Registration types that come with a GSTIN, and those that come without one. */
const WITH_GSTIN: readonly GstRegType[] = ["REGULAR", "COMPOSITION", "SEZ"];
const WITHOUT_GSTIN: readonly GstRegType[] = ["UNREGISTERED", "OVERSEAS", "UIN"];

/** Lower-case, ampersands as "and", letters and single spaces only. */
const normalise = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Older spellings the state picker may still return; the GST list uses the newer names. */
const OLD_STATE_NAMES: ReadonlyArray<[string, string]> = [
  ["orissa", "21"],
  ["pondicherry", "34"],
];

const STATE_CODE_BY_NAME: ReadonlyMap<string, string> = new Map<string, string>([
  ...GST_STATES.flatMap((s): [string, string][] => [
    [normalise(s.name), s.code],
    [normalise(s.alpha), s.code],
  ]),
  ...OLD_STATE_NAMES,
]);

/** Numeric GST state code for a state name (or GST alpha code), undefined when unknown. */
export const gstStateCodeForName = (name: string | null | undefined): string | undefined =>
  name ? STATE_CODE_BY_NAME.get(normalise(name)) : undefined;

export interface SupplierGstInput {
  gstin: string | null | undefined;
  gstRegType: string | null | undefined;
  /** The billing state as the state picker stores it (its full name). */
  billingState: string | null | undefined;
}

export interface SupplierGstFields {
  gstRegType: GstRegType;
  /** Two-digit GST state code, as the API compares it with the GSTIN prefix. */
  stateCode: string;
}

/**
 * The GST fields the supplier payload carries. With a GSTIN, the state code is the GSTIN's own
 * prefix, so the payload can never disagree with it. Without one, the billing state name is mapped
 * to its code. The stored two-letter code is never sent.
 */
export const supplierGstFields = ({
  gstin,
  gstRegType,
  billingState,
}: SupplierGstInput): SupplierGstFields => {
  const current = (GST_REG_TYPES as readonly string[]).includes(gstRegType ?? "")
    ? (gstRegType as GstRegType)
    : undefined;
  const gstinState = gstin ? stateCodeOfGstin(gstin.trim()) : undefined;

  if (gstinState) {
    return {
      gstRegType: current && WITH_GSTIN.includes(current) ? current : "REGULAR",
      stateCode: gstinState,
    };
  }
  return {
    gstRegType: current && WITHOUT_GSTIN.includes(current) ? current : "UNREGISTERED",
    stateCode: gstStateCodeForName(billingState) ?? OTHER_TERRITORY_CODE,
  };
};
