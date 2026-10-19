import { describe, expect, it } from "vitest";

import { gstStateCodeForName, supplierGstFields } from "./supplierGst";

const GSTIN_TN = "33AAAAA0000A1Z9";
const GSTIN_KA = "29AAAAA0000A1Z5";

describe("supplierGstFields", () => {
  it("takes the state code from the GSTIN, not from the billing state picker", () => {
    expect(
      supplierGstFields({ gstin: GSTIN_KA, gstRegType: "REGULAR", billingState: "Tamil Nadu" })
    ).toEqual({ gstRegType: "REGULAR", stateCode: "29" });
  });

  it("uppercases a lowercase GSTIN before reading its state", () => {
    expect(
      supplierGstFields({ gstin: GSTIN_TN.toLowerCase(), gstRegType: "REGULAR", billingState: "" })
    ).toEqual({ gstRegType: "REGULAR", stateCode: "33" });
  });

  it("defaults a GSTIN supplier to REGULAR, never the old 'Registered' label", () => {
    const fields = supplierGstFields({ gstin: GSTIN_TN, gstRegType: "Registered", billingState: "" });
    expect(fields.gstRegType).toBe("REGULAR");
  });

  it("keeps a valid GSTIN-bearing registration type chosen for a GSTIN supplier", () => {
    expect(
      supplierGstFields({ gstin: GSTIN_TN, gstRegType: "SEZ", billingState: "" }).gstRegType
    ).toBe("SEZ");
  });

  it("maps the billing state name to its numeric code when there is no GSTIN", () => {
    expect(
      supplierGstFields({ gstin: "", gstRegType: "REGULAR", billingState: "Tamil Nadu" })
    ).toEqual({ gstRegType: "UNREGISTERED", stateCode: "33" });
  });

  it("does not use a stored two-letter state code such as the old 'TN' default", () => {
    // stateCode is not an input at all: the only sources are the GSTIN and the billing state.
    expect(
      supplierGstFields({ gstin: null, gstRegType: null, billingState: "Karnataka" }).stateCode
    ).toBe("29");
  });

  it("keeps OVERSEAS and UIN on a supplier that has no GSTIN", () => {
    expect(
      supplierGstFields({ gstin: "", gstRegType: "OVERSEAS", billingState: "" }).gstRegType
    ).toBe("OVERSEAS");
    expect(supplierGstFields({ gstin: "", gstRegType: "UIN", billingState: "" }).gstRegType).toBe(
      "UIN"
    );
  });

  it("falls back to Other Territory (97) when the state name is not on the GST list", () => {
    expect(
      supplierGstFields({ gstin: "", gstRegType: "OVERSEAS", billingState: "Ohio" }).stateCode
    ).toBe("97");
  });
});

describe("gstStateCodeForName", () => {
  it("matches the official state and union territory names case-insensitively", () => {
    expect(gstStateCodeForName("Tamil Nadu")).toBe("33");
    expect(gstStateCodeForName("  karnataka ")).toBe("29");
    expect(gstStateCodeForName("Andaman & Nicobar Islands")).toBe("35");
    expect(gstStateCodeForName("Dadra and Nagar Haveli and Daman and Diu")).toBe("26");
  });

  it("accepts the older spellings Orissa and Pondicherry", () => {
    expect(gstStateCodeForName("Orissa")).toBe("21");
    expect(gstStateCodeForName("Pondicherry")).toBe("34");
  });

  it("accepts the two-letter GST alpha code", () => {
    expect(gstStateCodeForName("TN")).toBe("33");
  });

  it("returns undefined for an empty or unknown name", () => {
    expect(gstStateCodeForName("")).toBeUndefined();
    expect(gstStateCodeForName(undefined)).toBeUndefined();
    expect(gstStateCodeForName("Atlantis")).toBeUndefined();
  });
});
