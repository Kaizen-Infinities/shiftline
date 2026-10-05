import { describe, expect, it } from "vitest";

import { addDays, todayIn, weekEnd, weekRange, weekStart } from "../src/week";

describe("week helper (Monday to Sunday, IST)", () => {
  it("Sunday belongs to the week that started the Monday before", () => {
    expect(weekRange("2026-10-04")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
  it("Monday starts a new week", () => {
    expect(weekRange("2026-10-05")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });
  it("reads an instant in IST, not UTC: Sunday 20:00 UTC is already Monday in Kolkata", () => {
    const sundayEveningUtc = new Date("2026-10-04T20:00:00Z"); // Mon 5 Oct 01:30 IST
    expect(weekStart(sundayEveningUtc)).toBe("2026-10-05");
    expect(weekStart(sundayEveningUtc, "UTC")).toBe("2026-09-28");
    expect(todayIn("Asia/Kolkata", sundayEveningUtc)).toBe("2026-10-05");
  });
  it("Monday 00:30 IST (Sunday 19:00 UTC) is not pulled back to Sunday", () => {
    expect(weekEnd(new Date("2026-10-04T19:00:00Z"))).toBe("2026-10-11");
  });
  it("accepts ISO timestamps and crosses month/year boundaries", () => {
    expect(weekStart("2026-10-07T00:00:00.000Z")).toBe("2026-10-05");
    expect(weekRange("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(addDays("2026-10-05", 6)).toBe("2026-10-11");
  });
});
