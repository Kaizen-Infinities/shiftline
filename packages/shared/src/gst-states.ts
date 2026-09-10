/**
 * GST state codes (first two digits of a GSTIN) with the official state and
 * union-territory names. Used by onboarding, GSTIN validation and, from P1-08,
 * place-of-supply logic. Source: GSTN list of state codes.
 */
export interface GstState {
  code: string;
  name: string;
  /** Two-letter abbreviation used in GST documents and portals. */
  alpha: string;
}

export const GST_STATES: readonly GstState[] = [
  { code: "01", name: "Jammu and Kashmir", alpha: "JK" },
  { code: "02", name: "Himachal Pradesh", alpha: "HP" },
  { code: "03", name: "Punjab", alpha: "PB" },
  { code: "04", name: "Chandigarh", alpha: "CH" },
  { code: "05", name: "Uttarakhand", alpha: "UK" },
  { code: "06", name: "Haryana", alpha: "HR" },
  { code: "07", name: "Delhi", alpha: "DL" },
  { code: "08", name: "Rajasthan", alpha: "RJ" },
  { code: "09", name: "Uttar Pradesh", alpha: "UP" },
  { code: "10", name: "Bihar", alpha: "BR" },
  { code: "11", name: "Sikkim", alpha: "SK" },
  { code: "12", name: "Arunachal Pradesh", alpha: "AR" },
  { code: "13", name: "Nagaland", alpha: "NL" },
  { code: "14", name: "Manipur", alpha: "MN" },
  { code: "15", name: "Mizoram", alpha: "MZ" },
  { code: "16", name: "Tripura", alpha: "TR" },
  { code: "17", name: "Meghalaya", alpha: "ML" },
  { code: "18", name: "Assam", alpha: "AS" },
  { code: "19", name: "West Bengal", alpha: "WB" },
  { code: "20", name: "Jharkhand", alpha: "JH" },
  { code: "21", name: "Odisha", alpha: "OD" },
  { code: "22", name: "Chhattisgarh", alpha: "CG" },
  { code: "23", name: "Madhya Pradesh", alpha: "MP" },
  { code: "24", name: "Gujarat", alpha: "GJ" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu", alpha: "DD" },
  { code: "27", name: "Maharashtra", alpha: "MH" },
  { code: "29", name: "Karnataka", alpha: "KA" },
  { code: "30", name: "Goa", alpha: "GA" },
  { code: "31", name: "Lakshadweep", alpha: "LD" },
  { code: "32", name: "Kerala", alpha: "KL" },
  { code: "33", name: "Tamil Nadu", alpha: "TN" },
  { code: "34", name: "Puducherry", alpha: "PY" },
  { code: "35", name: "Andaman and Nicobar Islands", alpha: "AN" },
  { code: "36", name: "Telangana", alpha: "TS" },
  { code: "37", name: "Andhra Pradesh", alpha: "AP" },
  { code: "38", name: "Ladakh", alpha: "LA" },
  { code: "97", name: "Other Territory", alpha: "OT" },
];

export const GST_STATE_BY_CODE: ReadonlyMap<string, GstState> = new Map(
  GST_STATES.map((s) => [s.code, s])
);

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Format, state-code and check-digit validation of a GSTIN (the last character
 * is a mod-36 Luhn-style check over the first fourteen).
 */
export const isValidGstin = (value: string): boolean => {
  const gstin = value.trim().toUpperCase();
  if (!GSTIN_REGEX.test(gstin)) return false;
  if (!GST_STATE_BY_CODE.has(gstin.slice(0, 2))) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value36 = GSTIN_ALPHABET.indexOf(gstin[i]);
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value36 * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return GSTIN_ALPHABET[check] === gstin[14];
};

/** GST state code of a GSTIN, or undefined when the value is not a GSTIN. */
export const stateCodeOfGstin = (gstin: string): string | undefined =>
  GSTIN_REGEX.test(gstin.trim().toUpperCase()) ? gstin.trim().slice(0, 2) : undefined;
