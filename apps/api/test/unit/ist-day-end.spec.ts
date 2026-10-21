import { describe, expect, it } from "vitest";

import { getISTDayEndUtc, getISTDayStartUtc } from "../../src/utils/dateUtils";

/**
 * SET-B02: dashboard periods ended at "now", so invoices dated today (stored at UTC midnight,
 * 05:30 IST) were dropped between IST midnight and 05:30. The period now ends at the last
 * millisecond of the IST day.
 */
describe("getISTDayEndUtc", () => {
  it("ends the IST day at 23:59:59.999 IST, even when read in the small hours", () => {
    const at0100IST = new Date("2026-10-20T19:30:00Z"); // 01:00 IST on 21 Oct
    expect(getISTDayEndUtc(at0100IST).toISOString()).toBe("2026-10-21T18:29:59.999Z");
  });

  it("keeps an invoice dated today (UTC midnight, 05:30 IST) inside the period", () => {
    const at0100IST = new Date("2026-10-20T19:30:00Z");
    const invoiceDate = new Date("2026-10-21T00:00:00Z");
    expect(invoiceDate.getTime()).toBeLessThanOrEqual(getISTDayEndUtc(at0100IST).getTime());
    expect(invoiceDate.getTime()).toBeGreaterThanOrEqual(getISTDayStartUtc(at0100IST).getTime());
  });
});
