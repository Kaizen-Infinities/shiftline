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
 * DISPATCHED, gated by a `VALID_TRANSITIONS` map. Reaching DISPATCHED belongs to the
 * goods-dispatch module (a sibling characterisation task) and reaching POST_PRODUCTION for real
 * belongs to daily-production-plan / hourly-production, so this suite stops at what
 * production-order's own endpoints can reach.
 *
 * `updateProductionOrderSchema`'s body is `.partial()`, and several of its fields (`priority`,
 * `orderType`, `rawMaterials`, `producedQty`, `rejectedQty`, `scrapQty`, `status`) used to carry
 * `.optional().default(...)` — Zod applies a default whenever the key is simply absent, so a
 * bare `PUT { status }` got those fields silently populated anyway, wiping `draftRawMaterials`
 * to `[]` and, once the order reached a "locked" status, making the lock check's allow-list
 * always fail. Fixed by dropping `.default()` from those fields (P2T-04 bug #4): `create()`
 * already had its own explicit fallbacks (`?? "MEDIUM"`, hardcoded zeros, etc.) so its behaviour
 * is unchanged; `update()` now sees `undefined` for a key the caller never sent, exactly as its
 * own `!== undefined` checks always assumed.
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

  it("creates an order, reaches IN_PRODUCTION, and a bare status PUT no longer wipes its material plan or gets locked out", async () => {
    const client = await api();
    const product = await createProduct();
    const rm = await createRawMaterial(); // onHandQty 500 by factory default
    const poId = `PO-${sfx}-A`;
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
    const afterPut = await asDemoTenant(() =>
      prisma.productionOrder.findUniqueOrThrow({ where: byCode("productionOrderId", poId) })
    );
    // Fixed (P2T-04 bug #4): `rawMaterials` is no longer defaulted to `[]` when the key is
    // absent from the PUT body, so a caller that only meant to change the status keeps the
    // material plan it was created with.
    expect(afterPut.draftRawMaterials).toEqual(rawMaterials);

    // No dailyPlanId given, so the full draft quantity is issued at ratio 1.
    const start = await client
      .post(`/api/production-orders/${poId}/start-production`)
      .set(OWNER.auth)
      .send({});
    expect(start.status, JSON.stringify(start.body).slice(0, 300)).toBe(200);
    expect(start.body.data.status).toBe("IN_PRODUCTION");

    const rmAfter = await asDemoTenant(() =>
      prisma.rawMaterial.findFirstOrThrow({ where: { rawMaterialId: rm.rawMaterialId } })
    );
    expect(n(rmAfter.onHandQty)).toBe(450);
    const adjustment = await asDemoTenant(() =>
      prisma.stockAdjustment.findFirstOrThrow({
        where: { productionOrderId: poId, adjustmentType: "RAW_MATERIAL_ISSUE" },
      })
    );
    // The legacy (no dailyPlanId) path stamps sourceDocId with the production order's own id
    // (P2T-04 bug #5a — the idempotency guard below relies on this).
    expect(adjustment.sourceDocId).toBe(poId);

    // IN_PRODUCTION is "locked": update() only allows status/producedQty/rejectedQty/scrapQty/
    // remarks from here on. A real edit to any other field is still correctly refused...
    const rejectedEdit = await client
      .put(`/api/production-orders/${poId}`)
      .set(OWNER.auth)
      .send({ priority: "HIGH" });
    expect(rejectedEdit.status, JSON.stringify(rejectedEdit.body).slice(0, 300)).toBe(400);
    expect(rejectedEdit.body.message).toMatch(/locked for editing/);

    // ...but fixed: a bare `{ status }` PUT now parses with only that key present, so the lock
    // check correctly treats it as a system status update and lets VALID_TRANSITIONS' own
    // IN_PRODUCTION -> POST_PRODUCTION allowance through — the generic PUT can move a locked
    // order again.
    const toPostProduction = await client
      .put(`/api/production-orders/${poId}`)
      .set(OWNER.auth)
      .send({ status: "POST_PRODUCTION" });
    expect(toPostProduction.status, JSON.stringify(toPostProduction.body).slice(0, 300)).toBe(200);
    expect(toPostProduction.body.data.status).toBe("POST_PRODUCTION");

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

  it("start-production is idempotent with no daily plan: a second call does not double-issue materials (P2T-04 bug #5a)", async () => {
    const client = await api();
    const product = await createProduct();
    const rm = await createRawMaterial();
    const poId = `PO-${sfx}-IDEMPOTENT`;
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

    // start-production only accepts orders already scheduled; move it there first.
    const toWeekly = await client
      .put(`/api/production-orders/${poId}`)
      .set(OWNER.auth)
      .send({ status: "WEEKLY_SCHEDULED" });
    expect(toWeekly.status, JSON.stringify(toWeekly.body).slice(0, 300)).toBe(200);

    const first = await client
      .post(`/api/production-orders/${poId}/start-production`)
      .set(OWNER.auth)
      .send({});
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);
    expect(first.body.data.status).toBe("IN_PRODUCTION");

    // Fixed: the idempotency guard now matches the sourceDocId the first call actually wrote
    // (the production order id, not null), so this second call takes the early-return branch
    // instead of issuing the materials again.
    const second = await client
      .post(`/api/production-orders/${poId}/start-production`)
      .set(OWNER.auth)
      .send({});
    expect(second.status, JSON.stringify(second.body).slice(0, 300)).toBe(200);
    expect(second.body.data.status).toBe("IN_PRODUCTION");

    const prisma = await getPrisma();
    const rmAfter = await asDemoTenant(() =>
      prisma.rawMaterial.findFirstOrThrow({ where: { rawMaterialId: rm.rawMaterialId } })
    );
    expect(n(rmAfter.onHandQty)).toBe(450); // 50 deducted once, not twice
    expect(
      await asDemoTenant(() =>
        prisma.stockAdjustment.count({
          where: { productionOrderId: poId, adjustmentType: "RAW_MATERIAL_ISSUE" },
        })
      )
    ).toBe(1);
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

    // Resending the same rawMaterials on the PUT is redundant now that the plan survives a
    // bare status PUT (see the fixed test above), but still a valid, explicit way to set it.
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

  it("grants the Production/Supervisor role access, and hides another tenant's production orders", async () => {
    const client = await api();
    // Fixed (P2T-04 bug #1): ROLE_DEFS used to grant this role "production-orders" (hyphen)
    // while the permission registry's module key is "production_orders" (underscore) —
    // provisioning.service.ts's keysFor() never matched the two, so the seeded role held no
    // production_orders.* permission at all. Now that the module names agree, the role that was
    // always meant to own this module can reach it.
    const supervisor = await authed("demo.production");
    expect((await client.get("/api/production-orders").set(supervisor.auth)).status).toBe(200);

    const accounts = await authed("demo.accounts");
    expect((await client.get("/api/production-orders").set(accounts.auth)).status).toBe(403);

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
