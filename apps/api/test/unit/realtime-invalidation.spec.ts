import { describe, expect, it } from "vitest";
import { toInvalidation } from "../../src/lib/realtime";

describe("realtime payloads are invalidation-only (F04)", () => {
  it("keeps only the id of a record", () => {
    const out = toInvalidation({
      id: 7,
      fullName: "Asha Rao",
      panNumber: "ABCDE1234F",
      basicSalary: "50000.00",
      address: { line1: "x" },
    });
    expect(out).toEqual({ id: 7 });
  });

  it("keeps opaque ids and discriminators, drops other fields", () => {
    const out = toInvalidation({
      roleId: 3,
      runId: "r1",
      source: "salesInvoice",
      type: "RECEIPT",
      amount: "100.00",
      narration: "private",
    });
    expect(out).toEqual({ roleId: 3, runId: "r1", source: "salesInvoice", type: "RECEIPT" });
  });

  it("lists the ledgers a voucher touched without amounts", () => {
    const out = toInvalidation({
      id: "v1",
      items: [
        { debitLedgerId: 1, creditLedgerId: 2, amount: "500.00" },
        { debitLedgerId: 1, amount: "5.00" },
      ],
    });
    expect(out).toEqual({ id: "v1", ledgerIds: [1, 2] });
  });

  it("turns a bare id into { id } and passes nothing through for other shapes", () => {
    expect(toInvalidation(undefined)).toBeUndefined();
    expect(toInvalidation(12)).toEqual({ id: 12 });
    expect(toInvalidation("abc")).toEqual({ id: "abc" });
    expect(toInvalidation([{ id: 1, secret: "x" }])).toEqual({});
  });

  it("drops non-primitive values even under a kept key", () => {
    expect(toInvalidation({ id: { secret: "x" }, customerId: ["a"] })).toEqual({});
  });
});
