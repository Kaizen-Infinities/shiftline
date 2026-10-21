import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct } from "../factories";

/**
 * H34: the daily plan's "Planned qty" lookup (GET product/:productId/machine/:machineId) failed
 * with "params.machineId expected string" because two chained validators each stripped the other's
 * params key, so the planned quantity never auto-filled from the product's capacity.
 */
const sfx = Date.now().toString(36).slice(-5);

describe("product capacity lookup by product and machine (H34)", () => {
  let OWNER: { auth: Record<string, string> };
  let productId: number;
  const machineId = `CAP-M-${sfx}`;

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const product = await createProduct();
    productId = Number(product.id);

    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.productCapacityHistory.create({
        data: {
          productId: product.id,
          previousCapacity: 0,
          newCapacity: 120,
          productionDate: new Date("2020-02-10T00:00:00.000Z"),
          machineId,
          shiftId: "A",
          productionOrderId: `CAP-PO-${sfx}`,
          targetQty: 120,
          actualQty: 0,
          achievementPct: 0,
          updatedBy: null,
        },
      })
    );
  });

  it("returns the latest capacity for the product and machine", async () => {
    const res = await (
      await api()
    )
      .get(`/api/product-capacity-history/product/${productId}/machine/${machineId}`)
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.machineId).toBe(machineId);
    expect(Number(res.body.data.newCapacity)).toBe(120);
  });

  it("returns no record, not an error, for a machine with no capacity set", async () => {
    const res = await (
      await api()
    )
      .get(`/api/product-capacity-history/product/${productId}/machine/NO-SUCH-${sfx}`)
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("rejects a non-numeric product id", async () => {
    const res = await (
      await api()
    )
      .get(`/api/product-capacity-history/product/abc/machine/${machineId}`)
      .set(OWNER.auth);
    expect(res.status).toBe(400);
  });

  it("rejects a machine id longer than the machine code column", async () => {
    const res = await (
      await api()
    )
      .get(`/api/product-capacity-history/product/${productId}/machine/${"M".repeat(21)}`)
      .set(OWNER.auth);
    expect(res.status).toBe(400);
  });
});
