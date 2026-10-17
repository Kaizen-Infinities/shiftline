import { describe, expect, it } from "vitest";

import { supplyTypeFor } from "../../src/modules/gst/gst.calc";
import { stateNameToCode } from "../../src/modules/imports/imports.types";

describe("supplyTypeFor", () => {
  it("splits by state code", () => {
    expect(supplyTypeFor({ fromStateCode: "27", toStateCode: "27" })).toBe("INTRA_STATE");
    expect(supplyTypeFor({ fromStateCode: "27", toStateCode: "29" })).toBe("INTER_STATE");
  });
  it("refuses an unknown place of supply instead of assuming intra-state", () => {
    expect(() => supplyTypeFor({ fromStateCode: "27", toStateCode: null })).toThrow(
      /Place of supply state code is missing/
    );
    expect(() => supplyTypeFor({ fromStateCode: "27", toStateCode: undefined })).toThrow();
  });
  it("refuses an unknown issuing state", () => {
    expect(() => supplyTypeFor({ fromStateCode: null, toStateCode: "27" })).toThrow(/issuing/);
  });
  it("needs no state for export or SEZ", () => {
    expect(
      supplyTypeFor({ fromStateCode: "27", toStateCode: null, partyRegistration: "OVERSEAS" })
    ).toBe("EXPORT");
    expect(
      supplyTypeFor({ fromStateCode: "27", toStateCode: null, partyRegistration: "SEZ" })
    ).toBe("SEZ");
  });
});

describe("stateNameToCode", () => {
  it("matches an exact name, ignoring case and whitespace", () => {
    expect(stateNameToCode("  maharashtra ")).toBe("27");
  });
  it("never matches a misspelled or partial name", () => {
    expect(stateNameToCode("Maharastra")).toBeUndefined();
    expect(stateNameToCode("Mahar")).toBeUndefined();
    expect(stateNameToCode("")).toBeUndefined();
  });
  it("a misspelled state yields an unresolved supply (refused)", () => {
    expect(() =>
      supplyTypeFor({ fromStateCode: "27", toStateCode: stateNameToCode("Karnatka") ?? null })
    ).toThrow(/Place of supply/);
  });
});
