import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { foreignTenant } from "../helpers/foreign-tenant";
import { limitedUser } from "../helpers/limited-user";
import { createCustomer } from "../factories";

/**
 * Dashboard (R-01): `/summary` opens to any dashboard widget key, `/accounts-summary` (bank and
 * cash balances, receivables) needs `accounts.view` or `vouchers.view`, and `/tv-summary` needs
 * `insights.view`. The endpoints take no body and `period` is a free query value that falls back
 * to "year", so there is no validation rejection to prove beyond the auth gate and the fallback.
 */
const sfx = Date.now().toString(36).slice(-6);

let OWNER: { auth: Record<string, string> };

describe("dashboard", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("answers all three endpoints for the owner", async () => {
    const client = await api();
    const summary = await client.get("/api/dashboard/summary").set(OWNER.auth);
    expect(summary.status, JSON.stringify(summary.body).slice(0, 300)).toBe(200);
    expect(summary.body.data).toMatchObject({
      salesOrders: expect.any(Array),
      customers: expect.any(Array),
      machines: expect.any(Array),
    });

    const accounts = await client.get("/api/dashboard/accounts-summary").set(OWNER.auth);
    expect(accounts.status, JSON.stringify(accounts.body).slice(0, 300)).toBe(200);
    expect(accounts.body.data).toMatchObject({
      totalSales: expect.any(Number),
      totalReceivable: expect.any(Number),
    });

    const tv = await client.get("/api/dashboard/tv-summary").set(OWNER.auth);
    expect(tv.status, JSON.stringify(tv.body).slice(0, 300)).toBe(200);
  });

  it("keeps the seeded roles working: each sees what its widgets and books allow", async () => {
    const client = await api();
    // role -> [summary, accounts-summary, tv-summary]
    const expected: Record<string, [number, number, number]> = {
      "demo.accounts": [200, 200, 200],
      "demo.stores": [200, 403, 403],
      "demo.production": [200, 403, 200],
      "demo.sales": [200, 403, 200],
      "demo.auditor": [200, 200, 403],
    };
    for (const [user, [s, a, t]] of Object.entries(expected)) {
      const { auth } = await authed(user);
      const got = [
        (await client.get("/api/dashboard/summary").set(auth)).status,
        (await client.get("/api/dashboard/accounts-summary").set(auth)).status,
        (await client.get("/api/dashboard/tv-summary").set(auth)).status,
      ];
      expect(got, user).toEqual([s, a, t]);
    }
  });

  it("refuses the anonymous and a user with no dashboard permission, with clean errors", async () => {
    const client = await api();
    for (const path of ["summary", "accounts-summary", "tv-summary"]) {
      expect((await client.get(`/api/dashboard/${path}`)).status, path).toBe(401);
    }
    const none = await limitedUser(`dashnone${sfx}`, ["profile.view"]);
    for (const path of ["summary", "accounts-summary", "tv-summary"]) {
      const res = await client.get(`/api/dashboard/${path}`).set(none.auth);
      expect(res.status, path).toBe(403);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|SELECT |\.ts:\d/i);
    }
  });

  it("gates accounts-summary on the books, not on a dashboard widget", async () => {
    const client = await api();
    const widgetOnly = await limitedUser(`dashwidget${sfx}`, ["dash-overview.view"]);
    expect((await client.get("/api/dashboard/summary").set(widgetOnly.auth)).status).toBe(200);
    expect((await client.get("/api/dashboard/accounts-summary").set(widgetOnly.auth)).status).toBe(
      403
    );
    const books = await limitedUser(`dashbooks${sfx}`, ["accounts.view"]);
    expect((await client.get("/api/dashboard/accounts-summary").set(books.auth)).status).toBe(200);
    expect((await client.get("/api/dashboard/summary").set(books.auth)).status).toBe(403);
  });

  it("treats an unknown period as the default year instead of failing", async () => {
    const client = await api();
    const bad = await client
      .get("/api/dashboard/accounts-summary")
      .query({ period: "not-a-period" })
      .set(OWNER.auth);
    const year = await client
      .get("/api/dashboard/accounts-summary")
      .query({ period: "year" })
      .set(OWNER.auth);
    expect(bad.status).toBe(200);
    expect(bad.body.data.totalSales).toBe(year.body.data.totalSales);
  });

  it("never shows another tenant's rows", async () => {
    const customer = await createCustomer({ firmName: `Dash Visible ${sfx}` });
    const foreign = await foreignTenant(`dash${sfx.slice(0, 4)}`);
    const client = await api();

    const demo = await client.get("/api/dashboard/summary").set(OWNER.auth);
    expect(JSON.stringify(demo.body.data.customers)).toContain(customer.customerCode);

    const other = await client.get("/api/dashboard/summary").set(foreign.auth);
    expect(other.status).toBe(200);
    expect(JSON.stringify(other.body.data)).not.toContain(customer.customerCode);
    expect(JSON.stringify(other.body.data)).not.toContain("Dash Visible");

    const accounts = await client.get("/api/dashboard/accounts-summary").set(foreign.auth);
    expect(accounts.status).toBe(200);
    expect(JSON.stringify(accounts.body.data)).not.toContain("Dash Visible");
    const tv = await client.get("/api/dashboard/tv-summary").set(foreign.auth);
    expect(tv.status).toBe(200);
    expect(JSON.stringify(tv.body.data)).not.toContain("Dash Visible");
  });
});
