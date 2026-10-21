import { describe, expect, it } from "vitest";

import { dashboardAccess } from "./dashboardAccess";

/** SET-B07: a role with no dashboard keys made 15-30 requests that all answered 403. */
const roleWith = (...keys: string[]) => {
  const granted = new Set(keys);
  return (...wanted: string[]) => wanted.some((k) => granted.has(k));
};

describe("dashboardAccess", () => {
  it("requests nothing for a role with no dashboard or books keys", () => {
    const access = dashboardAccess(roleWith("sales-orders.view", "customers.view"));
    expect(access).toEqual({
      summary: false,
      accounts: false,
      fieldPositions: false,
      payroll: false,
      shifts: false,
    });
  });

  it("opens the summary for any single widget key", () => {
    expect(dashboardAccess(roleWith("dash-tasks.view")).summary).toBe(true);
    expect(dashboardAccess(roleWith("dash-machines.view")).summary).toBe(true);
  });

  it("opens the accounts summary for the books, not for a widget alone", () => {
    expect(dashboardAccess(roleWith("vouchers.view")).accounts).toBe(true);
    expect(dashboardAccess(roleWith("dash-overview.view")).accounts).toBe(false);
  });

  it("gates positions, payroll and shifts on their own keys", () => {
    expect(dashboardAccess(roleWith("mobile-app.manage")).fieldPositions).toBe(true);
    expect(dashboardAccess(roleWith("payroll-advance.view")).payroll).toBe(true);
    expect(dashboardAccess(roleWith("shifts.view")).shifts).toBe(true);
    expect(dashboardAccess(roleWith("shifts.create")).shifts).toBe(false);
  });

  it("grants everything to a super admin", () => {
    expect(dashboardAccess(() => true)).toEqual({
      summary: true,
      accounts: true,
      fieldPositions: true,
      payroll: true,
      shifts: true,
    });
  });
});
