import { describe, expect, it, vi } from "vitest";

import { api, authed, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct, createRawMaterial } from "../factories";
import { getISTDateParts, getISTDateString } from "../../src/utils/dateUtils";

/**
 * Inventory module (P2-T characterisation) — apps/api/src/modules/inventory/.
 *
 * This module is entirely the EOD stock snapshot feature: `GET /api/inventory/eod-stock` (a
 * live "today" view plus a locked historical view) and its manual `POST .../run-now` trigger.
 * There is no stock-transaction-recording or adjustment endpoint in this module — those live in
 * the separate raw-material-transaction, finished-goods-transaction and stock-adjustment modules,
 * out of scope here. This suite seeds RawMaterialTransaction / FinishedGoodsStock /
 * FinishedGoodsTransaction rows directly (as their own services would) to characterise how
 * inventory.service.ts turns them into a stock view — the thing this module actually does.
 *
 * `apps/api/test/integration/jobs.spec.ts` already exercises the scheduled pg-boss EOD job
 * (`src/jobs/eod-snapshot.job.ts`, which wraps `runEodStockSnapshot` with a per-date skip guard).
 * Nothing here calls that job or `runEodStockSnapshot` directly; this file is the HTTP routes and
 * `inventory.service.ts`'s own `getEodStock` only, so the two suites don't overlap.
 *
 * RawMaterialTransaction has no batch/lot column yet (P2-08 adds one with a backfill later);
 * nothing here reads or writes one.
 */

const todayIstStr = () => getISTDateString();
const todayMidnightUtc = () => {
  const p = getISTDateParts();
  return new Date(Date.UTC(p.year, p.month, p.day));
};

let OWNER: { auth: Record<string, string> };

describe("inventory — EOD stock view and manual snapshot trigger", () => {
  it("today, raw material: reverses today's transactions off the live balance to get the opening qty", async () => {
    OWNER = await authed("demo.owner");
    const rm = await createRawMaterial(); // onHandQty defaults to 500
    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.rawMaterialTransaction.create({
        data: {
          storeId: "ST-RM",
          rawMaterialId: rm.rawMaterialId,
          txnType: "RECEIPT_GRN", // contains "RECEIPT" -> counted as an inward movement
          qty: 200,
        },
      })
    );

    const res = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: todayIstStr(), search: rm.rawMaterialId })
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);

    const row = res.body.data.find((r: any) => r.itemCode === rm.rawMaterialId);
    expect(row).toBeTruthy();
    expect(row.category).toBe("RAW_MATERIAL");
    expect(row.storeId).toBe("ST-RM");
    expect(row.uom).toBe("KG");
    // eodQty is always the live current balance while "today" is in view...
    expect(Number(row.eodQty)).toBe(500);
    // ...and startQty is worked backwards: 500 live minus the +200 received today.
    expect(Number(row.startQty)).toBe(300);
    // Never locked yet: the id is a synthetic placeholder, not a snapshot row id.
    expect(row.id).toBe(`temp-RAW_MATERIAL-${rm.rawMaterialId}-ST-RM`);
    expect(row.recordedAt).toBeNull();
  });

  it("counts a transaction from the first 5.5 hours of the IST day as today's, not dropped (regression: IST-midnight bug)", async () => {
    // getEodStock used to mark "today's start" as UTC midnight of the IST calendar day's own
    // date (`Date.UTC(year, month, day)` from getISTDateParts) rather than the real UTC instant
    // IST midnight falls at (IST is UTC+5:30, so real IST midnight is 18:30 UTC the *previous*
    // day) -- landing the marker 5.5 hours late. Any transaction in that gap (00:00-05:30 IST)
    // was silently excluded from "today's net change", so startQty came out equal to the live
    // qty as if nothing had moved. Pinned here with fixed, fake wall-clock times rather than
    // "now" so this doesn't depend on what time the suite happens to run.
    const rm = await createRawMaterial(); // onHandQty 500 by default
    const prisma = await getPrisma();
    const inventoryService = (await import("../../src/modules/inventory/inventory.service"))
      .default;

    // 2030-06-15T00:30:00+05:30 == 2030-06-14T19:00:00.000Z: inside the IST day 2030-06-15's
    // first 5.5 hours -- exactly the window the bug used to drop transactions from.
    const pinned = new Date("2030-06-14T19:00:00.000Z");
    const targetDate = new Date(Date.UTC(2030, 5, 15));

    await asDemoTenant(() =>
      prisma.rawMaterialTransaction.create({
        data: {
          storeId: "ST-RM",
          rawMaterialId: rm.rawMaterialId,
          txnType: "RECEIPT_GRN",
          qty: 200,
          txnDateTime: pinned,
        },
      })
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(pinned);
    try {
      const result = await asDemoTenant(() =>
        inventoryService.getEodStock({
          date: targetDate,
          search: rm.rawMaterialId,
          page: 1,
          limit: 20,
        })
      );
      const row = result.data.find((r: any) => r.itemCode === rm.rawMaterialId);
      expect(row).toBeTruthy();
      expect(Number(row.eodQty)).toBe(500);
      // 500 live minus the +200 received at 00:30 IST today reverses to an opening of 300.
      expect(Number(row.startQty)).toBe(300);
    } finally {
      vi.useRealTimers();
    }
  });

  it("omitting the date defaults to yesterday, not today — a snapshot-only view with no live fallback", async () => {
    const rm = await createRawMaterial();

    const withDate = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: todayIstStr(), search: rm.rawMaterialId })
      .set(OWNER.auth);
    expect(withDate.body.data.some((r: any) => r.itemCode === rm.rawMaterialId)).toBe(true);

    const noDate = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ search: rm.rawMaterialId })
      .set(OWNER.auth);
    expect(noDate.status).toBe(200);
    // No `date` -> the controller defaults to yesterday -> the locked-snapshot-only branch, which
    // never falls back to live data. A material created moments ago has no snapshot row for
    // yesterday, so — despite showing up "live" just above — it is invisible here.
    expect(noDate.body.data.some((r: any) => r.itemCode === rm.rawMaterialId)).toBe(false);
  });

  it("today, finished goods: same reversal, and a product with no stock row yet still appears, at zero", async () => {
    const product = await createProduct();
    const prisma = await getPrisma();
    await asDemoTenant(async () => {
      await prisma.finishedGoodsStock.create({
        data: { storeId: "ST-FG", productItemId: product.id, onHandQty: 100 },
      });
      await prisma.finishedGoodsTransaction.create({
        data: {
          storeId: "ST-FG",
          productItemId: product.id,
          txnType: "DISPATCH", // -> counted as an outward movement
          qty: 30,
          txnDateTime: new Date(),
        },
      });
    });

    const res = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: todayIstStr(), search: product.productCode })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: any) => r.itemCode === product.productCode);
    expect(row.category).toBe("FINISHED_PRODUCT");
    expect(Number(row.eodQty)).toBe(100);
    // 100 live plus the 30 dispatched today reverses to an opening of 130.
    expect(Number(row.startQty)).toBe(130);

    // A second product with no FinishedGoodsStock row at all still appears — at zero, store "DEFAULT".
    const bare = await createProduct();
    const res2 = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: todayIstStr(), search: bare.productCode })
      .set(OWNER.auth);
    const row2 = res2.body.data.find((r: any) => r.itemCode === bare.productCode);
    expect(row2.storeId).toBe("DEFAULT");
    expect(Number(row2.eodQty)).toBe(0);
    expect(Number(row2.startQty)).toBe(0);
  });

  it("a future date short-circuits to an empty page, with a pagination shape that differs from every other response", async () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const res = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: future.toISOString().split("T")[0] })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    // Odd but current: this branch's pagination object has no `totalPages` key at all, unlike
    // every other response from this endpoint (see the other tests), which always includes one.
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 0 });
    expect(res.body.pagination.totalPages).toBeUndefined();
  });

  it("run-now locks a snapshot for a past date, and running it again overwrites rather than skipping", async () => {
    const rm = await createRawMaterial({ onHandQty: 77 });
    const past = new Date();
    past.setDate(past.getDate() - 20);
    const dateStr = past.toISOString().split("T")[0];

    const first = await (
      await api()
    )
      .post("/api/inventory/eod-stock/run-now")
      .query({ date: dateStr })
      .set(OWNER.auth)
      .send({});
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);

    const get1 = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: dateStr, search: rm.rawMaterialId })
      .set(OWNER.auth);
    const row1 = get1.body.data.find((r: any) => r.itemCode === rm.rawMaterialId);
    expect(row1).toBeTruthy();
    expect(Number(row1.eodQty)).toBe(77);
    // No transactions fall in that historical window and no snapshot exists for the day before
    // it, so startQty just equals the live qty at the moment the job ran: re-running EOD for a
    // past date does not reconstruct that day's real opening balance, it snapshots today's live
    // onHandQty under that date's label.
    expect(Number(row1.startQty)).toBe(77);
    expect(row1.recordedAt).not.toBeNull();

    // Change the live balance and re-run for the *same* past date.
    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.rawMaterial.update({ where: { id: rm.id }, data: { onHandQty: 999 } })
    );
    const second = await (
      await api()
    )
      .post("/api/inventory/eod-stock/run-now")
      .query({ date: dateStr })
      .set(OWNER.auth)
      .send({});
    expect(second.status).toBe(200);

    const get2 = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: dateStr, search: rm.rawMaterialId })
      .set(OWNER.auth);
    const rows2 = get2.body.data.filter((r: any) => r.itemCode === rm.rawMaterialId);
    // Overwritten in place, not duplicated: still exactly one row for that item/date. Unlike the
    // scheduled pg-boss job (jobs.spec.ts), which skips a date it has already run, this manual
    // trigger has no such guard.
    expect(rows2).toHaveLength(1);
    expect(Number(rows2[0].eodQty)).toBe(999);
  });

  it("rejects a category outside the exact enum, a non-numeric page and an unparsable date", async () => {
    const lowerCase = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ category: "raw_material" }) // valid at the service layer's normCategory, not here
      .set(OWNER.auth);
    expect(lowerCase.status).toBe(400);
    expect(lowerCase.body.message).toBe("Validation failed");

    const plural = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ category: "RAW_MATERIALS" }) // an alias normCategory understands, but not the route schema
      .set(OWNER.auth);
    expect(plural.status).toBe(400);

    const badPage = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ page: "abc" })
      .set(OWNER.auth);
    expect(badPage.status).toBe(400);

    const badDate = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: "not-a-date" })
      .set(OWNER.auth);
    expect(badDate.status).toBe(400);
  });

  it("called directly (bypassing the route's Zod schema), the service's category aliases work and an unknown category is silently empty, not an error", async () => {
    // The HTTP route's query schema only accepts the three exact enum values (previous test), so
    // this alias/lenient-unknown-category behaviour in inventory.service.ts is unreachable from
    // the API today — only from a direct import, as here.
    const inventoryService = (await import("../../src/modules/inventory/inventory.service"))
      .default;
    const direct = await asDemoTenant(() =>
      inventoryService.getEodStock({
        date: todayMidnightUtc(),
        category: "RAW_MATERIALS", // plural alias
        page: 1,
        limit: 20,
      })
    );
    expect(direct.total).toBeGreaterThan(0);

    const bogus = await asDemoTenant(() =>
      inventoryService.getEodStock({
        date: todayMidnightUtc(),
        category: "NOT_A_CATEGORY",
        page: 1,
        limit: 20,
      })
    );
    expect(bogus).toEqual({ data: [], total: 0 });
  });

  it("an unmatched storeId is not a 404: this route has no by-id lookup, so it is simply an empty page", async () => {
    const res = await (
      await api()
    )
      .get("/api/inventory/eod-stock")
      .query({ date: todayIstStr(), storeId: "NOPE-DOES-NOT-EXIST", category: "RAW_MATERIAL" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("has no permission gate at all: unlike most modules, any authenticated role reaches it as long as the plan includes the feature", async () => {
    // This router is authMiddleware + requireFeature("inventory") only — no requirePermission —
    // so an auditor, who holds no inventory-reports permission, still gets a normal 200.
    const auditor = await authed("demo.auditor");
    const res = await (await api()).get("/api/inventory/eod-stock").set(auditor.auth);
    expect(res.status).toBe(200);
  });

  it("refuses when the tenant's inventory feature is switched off, and hides another tenant's snapshots", async () => {
    // The only refusal this router can produce is requireFeature's FEATURE_NOT_IN_PLAN (see the
    // no-permission-gate test above) — every plan tier includes "inventory", so a plain plan
    // difference can't trigger it; a platform override switching the feature off, same as
    // entitlements.spec.ts does for "production", is what actually exercises this 403.
    const sfx = Date.now().toString(36).slice(-6);
    const adminLogin = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: ADMIN.email, password: ADMIN.password });
    const admin = { Authorization: `Bearer ${adminLogin.body.data.accessToken}` };

    const created = await (
      await api()
    )
      .post("/api/platform/tenants")
      .set(admin)
      .send({
        companyCode: `INV${sfx.toUpperCase()}`,
        companyName: "Inventory Feature Test Co",
        slug: `inv-feat-${sfx}`,
        owner: { email: `owner.inv.${sfx}@test.example`, fullName: "Inv Owner" },
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const tenantId = created.body.data.company.id;

    const off = await (
      await api()
    )
      .put(`/api/platform/tenants/${tenantId}/overrides/inventory`)
      .set(admin)
      .send({ enabled: false, reason: "characterisation test" });
    expect(off.status, JSON.stringify(off.body)).toBe(200);

    const token = new URL(created.body.data.ownerInvitation.acceptUrl).searchParams.get("token")!;
    const accepted = await (
      await api()
    )
      .post(`/api/invitations/token/${token}/accept`)
      .send({ password: "InvOwner#2026!!" });
    const ownerAuth = { Authorization: `Bearer ${accepted.body.data.accessToken}` };

    const denied = await (await api()).get("/api/inventory/eod-stock").set(ownerAuth);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("FEATURE_NOT_IN_PLAN");

    // Cross-tenant isolation: a bare second tenant, with no EOD activity of its own, sees none of
    // the snapshot rows the earlier tests in this file locked for the demo tenant.
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Inventory Tenant B", companyCode: `INVB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.eodStockSnapshot.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.eodStockSnapshot.count())).toBeGreaterThan(0);
  });
});
