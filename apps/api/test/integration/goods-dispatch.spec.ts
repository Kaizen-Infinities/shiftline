import { describe, expect, it, beforeAll } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoOwner, createProduct } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Characterisation tests for goods-dispatch (Phase 2-T, item 4).
 *
 * Despite the name, this is not a customer-facing dispatch: it is the internal
 * gate pass that moves finished goods from the shop floor to a store. Its
 * lifecycle is PENDING_GATE_APPROVAL -> (gate-approve) -> PENDING_STORE_RECEIPT
 * -> (store-receive) -> WAREHOUSE_RECEIVED, or GATE_REJECTED / STORE_REJECTED
 * at either approval step. `FinishedGoodsStock` is only ever *increased* here —
 * store-receipt is "the correct ERP point to create FG stock" per the code's
 * own comment — so this suite characterises today's inward stock effect ahead
 * of P2-08, which is scheduled to migrate stock movement.
 *
 * The module has no cancellation path at all: a rejected dispatch just sits in
 * GATE_REJECTED/STORE_REJECTED, and nothing reverses a WAREHOUSE_RECEIVED one.
 * There is also no "insufficient stock" guard to characterise — the only
 * quantity guard is at creation, against the production order's own pending
 * (produced-minus-already-dispatched) quantity, since this movement only ever
 * adds to store stock rather than depleting it.
 *
 * Numbering: `getNextDispatchNumber()` builds "GD-<year>-####" from
 * `findFirst(...).orderBy("desc")` on the tenant's own rows, not from
 * `documentNumberService.next()` as CLAUDE.md's convention calls for elsewhere
 * — characterised as found, not fixed.
 *
 * A second, more serious numbering bug (see the last store-receive test): the stock
 * adjustment this module raises on receipt gets its number from
 * `StockAdjustmentService.getNextAdjustmentNumber()`, called from *inside*
 * `storeReceive`'s own `prisma.$transaction(async (tx) => ...)` — but that helper queries
 * through the plain `prisma` export, not `tx`. Per CLAUDE.md's own rule ("inside a Prisma
 * interactive transaction, read through the tx client: the outer client does not carry the
 * tenant session settings there"), that query runs with no tenant context and — since the
 * extension's `ctx.inTx` check skips re-running `set_config` for it — never sees the demo
 * tenant's existing rows, so it always proposes the very first sequence number again. The
 * first store-receive of the (tenant, year) succeeds and claims that number for real; every
 * one after it collides on the same number and 409s. This is a real, load-bearing bug, not a
 * cosmetic one: characterised, not fixed, and confirmed independently by a sibling
 * characterisation agent hitting the identically-shaped bug in `oeeService`.
 *
 * Permissions oddity (see the last test): every route in this module is
 * gated on `production_orders.*`, not on the dedicated `goods-dispatch.*` key
 * that `packages/shared/src/permissions.ts` defines and that the seeded
 * STORES role is actually granted. Worse, the seed's PRODUCTION role's own
 * `production_orders`/`weekly_programs`/`daily-machine-planning`/
 * `hourly_productions`/`production-wastages` grants are built from
 * hyphen/underscore-mismatched module names in `ROLE_DEFS()`
 * (`apps/api/src/modules/platform/provisioning.service.ts`), so none of them
 * resolve against `PERMISSION_REGISTRY` and the demo PRODUCTION role ends up
 * with none of those keys either. Only OWNER (which grants every registry key
 * directly) actually holds `production_orders.*` among the seeded demo roles,
 * so it stands in for the acting role throughout this file; demo.stores —
 * named for this exact job and holding `goods-dispatch.*` — gets 403 on every
 * route here today.
 */
const sfx = Date.now().toString(36).slice(-6);
let poSeq = 0;
const nextPoId = () => `PO-GD-${sfx}-${++poSeq}`;

let OWNER: { auth: Record<string, string> };

const makeProductionOrder = async (
  productItemId: bigint,
  overrides: Record<string, unknown> = {}
) => {
  const prisma = await getPrisma();
  const owner = await demoOwner();
  return asDemoTenant(() =>
    prisma.productionOrder.create({
      data: {
        productionOrderId: nextPoId(),
        orderDate: new Date("2033-01-01"),
        dueDate: new Date("2033-01-10"),
        productItemId,
        targetQty: 100,
        uom: "NOS",
        status: "COMPLETED",
        producedQty: 100,
        createdBy: owner.userId,
        ...overrides,
      },
    })
  );
};

const baseBody = (overrides: Record<string, unknown> = {}) => ({
  dispatchDate: "2033-01-15",
  vehicleNumber: "TN01AB1234",
  driverName: "Test Driver",
  ...overrides,
});

const create = (body: Record<string, unknown>) =>
  api().then((c) => c.post("/api/goods-dispatches").set(OWNER.auth).send(body));

/**
 * A brand-new, single-use tenant with just enough of its own masters (a UOM, a finished-goods
 * store) to run a dispatch through `GoodsDispatchService` directly. Needed only for the two tests
 * below that depend on being the *very first* stock adjustment this tenant has ever raised: the
 * numbering bug documented above means `getNextAdjustmentNumber()` always proposes sequence one
 * regardless of what already exists, so on the long-lived, suite-wide demo tenant, whichever test
 * anywhere in the full run happens to raise the first stock adjustment of the year claims that
 * number for real and every other module's first attempt (this one included) collides with it.
 * Calling the service directly (not over HTTP) sidesteps needing a real login for a tenant with
 * no seeded users.
 */
const freshDispatchTenant = async () => {
  const prisma = await getPrisma();
  const company = await withoutTenant(() =>
    prisma.company.create({
      data: {
        companyName: "Goods Dispatch Isolated Co",
        companyCode: `GDISO${Date.now().toString(36).slice(-6).toUpperCase()}`,
        isActive: true,
      },
    })
  );
  const [nos, store] = await runAsTenant(company.id, () =>
    Promise.all([
      prisma.unitOfMeasure.create({ data: { uomCode: "NOS", uomName: "Numbers" } }),
      prisma.store.create({ data: { storeId: "ST-FG", storeName: "Finished Goods Store" } }),
    ])
  );
  return { companyId: company.id, nos, store };
};

let isoPoSeq = 0;
const makeIsoProductionOrder = async (
  companyId: string,
  productItemId: bigint,
  overrides: Record<string, unknown> = {}
) => {
  const prisma = await getPrisma();
  return runAsTenant(companyId, () =>
    prisma.productionOrder.create({
      data: {
        productionOrderId: `PO-GDISO-${sfx}-${++isoPoSeq}`,
        orderDate: new Date("2033-01-01"),
        dueDate: new Date("2033-01-10"),
        productItemId,
        targetQty: 100,
        uom: "NOS",
        status: "COMPLETED",
        producedQty: 100,
        ...overrides,
      },
    })
  );
};

describe("goods-dispatch (finished goods: shop floor to store, via gate + store receipt)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  // Because of the numbering bug documented above, only ONE store-receive can ever succeed per
  // (tenant, year) — a second one on the same tenant always 409s. This test runs on its own fresh,
  // single-use tenant (via freshDispatchTenant()) rather than the suite-wide demo tenant, so it is
  // reliably the tenant's first-ever adjustment regardless of what else this file, or any other
  // file in a full suite run, has already done to the demo tenant. It carries every
  // characterisation that needs a *successful* receipt (the stock effect and the item-left-out
  // default) at once, via two items on one dispatch; the later "second store-receipt" test proves
  // the failure directly, on its own separate fresh tenant with two dispatches of its own.
  //
  // A dispatch with no destination store anywhere (create()'s own guard requires a PO's
  // destinationStoreId, when it has one, to equal the dispatch's — so a dispatch can never mix a
  // store-backed item with a store-less one) still exists as a real path through storeReceive
  // (the `if (!storeId) continue` a few lines below the stock-adjustment header creation), but
  // proving it needs its own successful receipt, which this suite's numbering bug means it can
  // never have alongside this one. Characterised here in the docstring rather than in a test that
  // could never pass for reasons unrelated to what it means to prove.
  it("creates, gate-approves and store-receives a dispatch — the full stock effect, and an unlisted item still receiving in full", async () => {
    const prisma = await getPrisma();
    const { GoodsDispatchService } =
      await import("../../src/modules/goods-dispatch/goods-dispatch.service");
    const { companyId, nos, store } = await freshDispatchTenant();
    const userId = "test-user";

    const [productA, productB] = await runAsTenant(companyId, () =>
      Promise.all([
        prisma.product.create({
          data: { productCode: "PRD-A", productName: "Product A", uomId: nos.id, rate: 100 },
        }),
        prisma.product.create({
          data: { productCode: "PRD-B", productName: "Product B", uomId: nos.id, rate: 100 },
        }),
      ])
    );
    const poA = await makeIsoProductionOrder(companyId, productA.id, {
      producedQty: 40,
      targetQty: 40,
      destinationStoreId: store.storeId,
    });
    const poB = await makeIsoProductionOrder(companyId, productB.id, {
      producedQty: 4,
      targetQty: 4,
      destinationStoreId: store.storeId,
    });

    const dispatch = await runAsTenant(companyId, () =>
      GoodsDispatchService.create(
        {
          dispatchDate: "2033-01-15",
          vehicleNumber: "TN01AB1234",
          driverName: "Test Driver",
          destinationStoreId: store.storeId,
          items: [
            {
              productionOrderId: poA.productionOrderId,
              productItemId: String(productA.id),
              dispatchQty: 40,
              uom: "NOS",
            },
            {
              productionOrderId: poB.productionOrderId,
              productItemId: String(productB.id),
              dispatchQty: 4,
              uom: "NOS",
            },
          ],
        } as never,
        userId
      )
    );
    expect(dispatch.status).toBe("PENDING_GATE_APPROVAL");
    expect(dispatch.items).toHaveLength(2);
    const itemA = dispatch.items.find((i) => i.productItemId === productA.id);

    const gateApproved = await runAsTenant(companyId, () =>
      GoodsDispatchService.gateApprove(Number(dispatch.id), { action: "APPROVE" } as never, userId)
    );
    expect(gateApproved.status).toBe("PENDING_STORE_RECEIPT");

    // Only A is named, receiving 30 of the 40 dispatched; B is left out of receivedItems
    // entirely.
    const received = await runAsTenant(companyId, () =>
      GoodsDispatchService.storeReceive(
        Number(dispatch.id),
        {
          action: "APPROVE",
          receivedItems: [{ itemId: Number(itemA!.id), receivedQty: 30 }],
        } as never,
        userId
      )
    );
    expect(received.status).toBe("WAREHOUSE_RECEIVED");
    const gotA = received.items.find((i) => i.productItemId === productA.id);
    const gotB = received.items.find((i) => i.productItemId === productB.id);
    expect(Number(gotA!.receivedQty)).toBe(30);
    // Not 0: once *any* item is named, every unlisted item still falls back to its full
    // dispatchQty rather than being treated as "not received".
    expect(Number(gotB!.receivedQty)).toBe(4);

    await runAsTenant(companyId, async () => {
      const stockA = await prisma.finishedGoodsStock.findUnique({
        where: { storeId_productItemId: { storeId: store.storeId, productItemId: productA.id } },
      });
      const stockB = await prisma.finishedGoodsStock.findUnique({
        where: { storeId_productItemId: { storeId: store.storeId, productItemId: productB.id } },
      });
      expect(Number(stockA?.onHandQty)).toBe(30);
      // B was left out of receivedItems but still lands in full, at the store both items share.
      expect(Number(stockB?.onHandQty)).toBe(4);

      const txnA = await prisma.finishedGoodsTransaction.findFirst({
        where: { relatedDocNo: dispatch.dispatchNumber, productItemId: productA.id },
      });
      expect(txnA?.txnType).toBe("PRODUCTION_RECEIPT");
      expect(Number(txnA?.qty)).toBe(30);

      // Auto-generated and self-approved in the same step, by whoever received the goods —
      // there is no separate approval for this side-effect adjustment.
      const adjustment = await prisma.stockAdjustment.findFirst({
        where: { sourceDocId: dispatch.dispatchNumber },
        include: { items: true },
      });
      expect(adjustment?.sourceDocument).toBe("GOODS_DISPATCH");
      expect(adjustment?.status).toBe("APPROVED");
      expect(adjustment?.approvedBy).toBe(userId);
      expect(adjustment?.items).toHaveLength(2);
      const totalDifference = adjustment!.items.reduce((s, i) => s + Number(i.difference), 0);
      expect(totalDifference).toBe(34); // 30 + 4

      const updatedPoA = await prisma.productionOrder.findUnique({ where: { id: poA.id } });
      expect(updatedPoA?.status).toBe("DISPATCHED");
      const updatedPoB = await prisma.productionOrder.findUnique({ where: { id: poB.id } });
      expect(updatedPoB?.status).toBe("DISPATCHED");
      const history = await prisma.productionOrderHistory.findFirst({
        where: { productionOrderId: poA.productionOrderId, toStatus: "DISPATCHED" },
      });
      expect(history?.action).toBe("DISPATCH_COMPLETE");
    });
  });

  it("rejects an unknown production order and a quantity beyond what is pending", async () => {
    const product = await createProduct();
    const po = await makeProductionOrder(product.id, { producedQty: 5, targetQty: 5 });

    const missing = await create(
      baseBody({
        items: [
          {
            productionOrderId: "PO-DOES-NOT-EXIST",
            productItemId: String(product.id),
            dispatchQty: 1,
            uom: "NOS",
          },
        ],
      })
    );
    expect(missing.status).toBe(404);
    expect(missing.body.message).toMatch(/not found/i);

    const tooMuch = await create(
      baseBody({
        items: [
          {
            productionOrderId: po.productionOrderId,
            productItemId: String(product.id),
            dispatchQty: 10,
            uom: "NOS",
          },
        ],
      })
    );
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message).toMatch(/exceeds pending quantity/i);

    // Schema-level rejection: no items at all.
    const empty = await create(baseBody({ items: [] }));
    expect(empty.status).toBe(400);
    expect(JSON.stringify(empty.body)).toMatch(/at least one production order item/i);
  });

  it("lists an IN_PROGRESS order as eligible for dispatch, but refuses to create a dispatch against it (the listing and the create guard disagree)", async () => {
    const product = await createProduct();
    const po = await makeProductionOrder(product.id, {
      status: "IN_PROGRESS",
      producedQty: 20,
      targetQty: 50,
    });

    const eligible = await (
      await api()
    )
      .get("/api/goods-dispatches/eligible-orders")
      .set(OWNER.auth);
    expect(eligible.status).toBe(200);
    expect(
      (eligible.body.data as { productionOrderId: string }[]).some(
        (o) => o.productionOrderId === po.productionOrderId
      )
    ).toBe(true);

    const res = await create(
      baseBody({
        items: [
          {
            productionOrderId: po.productionOrderId,
            productItemId: String(product.id),
            dispatchQty: 5,
            uom: "NOS",
          },
        ],
      })
    );
    // create()'s own status allow-list omits IN_PROGRESS / IN_PRODUCTION / POST_PRODUCTION even
    // though getEligibleProductionOrders() (and its own comment) treat them as dispatchable.
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not eligible for dispatch/i);
  });

  it("a gate-rejected dispatch does not count against the order's dispatched quantity, so the same order can be dispatched again in full", async () => {
    const product = await createProduct();
    const po = await makeProductionOrder(product.id, { producedQty: 30, targetQty: 30 });
    const item = {
      productionOrderId: po.productionOrderId,
      productItemId: String(product.id),
      dispatchQty: 30,
      uom: "NOS",
    };

    const first = await create(baseBody({ items: [item] }));
    expect(first.status).toBe(201);
    await (
      await api()
    )
      .post(`/api/goods-dispatches/${first.body.data.id}/gate-approve`)
      .set(OWNER.auth)
      .send({ action: "REJECT", remarks: "wrong vehicle" });

    // The full 30 is still "pending" as far as create() is concerned.
    const second = await create(baseBody({ items: [item] }));
    expect(second.status, JSON.stringify(second.body).slice(0, 300)).toBe(201);
    expect(second.body.data.status).toBe("PENDING_GATE_APPROVAL");
  });

  it("a second store-receipt this tenant-year fails: getNextAdjustmentNumber() loses its tenant context inside this module's own transaction", async () => {
    // This is the numbering bug documented at the top of this file, demonstrated directly and
    // self-contained on its own fresh tenant (so it is the first-ever adjustment for that tenant
    // that succeeds, and the genuinely second one that collides — not dependent on suite order).
    // It is not specific to what either dispatch contains: a second store-receipt 409s regardless,
    // because the adjustment-number lookup made from inside storeReceive's own
    // prisma.$transaction never sees the tenant's existing rows and always proposes sequence one.
    const prisma = await getPrisma();
    const { GoodsDispatchService } =
      await import("../../src/modules/goods-dispatch/goods-dispatch.service");
    const { companyId, nos, store } = await freshDispatchTenant();
    const userId = "test-user";

    const makeDispatch = async (qty: number) => {
      const product = await runAsTenant(companyId, () =>
        prisma.product.create({
          data: {
            productCode: `PRD-${qty}`,
            productName: `Product ${qty}`,
            uomId: nos.id,
            rate: 100,
          },
        })
      );
      const po = await makeIsoProductionOrder(companyId, product.id, {
        producedQty: qty,
        targetQty: qty,
        destinationStoreId: store.storeId,
      });
      return runAsTenant(companyId, () =>
        GoodsDispatchService.create(
          {
            dispatchDate: "2033-01-15",
            vehicleNumber: "TN01AB1234",
            driverName: "Test Driver",
            destinationStoreId: store.storeId,
            items: [
              {
                productionOrderId: po.productionOrderId,
                productItemId: String(product.id),
                dispatchQty: qty,
                uom: "NOS",
              },
            ],
          } as never,
          userId
        )
      );
    };

    const first = await makeDispatch(8);
    await runAsTenant(companyId, () =>
      GoodsDispatchService.gateApprove(Number(first.id), { action: "APPROVE" } as never, userId)
    );
    const firstReceived = await runAsTenant(companyId, () =>
      GoodsDispatchService.storeReceive(Number(first.id), { action: "APPROVE" } as never, userId)
    );
    expect(firstReceived.status).toBe("WAREHOUSE_RECEIVED");

    const second = await makeDispatch(3);
    await runAsTenant(companyId, () =>
      GoodsDispatchService.gateApprove(Number(second.id), { action: "APPROVE" } as never, userId)
    );
    await expect(
      runAsTenant(companyId, () =>
        GoodsDispatchService.storeReceive(Number(second.id), { action: "APPROVE" } as never, userId)
      )
    ).rejects.toThrow();

    // The whole request rolled back cleanly rather than leaving anything half-applied: the
    // second dispatch is still exactly where it was before this call.
    const unchanged = await runAsTenant(companyId, () =>
      prisma.goodsDispatch.findUniqueOrThrow({ where: { id: BigInt(second.id) } })
    );
    expect(unchanged.status).toBe("PENDING_STORE_RECEIPT");
  });

  it("refuses both approval steps out of order", async () => {
    const product = await createProduct();
    const po = await makeProductionOrder(product.id, { producedQty: 5, targetQty: 5 });
    const created = await create(
      baseBody({
        items: [
          {
            productionOrderId: po.productionOrderId,
            productItemId: String(product.id),
            dispatchQty: 5,
            uom: "NOS",
          },
        ],
      })
    );
    const id = created.body.data.id;

    const tooEarly = await (
      await api()
    )
      .post(`/api/goods-dispatches/${id}/store-receive`)
      .set(OWNER.auth)
      .send({ action: "APPROVE" });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.message).toMatch(/cannot process store receipt/i);

    await (
      await api()
    )
      .post(`/api/goods-dispatches/${id}/gate-approve`)
      .set(OWNER.auth)
      .send({ action: "APPROVE" });

    const twice = await (
      await api()
    )
      .post(`/api/goods-dispatches/${id}/gate-approve`)
      .set(OWNER.auth)
      .send({ action: "APPROVE" });
    expect(twice.status).toBe(400);
    expect(twice.body.message).toMatch(/cannot gate-approve/i);
  });

  it("refuses a user without production_orders permission and hides another tenant's dispatches", async () => {
    const accounts = await authed("demo.accounts");
    const refused = await (await api()).get("/api/goods-dispatches").set(accounts.auth);
    expect(refused.status).toBe(403);

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Goods Dispatch Tenant B", companyCode: `GDB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.goodsDispatch.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.goodsDispatch.count())).toBeGreaterThan(0);
  });
});
