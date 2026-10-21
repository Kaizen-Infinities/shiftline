import { describe, it, expect } from "vitest";
import { toPhoneEntries } from "./phoneEntries";

describe("toPhoneEntries", () => {
  it("turns a seeded string array into labelled entries (CMP-B01)", () => {
    expect(toPhoneEntries(["9000000001", "9000000002"])).toEqual([
      { label: "Primary Mobile Number", number: "9000000001" },
      { label: "Alternative Number", number: "9000000002" },
    ]);
  });

  it("keeps entries that are already objects", () => {
    expect(toPhoneEntries([{ label: "WhatsApp Number", number: "9000000003" }])).toEqual([
      { label: "WhatsApp Number", number: "9000000003" },
    ]);
  });

  it("accepts a single plain string", () => {
    expect(toPhoneEntries("9000000001")).toEqual([
      { label: "Primary Mobile Number", number: "9000000001" },
    ]);
  });

  it("drops blank and malformed values instead of throwing", () => {
    expect(toPhoneEntries(["", "  ", null, 42, { label: "x" }])).toEqual([]);
    expect(toPhoneEntries(undefined)).toEqual([]);
    expect(toPhoneEntries("")).toEqual([]);
  });
});
