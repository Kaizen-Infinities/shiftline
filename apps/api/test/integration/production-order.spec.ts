import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct, createRawMaterial } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { byCode } from "../../src/lib/prisma";

/**
 * Production orders (Phase 2-T characterisation, section 4): the shop-floor document nothing
 * currently tests. Its status machine is CREATED → READY_FOR_PLANNING/WAITING_FOR_MATERIAL →
 * WEEKLY_SCHEDULED → DAILY_PLANNED → IN_PRODUCTION → POST_PRODUCTION → READY_FOR_DISPATCH →
 * DISPATCHED, gated by a `VALID_TRANSITIONS` map — but the generic PUT that drives most of it
 * turns out to have a real trap: `updateProductionOrderSchema`'s body is `.partial()`, and
 * several of its fields (`priority`, `orderType`, `rawMaterials`, `producedQty`, `rejectedQty`,
 * `scrapQty`) carry `.optional().default(...)`. Zod applies that default whenever the key is
 * simply absent, so a client that PUTs only `{ status }` gets those fields silently populated
 * anyway — `update()` then copies them straight onto the row (or, once the order is "locked",
 * uses their mere presence to refuse the request outright). Both effects are characterized
 * below rather than fixed. Reaching DISPATCHED belongs to the goods-dispatch module (a sibling
 * characterisation task) and reaching POST_PRODUCTION for real belongs to daily-production-plan
 * / hourly-production, so this suite stops at what production-order's own endpoints can reach.
 */
const sfx = Date.now().toString(36).slice(-6);
const n = (v: unknown) => Number(v);

const orderPayload = (over: Record<string, unknown> = {}) => ({
  orderDate: "2026-09-01T00:00:00.000Z",
  dueDate: "2026-09-10T00:00:00.000Z",
  targetQty: 100,
  uom: "PCS",
  ...over,
});

let OWNER: { auth: Record<string, string> };

describe("production orders", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("creates an order, reaches IN_PRODUCTION, and hits the PUT-is-locked-forever trap", async () => {
    const client = await api();
    const product = await createProduct();
    const rm = await createRawMaterial(); // onHandQty 500 by factory default
    const poId = `PO-${sfx}-A`;

    const create = await client
      .post("/api/production-orders")
      .set(OWNER.auth)
      .send(
        orderPayload({
          productionOrderId: poId,
          productItemId: product.id.toString(),
          rawMaterials: [
            { rawMaterialId: rm.rawMaterialId, requiredQty: 50, uom: "KG", storeId: "ST-RM" },
          ],
        })
      );
    expect(create.status, JSON.stringify(create.body).slice(0, 300)).toBe(201);
    // create() always inserts with status CREATED, then immediately runs the same material
    // check the dedicated /check-materials endpoint runs — the response already reflects that,
    // not the just-inserted CREATED row.
    expect(create.body.data.productionOrderId).toBe(poId);
    expect(create.body.data.status).toBe("READY_FOR_PLANNING");

    // Weekly/daily scheduling has no dedicated step endpoint in this module; PUT drives the
    // status machine directly, gated by VALID_TRANSITIONS.
    const toWeekly = await client
      .put(`/api/production-orders/${poId}`)
      .set(OWNER.auth)
      .send({ status: "WEEKLY_SCHEDULED" });
    expect(toWeekly.status, JSON.stringify(toWeekly.body).slice(0, 300)).toBe(200);
    expect(toWeekly.body.data.status).toBe("WEEKLY_SCHEDULED");

    const prisma = await getPrisma();
    const wiped = await asDemoTenant(() =>
      prisma.productionOrder.findUniqueOrThrow({ where: byCode("productionOrderId", poId) })
    );
    // The rawMaterials the order was created with are gone. `rawMaterials` in the update schema
    // defaults to `[]` when the key is absent, and update() copies whatever it parses straight
    // onto draftRawMaterials — a caller that only meant to change the status has just cleared
    // the material plan.
    expect(wiped.draftRawMaterials).toEqual([]);

    // No dailyPlanId given, so this would otherwise issue the full draft quantity — but there is
    // no draft left to issue.
    const start = await client
      .post(`/api/production-orders/${poId}/start-production`)
      .set(OWNER.auth)
      .send({});
    expect(start.status, JSON.stringify(start.body).slice(0, 300)).toBe(200);
    expect(start.body.data.status).toBe("IN_PRODUCTION");

    // With nothing left to issue, start-production takes its "nothing configured" branch: no
    // stock adjustment, no stock movement, at all.
    const rmAfter = await asDemoTenant(() =>
      prisma.rawMaterial.findFirstOrThrow({ where: { rawMaterialId: rm.rawMaterialId } })
    );
    expect(n(rmAfter.onHandQty)).toBe(500);
    expect(
      await asDemoTenant(() => prisma.stockAdjustment.count({ where: { productionOrderId: poId } }))
    ).toBe(0);

    // IN_PRODUCTION is "locked": update() means to allow status/producedQty/rejectedQty/
    // scrapQty/remarks only from here on. But the same defaults strike again — priority,
    // orderType and rawMaterials are always present in the parsed body — so the lock check now
    // runs the other way: it refuses ANY PUT at all, even a same-shape `{ status:
    // "POST_PRODUCTION" }` that VALID_TRANSITIONS would otherwise allow. In the shipped code,
    // once an order is locked the generic PUT can never move it again.
    const blocked = await client
      .put(`/api/production-orders/${poId}`)
      .set(OWNER.auth)
      .send({ status: "POST_PRODUCTION" });
    expect(blocked.status, JSON.stringify(blocked.body).slice(0, 300)).toBe(400);
    expect(blocked.body.message).toMatch(/locked for editing/);

    // Reaching POST_PRODUCTION for real goes through daily-production-plan / hourly-production,
    // which write the status directly and are out of this module's scope. Simulate that one
    // write so /complete-post-production — which IS this module's own endpoint — can be
    // exercised.
    await asDemoTenant(() =>
      prisma.productionOrder.update({
        where: byCode("productionOrderId", poId),
        data: { status: "POST_PRODUCTION" },
      })
    );

    const complete = await client
      .post(`/api/production-orders/${poId}/complete-post-production`)
      .set(OWNER.auth)
      .send({ producedQty: 95 });
    expect(complete.status, JSON.stringify(complete.body).slice(0, 300)).toBe(200);
    expect(complete.body.data.status).toBe("READY_FOR_DISPATCH");
    expect(n(complete.body.data.producedQty)).toBe(95);

    const history = await client.get(`/api/production-orders/${poId}/history`).set(OWNER.auth);
    expect(history.status).toBe(200);
    const actions = (history.body.data as { action: string | null }[]).map((h) => h.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "CREATE",
        "MATERIAL_CHECK",
        "STATUS_CHANGE",
        "PRODUCTION_START",
        "POST_PRODUCTION_COMPLETE",
      ])
    );
  });

  it("issues draft raw materials proportionally on start-production when the plan survives the PUT", async () => {
    const client = await api();
    const product = await createProduct();
    const rm = await createRawMaterial();
    const poId = `PO-${sfx}-B`;
    const rawMaterials = [
      { rawMaterialId: rm.rawMaterialId, requiredQty: 50, uom: "KG", storeId: "ST-RM" },
    ];

    const create = await client
      .post("/api/production-orders")
      .set(OWNER.auth)
      .send(
        orderPayload({
          productionOrderId: poId,
          productItemId: product.id.toString(),
          rawMaterials,
        })
      );
    expect(create.status, JSON.stringify(create.body).slice(0, 300)).toBe(201);
    expect(create.body.data.status).toBe("READY_FOR_PLANNING");

    // Resending the same rawMaterials on the PUT is the only way to survive the default-wipe
    // characterized above.
    const toWeekly = await client
      .put(`/api/production-orders/${poId}`)
      .set(OWNER.auth)
      .send({ status: "WEEKLY_SCHEDULED", rawMaterials });
    expect(toWeekly.status, JSON.stringify(toWeekly.body).slice(0, 300)).toBe(200);

    const start = await client
      .post(`/api/production-orders/${poId}/start-production`)
      .set(OWNER.auth)
      .send({});
    expect(start.status, JSON.stringify(start.body).slice(0, 300)).toBe(200);
    expect(start.body.data.status).toBe("IN_PRODUCTION");

    // Stock actually deducted, a stock adjustment raised, and a raw material transaction
    // posted — this is the only place in the module that touches inventory. No dailyPlanId was
    // given, so the shift ratio is 1 and the full 50 is issued with no UOM conversion (unlike the
    // manual /issue-materials endpoint, which does convert).
    const prisma = await getPrisma();
    const rmAfter = await asDemoTenant(() =>
      prisma.rawMaterial.findFirstOrThrow({ where: { rawMaterialId: rm.rawMaterialId } })
    );
    expect(n(rmAfter.onHandQty)).toBe(450);

    const adjustment = await asDemoTenant(() =>
      prisma.stockAdjustment.findFirstOrThrow({
        where: { productionOrderId: poId, adjustmentType: "RAW_MATERIAL_ISSUE" },
        include: { items: true },
      })
    );
    expect(adjustment.items).toHaveLength(1);
    expect(n(adjustment.items[0].difference)).toBe(-50);

    const rmTxn = await asDemoTenant(() =>
      prisma.rawMaterialTransaction.findFirstOrThrow({
        where: { productionOrderId: poId, txnType: "RAW_MATERIAL_ISSUE" },
      })
    );
    expect(n(rmTxn.qty)).toBe(-50);
  });

  it("rejects a duplicate production order code", async () => {
    const client = await api();
    const product = await createProduct();
    const poId = `PO-${sfx}-DUP`;
    const payload = orderPayload({ productionOrderId: poId, productItemId: product.id.toString() });

    const first = await client.post("/api/production-orders").set(OWNER.auth).send(payload);
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(201);

    const second = await client.post("/api/production-orders").set(OWNER.auth).send(payload);
    expect(second.status).toBe(409);
  });

  it("rejects a due date before the order date", async () => {
    const client = await api();
    const product = await createProduct();
    const res = await client
      .post("/api/production-orders")
      .set(OWNER.auth)
      .send(
        orderPayload({
          productionOrderId: `PO-${sfx}-BADDATE`,
          productItemId: product.id.toString(),
          orderDate: "2026-09-10T00:00:00.000Z",
          dueDate: "2026-09-01T00:00:00.000Z",
        })
      );
    expect(res.status).toBe(400);
  });

  it("rejects a status jump the transition map does not allow", async () => {
    const client = await api();
    const product = await createProduct();
    const poId = `PO-${sfx}-JUMP`;
    const create = await client
      .post("/api/production-orders")
      .set(OWNER.auth)
      .send(orderPayload({ productionOrderId: poId, productItemId: product.id.toString() }));
    expect(create.status).toBe(201);
    // No BOM and no draft raw materials at all: the availability check loops over nothing, "all
    // of zero materials" trivially counts as available, so the order still moves straight to
    // READY_FOR_PLANNING rather than staying at CREATED or going to WAITING_FOR_MATERIAL.
    expect(create.body.data.status).toBe("READY_FOR_PLANNING");

    // READY_FOR_PLANNING (not yet locked) may only go to WAITING_FOR_MATERIAL, WEEKLY_SCHEDULED
    // or CANCELLED — this is the ordinary VALID_TRANSITIONS rejection, distinct from the
    // locked-status one above.
    const jump = await client
      .put(`/api/production-orders/${poId}`)
      .set(OWNER.auth)
      .send({ status: "DISPATCHED" });
    expect(jump.status, JSON.stringify(jump.body).slice(0, 300)).toBe(400);
    expect(jump.body.message).toMatch(/Invalid status transition/);
  });

  it("refuses a role without the permission, and hides another tenant's production orders", async () => {
    const client = await api();
    // The Production/Supervisor role is the one that would be expected to own this module, but
    // ROLE_DEFS grants it "production-orders" (hyphen) while the permission registry's module
    // key is "production_orders" (underscore) — provisioning.service.ts's keysFor() never
    // matches the two, so this role is provisioned with no production_orders.* permission at
    // all today. Characterized as-is, not fixed.
    const supervisor = await authed("demo.production");
    expect((await client.get("/api/production-orders").set(supervisor.auth)).status).toBe(403);

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "PO Tenant B", companyCode: `POB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.productionOrder.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.productionOrder.count())).toBeGreaterThan(0);
  });
});
