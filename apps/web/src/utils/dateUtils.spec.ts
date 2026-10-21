import { describe, expect, it } from "vitest";
import { todayIstDate } from "./dateUtils";

/**
 * INV-B09: default dates came from the UTC date, so between midnight and 05:30 IST the form
 * showed yesterday. The default is the IST calendar date.
 */
describe("todayIstDate", () => {
  it("gives the IST date after midnight IST, when UTC is still the day before", () => {
    // 21:30 UTC on 17 Oct is 03:00 IST on 18 Oct.
    expect(todayIstDate(new Date("2026-10-17T21:30:00Z"))).toBe("2026-10-18");
  });

  it("gives the same date during the IST day", () => {
    expect(todayIstDate(new Date("2026-10-18T06:00:00Z"))).toBe("2026-10-18");
  });
});
