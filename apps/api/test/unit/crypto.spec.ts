import { describe, expect, it } from "vitest";
import { encryptText, decryptText, isEncrypted } from "../../src/utils/crypto";

describe("credential encryption", () => {
  it("round-trips and marks ciphertext", () => {
    const enc = encryptText("EAAG-secret-token");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("EAAG-secret-token");
    expect(decryptText(enc)).toBe("EAAG-secret-token");
  });
  it("uses a fresh IV per call", () => {
    expect(encryptText("x")).not.toBe(encryptText("x"));
  });
  it("passes legacy plaintext through", () => {
    expect(decryptText("plain-old-password")).toBe("plain-old-password");
  });
});
