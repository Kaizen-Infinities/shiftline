import { describe, expect, it } from "vitest";
import { validateNewPassword, validateResetForm } from "./passwordRules";

describe("validateNewPassword", () => {
  it("accepts a password that meets every API rule", () => {
    expect(validateNewPassword("Abcdef12")).toBeNull();
  });

  it("rejects short, long and class-incomplete passwords", () => {
    expect(validateNewPassword("Abc12")).toMatch(/at least 8/);
    expect(validateNewPassword("A".repeat(60) + "a1" + "b".repeat(12))).toMatch(/not exceed 72/);
    expect(validateNewPassword("abcdefgh1")).toMatch(/uppercase/);
    expect(validateNewPassword("ABCDEFGH1")).toMatch(/uppercase|lowercase/);
    expect(validateNewPassword("Abcdefgh")).toMatch(/digit/);
  });
});

describe("validateResetForm", () => {
  it("flags a mismatched confirmation", () => {
    expect(validateResetForm("Abcdef12", "Abcdef13")).toEqual({
      confirm: "Passwords do not match",
    });
  });

  it("returns no errors when the password is valid and confirmed", () => {
    expect(validateResetForm("Abcdef12", "Abcdef12")).toEqual({});
  });
});
