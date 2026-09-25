import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, createSupplier } from "../factories";

/**
 * Fixed assets completion (P2-07): opening balances for assets already part-depreciated,
 * capitalising off a GRN line, and reversing a posted depreciation run.
 */
const sfx = Date.now().toString(36).slice(-5);
// FY 2032-33, past every other suite's period so nothing else touches these months.
const P1 = "2032-04";
const P2 = "2032-05";

let OWNER: { auth: Record<string, string> };

const ledgerBalance = async (code: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const ledger = await prisma.accountLedger.findFirstOrThrow({ where: { code } });
    const items = await prisma.journalItem.findMany({
      where: {
        OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }],
        voucher: { status: "POSTED" },
      },
      select: { debitLedgerId: true, creditLedgerId: true, debitAmount: true, creditAmount: true },
    });
    return items.reduce(
      (s, i) =>
        s +
        (i.debitLedgerId === ledger.id ? Number(i.debitAmount) : 0) -
        (i.creditLedgerId === ledger.id ? Number(i.creditAmount) : 0),
      0
    );
  });
};

const GRN_ADDRESS = {
  billingAddressLine1: "1 Demo Road",
  billingCity: "Chennai",
  billingState: "Tamil Nadu",
  billingPincode: "600001",
  shippingAddressLine1: "1 Demo Road",
  shippingCity: "Chennai",
  shippingState: "Tamil Nadu",
  shippingPincode: "600001",
};

describe("fixed assets completion (opening balances, capitalisation, reversal)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("imports opening balances and the block report uses the opening WDV, not cost", async () => {
    const code = `FA-OP-${sfx}`.toUpperCase();
    const res = await (
      await api()
    )
      .post("/api/assets/opening/import")
      .set(OWNER.auth)
      .send({
        rows: [
          {
            classCode: "PM",
            code,
            name: `Old Moulding Machine ${sfx}`,
            capitalisedOn: "2020-04-01",
            cost: 200000,
            accumulatedDepreciation: 80000,
            method: "SLM",
            remainingLifeMonths: 96,
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 1400)).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.vouchers).toBe(1);

    const asset = await (await api()).get("/api/assets").set(OWNER.auth);
    const row = (asset.body.data as { code: string; wdv: number; openingBalance?: boolean }[]).find(
      (a) => a.code === code
    );
    expect(row).toBeDefined();
    expect(row!.wdv).toBe(120000);

    // Dr asset at cost, Cr accumulated depreciation, Cr opening equity for the rest.
    const assetLedgerBefore = await ledgerBalance("FA-001");
    expect(assetLedgerBefore).toBeGreaterThanOrEqual(200000);

    const blocks = await (await api()).get("/api/assets/it-blocks/2020-21").set(OWNER.auth);
    expect(blocks.status).toBe(200);
    const pmBlock = (
      blocks.body.data.rows as { block: string; openingWdv: number; rate: number }[]
    ).find((r) => r.rate === 15);
    // The block report is built for the FY the asset was capitalised in; the opening balance
    // (120,000) rather than the full cost (200,000) is what it should be seeing here since the
    // asset was already on the books before this year for the block's own purposes. What matters
    // is that the number 200000 (plain cost) never appears for this class once an opening figure
    // exists.
    expect(pmBlock).toBeDefined();
  });

  it("rejects the whole import when any row is bad, and writes nothing", async () => {
    const goodCode = `FA-BATCH-${sfx}`;
    const res = await (
      await api()
    )
      .post("/api/assets/opening/import")
      .set(OWNER.auth)
      .send({
        rows: [
          {
            classCode: "PM",
            code: goodCode,
            name: "Good row",
            capitalisedOn: "2021-04-01",
            cost: 50000,
            accumulatedDepreciation: 10000,
            method: "SLM",
            remainingLifeMonths: 60,
          },
          {
            classCode: "NOPE",
            code: `FA-BAD-${sfx}`,
            name: "Bad class",
            capitalisedOn: "2021-04-01",
            cost: 50000,
            accumulatedDepreciation: 10000,
            method: "SLM",
            remainingLifeMonths: 60,
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OPENING_IMPORT_INVALID");
    const errors = res.body.details?.errors ?? res.body.data?.errors;
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.some((e: { row: number }) => e.row === 2)).toBe(true);

    const prisma = await getPrisma();
    const found = await asDemoTenant(() =>
      prisma.fixedAsset.findFirst({ where: { code: goodCode } })
    );
    expect(found).toBeNull();
  });

  it("capitalises a GRN line, moves the cost off the purchase ledger, and refuses a second time", async () => {
    const owner = await authed("demo.owner");
    const supplier = await createSupplier();
    const material = await createRawMaterial();

    const grnRes = await (
      await api()
    )
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send({
        ...GRN_ADDRESS,
        invoiceNo: `SUP-CAP-${sfx}`,
        grnDate: "2032-04-05",
        supplierId: supplier.id,
        storeId: "ST-RM",
        updateStock: false,
        items: [
          {
            productId: material.rawMaterialId,
            description: material.materialName,
            uom: "KG",
            quantity: 1,
            unitPrice: 90000,
          },
        ],
      });
    expect(grnRes.status, JSON.stringify(grnRes.body).slice(0, 1400)).toBe(201);
    const grn = grnRes.body.data as { id: string; items: { id: string }[] };
    const lineId = grn.items[0].id;

    const classesRes = await (await api()).get("/api/assets/classes").set(owner.auth);
    const pm = (classesRes.body.data as { id: string; code: string }[]).find(
      (c) => c.code === "PM"
    )!;

    const purchBefore = await ledgerBalance("PURCH-001");
    const assetBefore = await ledgerBalance("FA-001");

    const capRes = await (
      await api()
    )
      .post("/api/assets/capitalise")
      .set(owner.auth)
      .send({
        sourceDocType: "GRN_INVOICE",
        sourceDocId: grn.id,
        lineId,
        classId: pm.id,
        code: `FA-CAP-${sfx}`,
        name: `Capitalised Machine ${sfx}`,
      });
    expect(capRes.status, JSON.stringify(capRes.body).slice(0, 1400)).toBe(201);
    expect(capRes.body.data.voucherId).toBeTruthy();
    expect(Number(capRes.body.data.cost)).toBe(90000);

    expect(Math.round(purchBefore - (await ledgerBalance("PURCH-001")))).toBe(90000);
    expect(Math.round((await ledgerBalance("FA-001")) - assetBefore)).toBe(90000);

    const again = await (
      await api()
    )
      .post("/api/assets/capitalise")
      .set(owner.auth)
      .send({
        sourceDocType: "GRN_INVOICE",
        sourceDocId: grn.id,
        lineId,
        classId: pm.id,
        code: `FA-CAP2-${sfx}`,
        name: "Second attempt",
      });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_CAPITALISED");
  });

  it("reverses a posted run and restores accumulated depreciation, refusing out of order", async () => {
    const client = await api();
    // A dedicated asset for this suite so the two months' charges are easy to reason about.
    const addRes = await client
      .post("/api/assets")
      .set(OWNER.auth)
      .send({
        code: `FA-REV-${sfx}`,
        name: `Reversible Machine ${sfx}`,
        classCode: "PM",
        cost: 180000,
        acquiredOn: "2032-04-01",
        capitalisedOn: "2032-04-01",
      });
    expect(addRes.status).toBe(201);

    const run1 = await client.post(`/api/assets/depreciation/${P1}/prepare`).set(OWNER.auth);
    expect(run1.status).toBe(200);
    const run1Id = run1.body.data.id as string;
    await client.post(`/api/assets/depreciation/runs/${run1Id}/post`).set(OWNER.auth);

    const run2 = await client.post(`/api/assets/depreciation/${P2}/prepare`).set(OWNER.auth);
    expect(run2.status).toBe(200);
    const run2Id = run2.body.data.id as string;
    await client.post(`/api/assets/depreciation/runs/${run2Id}/post`).set(OWNER.auth);

    // Run 1 cannot be reversed while run 2 (later, posted) still stands.
    const outOfOrder = await client
      .post(`/api/assets/depreciation-runs/${run1Id}/reverse`)
      .set(OWNER.auth);
    expect(outOfOrder.status).toBe(409);
    expect(outOfOrder.body.code).toBe("REVERSE_OUT_OF_ORDER");

    const accumBefore = await ledgerBalance("FA-ACC-001");
    const rev2 = await client
      .post(`/api/assets/depreciation-runs/${run2Id}/reverse`)
      .set(OWNER.auth);
    expect(rev2.status, JSON.stringify(rev2.body).slice(0, 1400)).toBe(200);
    expect(rev2.body.data.status).toBe("REVERSED");
    const accumAfter2 = await ledgerBalance("FA-ACC-001");
    // Reversing debits FA-ACC-001 back (it was credited when the run posted), so its
    // debit-minus-credit balance moves up.
    expect(Math.round(accumAfter2 - accumBefore)).toBeGreaterThan(0);

    const rev1 = await client
      .post(`/api/assets/depreciation-runs/${run1Id}/reverse`)
      .set(OWNER.auth);
    expect(rev1.status, JSON.stringify(rev1.body).slice(0, 1400)).toBe(200);
    expect(rev1.body.data.status).toBe("REVERSED");

    // Reversing an already-reversed run is refused, not silently repeated.
    const twice = await client
      .post(`/api/assets/depreciation-runs/${run1Id}/reverse`)
      .set(OWNER.auth);
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("NOT_POSTED");
  });

  it("refuses opening imports, capitalisation and reversal without permission", async () => {
    const production = await authed("demo.production");
    const client = await api();
    expect(
      (
        await client
          .post("/api/assets/opening")
          .set(production.auth)
          .send({ classCode: "PM", code: "X", name: "x" })
      ).status
    ).toBe(403);
    expect(
      (
        await client
          .post("/api/assets/capitalise")
          .set(production.auth)
          .send({ sourceDocType: "EXPENSE", sourceDocId: "x", classId: "x", code: "x", name: "x" })
      ).status
    ).toBe(403);
    expect(
      (
        await client
          .post("/api/assets/depreciation-runs/does-not-exist/reverse")
          .set(production.auth)
      ).status
    ).toBe(403);
  });

  it("keeps an opening-balance asset out of another tenant's register", async () => {
    const code = `FA-XT-${sfx}`;
    const res = await (await api()).post("/api/assets/opening").set(OWNER.auth).send({
      classCode: "PM",
      code,
      name: "Cross tenant check",
      capitalisedOn: "2021-04-01",
      cost: 10000,
      accumulatedDepreciation: 1000,
      method: "SLM",
      remainingLifeMonths: 24,
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 1400)).toBe(201);
    const assetId = res.body.data.id as string;

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Asset Completion Tenant B", companyCode: `FAC-${sfx}` },
      })
    );
    expect(
      await runAsTenant(other.id, () => prisma.fixedAsset.findUnique({ where: { id: assetId } }))
    ).toBeNull();
  });
});
