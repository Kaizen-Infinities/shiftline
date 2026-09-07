import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { runAsTenant } from "../../src/lib/tenant-context";
import { insightsService, resetInsightsCache } from "../../src/modules/insights/insights.service";

/**
 * Insights API (P1-05, B3): read-only aggregations behind `insights.view`, cached 60 seconds
 * per tenant and endpoint, never mixing tenants.
 */
const ENDPOINTS = ["summary", "accounts", "ageing", "field-team", "plant", "attention"] as const;

describe("insights", () => {
  it("answers every endpoint for a permitted user and caches the second call", async () => {
    resetInsightsCache();
    const owner = await authed("demo.owner");
    const client = await api();
    for (const name of ENDPOINTS) {
      const first = await client.get(`/api/v1/insights/${name}`).set(owner.auth);
      expect(first.status, `${name}: ${JSON.stringify(first.body)}`).toBe(200);
      expect(first.headers["x-cache"]).toBe("MISS");
      expect(first.headers["cache-control"]).toMatch(/^private, max-age=\d+$/);
      const second = await client.get(`/api/v1/insights/${name}`).set(owner.auth);
      expect(second.status).toBe(200);
      expect(second.headers["x-cache"]).toBe("HIT");
      expect(second.body.data).toEqual(first.body.data);
    }

    const summary = (await client.get("/api/v1/insights/summary").set(owner.auth)).body.data;
    expect(summary).toMatchObject({
      sales: expect.any(Object),
      production: { planned: expect.any(Number), produced: expect.any(Number) },
      finance: { receivable: expect.any(Number) },
      alerts: expect.any(Array),
    });
    const accounts = (await client.get("/api/v1/insights/accounts").set(owner.auth)).body.data;
    expect(accounts.cashAndBank.total).toEqual(expect.any(Number));
    expect(accounts.receivable).toMatchObject({
      total: expect.any(Number),
      parties: expect.any(Number),
    });
    const ageing = (await client.get("/api/v1/insights/ageing").set(owner.auth)).body.data;
    expect(ageing.buckets.length).toBeGreaterThan(0);
    expect(ageing.receivable.topOverdue.length).toBeLessThanOrEqual(5);
    const field = (await client.get("/api/v1/insights/field-team").set(owner.auth)).body.data;
    expect(field).toMatchObject({
      agentsLive: expect.any(Number),
      devices: { active: expect.any(Number) },
    });
    const plant = (await client.get("/api/v1/insights/plant").set(owner.auth)).body.data;
    expect(plant.productionOrders).toMatchObject({
      open: expect.any(Number),
      pastDue: expect.any(Number),
    });
    const attention = (await client.get("/api/v1/insights/attention").set(owner.auth)).body.data;
    for (const item of attention.items) {
      expect(["CRITICAL", "HIGH", "MEDIUM"]).toContain(item.level);
      expect(item.text).toEqual(expect.any(String));
    }
  });

  it("refuses users without insights.view and the anonymous", async () => {
    const stores = await authed("demo.stores");
    const client = await api();
    expect((await client.get("/api/v1/insights/summary").set(stores.auth)).status).toBe(403);
    expect((await client.get("/api/v1/insights/summary")).status).toBe(401);
  });

  it("caches per tenant: another tenant never gets the demo tenant's cached answer", async () => {
    resetInsightsCache();
    const owner = await authed("demo.owner");
    const client = await api();
    const demo = (await client.get("/api/v1/insights/summary").set(owner.auth)).body.data;
    expect(demo.inventory.skuTotal).toBeGreaterThan(0);
    // A tenant with no rows: an empty summary and a cache miss of its own.
    const other = await runAsTenant(randomUUID(), () => insightsService.summary());
    expect(other.hit).toBe(false);
    expect(other.value.inventory.skuTotal).toBe(0);
    expect(other.value.finance.receivable).toBe(0);
  });
});
