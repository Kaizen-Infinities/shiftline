import { describe, expect, it, vi } from "vitest";

import { fetchSupplierCodeWithRetry } from "./supplierCode";

/**
 * H02 (E2E-B06): the supplier code stayed disabled and blank while the next-code request was
 * pending, and a failed request was only logged, so the user could never type a code.
 * The helper retries and resolves to "" when every attempt fails, so the form can open the field.
 */
describe("fetchSupplierCodeWithRetry", () => {
  it("returns the code from the first successful attempt", async () => {
    const fetchNext = vi.fn().mockResolvedValue("SUP007");
    await expect(fetchSupplierCodeWithRetry(fetchNext, { delayMs: 0 })).resolves.toBe("SUP007");
    expect(fetchNext).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed request and returns the later code", async () => {
    const fetchNext = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("SUP008");
    await expect(fetchSupplierCodeWithRetry(fetchNext, { delayMs: 0 })).resolves.toBe("SUP008");
    expect(fetchNext).toHaveBeenCalledTimes(2);
  });

  it("resolves to an empty string after all attempts fail, so the field can be typed", async () => {
    const fetchNext = vi.fn().mockRejectedValue(new Error("down"));
    await expect(
      fetchSupplierCodeWithRetry(fetchNext, { attempts: 3, delayMs: 0 })
    ).resolves.toBe("");
    expect(fetchNext).toHaveBeenCalledTimes(3);
  });

  it("treats an empty response as a failed attempt", async () => {
    const fetchNext = vi.fn().mockResolvedValue("");
    await expect(
      fetchSupplierCodeWithRetry(fetchNext, { attempts: 2, delayMs: 0 })
    ).resolves.toBe("");
    expect(fetchNext).toHaveBeenCalledTimes(2);
  });
});
