import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, createSupplier } from "../factories";

/**
 * GSTR-2B and IMS (P1-13c). The reconciliation is the point of the package: the company's
 * purchase register and what its suppliers actually filed never agree, and each kind of
 * disagreement means something different. One 2B is imported against a fixed purchase register
 * and every outcome is asserted, then the decisions on those records are taken and pushed.
 */
const SELLER = "33AAAAA0000A1Z9";
const WEST = "27AAPFU0939F1ZV";
const PERIOD = "2026-07";
const sfx = Date.now().toString(36);
const n = (v: unknown) => Number(v);

const ADDRESS = {
  billingAddressLine1: "1 Demo Road",
  billingCity: "Chennai",
  billingState: "Tamil Nadu",
  billingPincode: "600001",
  shippingAddressLine1: "1 Demo Road",
  shippingCity: "Chennai",
  shippingState: "Tamil Nadu",
  shippingPincode: "600001",
};

let HSN_ID: string;

/** A purchase bill in the register, with the supplier's own invoice number. */
const receive = async (
  supplierId: number,
  invoiceNo: string,
  unitPrice: number,
  date = `${PERIOD}-05`
) => {
  const owner = await authed("demo.owner");
  const material = await createRawMaterial({ hsnCodeId: HSN_ID });
  const res = await (
    await api()
  )
    .post("/api/grn-invoices")
    .set(owner.auth)
    .send({
      ...ADDRESS,
      invoiceNo,
      grnDate: date,
      supplierId,
      storeId: "ST-RM",
      updateStock: false,
      items: [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: 1,
          unitPrice,
          tax: 18,
        },
      ],
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data;
};

/** A 2B in the portal's shape, carrying whatever records a test needs. */
const portalFile = (invoices: Record<string, unknown>[], ctin = SELLER) => ({
  data: {
    gstin: SELLER,
    rtnprd: "072026",
    docdata: {
      b2b: [
        {
          ctin,
          trdnm: "Test Supplier",
          supprd: "072026",
          supfildt: "11-08-2026",
          inv: invoices,
        },
      ],
    },
  },
});

const line = (rate: number, taxable: number, intra = true) => ({
  num: 1,
  rt: rate,
  txval: taxable,
  igst: intra ? 0 : Math.round(taxable * rate) / 100,
  cgst: intra ? Math.round((taxable * rate) / 2) / 100 : 0,
  sgst: intra ? Math.round((taxable * rate) / 2) / 100 : 0,
  cess: 0,
});

describe("GSTR-2B and IMS", () => {
  beforeAll(async () => {
    const prisma = await getPrisma();
    HSN_ID = (
      await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } }))
    ).id;
  });

  it("places every 2B record against the purchase register and names each disagreement", async () => {
    const accountant = await authed("demo.accounts");
    const client = await api();
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: SELLER,
      stateCode: "33",
    });

    // The register: four bills the company recorded.
    await receive(supplier.id, `AGREED/${sfx}`, 10000); // filed exactly → MATCHED
    await receive(supplier.id, `SHORT/${sfx}`, 10000); // filed for less → MISMATCH
    await receive(supplier.id, `LATE/${sfx}`, 4000); // filed with a different date → MISMATCH
    await receive(supplier.id, `UNFILED/${sfx}`, 7000); // never filed → MISSING_IN_2B

    const file = portalFile([
      // Same bill, written the way the supplier writes numbers: the normalisation has to see
      // through the separators and padding for this to match at all.
      {
        inum: `agreed-${sfx}`.toUpperCase(),
        dt: `05-07-2026`,
        val: 11800,
        pos: "33",
        rev: "N",
        itcavl: "Y",
        items: [line(18, 10000)],
      },
      {
        inum: `SHORT/${sfx}`,
        dt: "05-07-2026",
        val: 9440,
        itcavl: "Y",
        items: [line(18, 8000)],
      },
      {
        inum: `LATE/${sfx}`,
        dt: "25-05-2026", // 41 days before the book date: outside the 7-day tolerance
        val: 4720,
        itcavl: "Y",
        items: [line(18, 4000)],
      },
      {
        inum: `GHOST/${sfx}`, // filed against the company and never recorded
        dt: "12-07-2026",
        val: 2360,
        itcavl: "Y",
        items: [line(18, 2000)],
      },
    ]);

    const imported = await client
      .post("/api/gst-returns/gstr2b/import")
      .set(accountant.auth)
      .send({ period: PERIOD, gstin: SELLER, json: file });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 400)).toBe(200);
    const { summary, records, missingIn2b } = imported.body.data;

    expect(summary).toMatchObject({ matched: 1, mismatch: 2, missingInBooks: 1 });
    expect(summary.missingIn2b).toBeGreaterThanOrEqual(1);

    const by = (docNo: string) =>
      records.find((r: { docNo: string }) => r.docNo.includes(docNo.split("/")[0]));

    // Matched despite the supplier writing `agreed-xxx` where the books say `AGREED/xxx`.
    expect(by("AGREED")).toMatchObject({ matchStatus: "MATCHED", matchedDocType: "GRN" });
    expect(by("AGREED").mismatchFields).toBeNull();

    // A short filing names the fields and the size of the gap, in both directions.
    const short = by("SHORT");
    expect(short.matchStatus).toBe("MISMATCH");
    const taxable = short.mismatchFields.find((f: { field: string }) => f.field === "taxable");
    expect(taxable).toMatchObject({ inBooks: 10000, inPortal: 8000, difference: 2000 });
    expect(short.mismatchFields.some((f: { field: string }) => f.field === "cgst")).toBe(true);

    // A date well outside the tolerance is a mismatch on the date alone.
    const late = by("LATE");
    expect(late.matchStatus).toBe("MISMATCH");
    expect(late.mismatchFields.some((f: { field: string }) => f.field === "docDate")).toBe(true);

    expect(by("GHOST")).toMatchObject({ matchStatus: "MISSING_IN_BOOKS", matchedDocId: null });
    expect(missingIn2b.some((b: { docNo: string }) => b.docNo.includes("UNFILED"))).toBe(true);

    // The two credit totals are what an accountant compares before filing.
    expect(summary.portalCredit.cgst).toBeGreaterThan(0);
    expect(summary.bookCredit.cgst).toBeGreaterThan(summary.portalCredit.cgst - 10000);
  });

  it("updates a period on a second import instead of duplicating it", async () => {
    const accountant = await authed("demo.accounts");
    const client = await api();
    const period = "2026-05";
    const file = (taxable: number) => ({
      data: {
        gstin: SELLER,
        rtnprd: "052026",
        docdata: {
          b2b: [
            {
              ctin: WEST,
              trdnm: "Western Supplies",
              inv: [
                {
                  inum: `RE/${sfx}`,
                  dt: "09-05-2026",
                  val: taxable * 1.18,
                  itcavl: "Y",
                  items: [line(18, taxable, false)],
                },
              ],
            },
          ],
        },
      },
    });
    await client
      .post("/api/gst-returns/gstr2b/import")
      .set(accountant.auth)
      .send({ period, json: file(1000) });
    const second = await client
      .post("/api/gst-returns/gstr2b/import")
      .set(accountant.auth)
      .send({ period, json: file(1500) });
    expect(second.status).toBe(200);
    const mine = second.body.data.records.filter((r: { docNo: string }) => r.docNo.includes(sfx));
    expect(mine).toHaveLength(1);
    expect(n(mine[0].taxable)).toBe(1500); // the later filing wins, as an amendment should
  });

  it("refuses a file drawn for another GSTIN or another period", async () => {
    const accountant = await authed("demo.accounts");
    const client = await api();
    const wrongPeriod = await client
      .post("/api/gst-returns/gstr2b/import")
      .set(accountant.auth)
      .send({ period: "2026-04", json: portalFile([]) });
    expect(wrongPeriod.status).toBe(400);
    expect(wrongPeriod.body.code).toBe("PERIOD_MISMATCH");

    const notA2b = await client
      .post("/api/gst-returns/gstr2b/import")
      .set(accountant.auth)
      .send({ period: PERIOD, json: { data: { gstin: SELLER } } });
    expect(notA2b.status).toBe(400);
    expect(notA2b.body.code).toBe("NOT_2B");
  });

  it("takes decisions, refuses a rejection with no reason, and pushes once", async () => {
    const accountant = await authed("demo.accounts");
    const owner = await authed("demo.owner");
    const client = await api();
    const period = "2026-03";
    await client
      .post("/api/gst-returns/gstr2b/import")
      .set(accountant.auth)
      .send({
        period,
        json: {
          data: {
            gstin: SELLER,
            rtnprd: "032026",
            docdata: {
              b2b: [
                {
                  ctin: WEST,
                  trdnm: "Western Supplies",
                  inv: [
                    {
                      inum: `D1/${sfx}`,
                      dt: "04-03-2026",
                      val: 1180,
                      itcavl: "Y",
                      items: [line(18, 1000, false)],
                    },
                    {
                      inum: `D2/${sfx}`,
                      dt: "06-03-2026",
                      val: 2360,
                      itcavl: "Y",
                      items: [line(18, 2000, false)],
                    },
                  ],
                },
              ],
            },
          },
        },
      });

    const listed = await client.get("/api/gst-returns/ims").query({ period }).set(accountant.auth);
    expect(listed.status).toBe(200);
    const rows = listed.body.data.filter((r: { docNo: string }) => r.docNo.includes(sfx));
    expect(rows).toHaveLength(2);
    // Nobody has decided anything, so everything is pending — a state with consequences.
    expect(rows.every((r: { imsStatus: string }) => r.imsStatus === "PENDING")).toBe(true);

    const risk = await client
      .get("/api/gst-returns/ims/pending")
      .query({ period })
      .set(accountant.auth);
    expect(risk.body.data.pending).toBe(2);
    expect(n(risk.body.data.credit.igst)).toBe(540);

    const noReason = await client
      .post(`/api/gst-returns/ims/${rows[0].id}/act`)
      .set(accountant.auth)
      .send({ status: "REJECTED" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe("REASON_REQUIRED");

    expect(
      (
        await client
          .post(`/api/gst-returns/ims/${rows[0].id}/act`)
          .set(accountant.auth)
          .send({ status: "REJECTED", reason: "Not our purchase" })
      ).status
    ).toBe(200);
    expect(
      (
        await client
          .post(`/api/gst-returns/ims/${rows[1].id}/act`)
          .set(accountant.auth)
          .send({ status: "ACCEPTED" })
      ).status
    ).toBe(200);

    const after = await client
      .get("/api/gst-returns/ims/pending")
      .query({ period })
      .set(accountant.auth);
    expect(after.body.data.pending).toBe(0);

    // The push is a filing: it waits for an approval like every other one.
    const early = await client
      .post("/api/gst-returns/ims/push")
      .set(accountant.auth)
      .send({ period });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("FILING_NOT_APPROVED");

    const reg = await client
      .post("/api/gst-returns/ims/register")
      .set(accountant.auth)
      .send({ period });
    expect(reg.status, JSON.stringify(reg.body).slice(0, 300)).toBe(200);
    expect(reg.body.data).toMatchObject({ filingType: "IMS", periodKey: period });
    const id = reg.body.data.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      200
    );

    const pushed = await client
      .post("/api/gst-returns/ims/push")
      .set(accountant.auth)
      .send({ period });
    expect(pushed.status, JSON.stringify(pushed.body).slice(0, 300)).toBe(200);
    expect(pushed.body.data).toMatchObject({ pushed: 2, accepted: 1, rejected: 1 });
    expect(pushed.body.data.reference).toMatch(/^IMS[0-9A-F]{12}$/);

    // Nothing is pushed twice, and a decision that has gone cannot be quietly changed.
    const again = await client
      .post("/api/gst-returns/ims/push")
      .set(accountant.auth)
      .send({ period });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("IMS_NOTHING_TO_PUSH");
    const reopen = await client
      .post(`/api/gst-returns/ims/${rows[1].id}/act`)
      .set(accountant.auth)
      .send({ status: "REJECTED", reason: "Changed my mind" });
    expect(reopen.status).toBe(409);
    expect(reopen.body.code).toBe("IMS_ALREADY_PUSHED");
  });

  it("accepts the agreeing records in bulk and leaves the arguments alone", async () => {
    const accountant = await authed("demo.accounts");
    const client = await api();
    const period = "2026-02";
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: SELLER,
      stateCode: "33",
    });
    await receive(supplier.id, `BULK/${sfx}`, 5000, `${period}-04`);
    await client
      .post("/api/gst-returns/gstr2b/import")
      .set(accountant.auth)
      .send({
        period,
        json: {
          data: {
            gstin: SELLER,
            rtnprd: "022026",
            docdata: {
              b2b: [
                {
                  ctin: SELLER,
                  inv: [
                    {
                      inum: `BULK/${sfx}`,
                      dt: "04-02-2026",
                      val: 5900,
                      itcavl: "Y",
                      items: [line(18, 5000)],
                    },
                    {
                      inum: `BLOCKED/${sfx}`,
                      dt: "05-02-2026",
                      val: 1180,
                      itcavl: "N",
                      rsn: "Place of supply rules",
                      items: [line(18, 1000)],
                    },
                  ],
                },
              ],
            },
          },
        },
      });

    const applied = await client
      .post("/api/gst-returns/ims/rule")
      .set(accountant.auth)
      .send({ period, rule: "ACCEPT_MATCHED" });
    expect(applied.status, JSON.stringify(applied.body).slice(0, 300)).toBe(200);
    expect(applied.body.data.decided).toBe(1);

    const rows = (
      await client.get("/api/gst-returns/ims").query({ period }).set(accountant.auth)
    ).body.data.filter((r: { docNo: string }) => r.docNo.includes(sfx));
    const bulk = rows.find((r: { docNo: string }) => r.docNo.includes("BULK"));
    const blocked = rows.find((r: { docNo: string }) => r.docNo.includes("BLOCKED"));
    expect(bulk.imsStatus).toBe("ACCEPTED");
    // The portal says there is no credit here, so no rule accepts it on the company's behalf.
    expect(blocked.imsStatus).toBe("PENDING");
  });

  it("warns once that records are undecided, and refuses the routes without permission", async () => {
    const accountant = await authed("demo.accounts");
    const supervisor = await authed("demo.production");
    const client = await api();
    const period = "2026-01";
    await client
      .post("/api/gst-returns/gstr2b/import")
      .set(accountant.auth)
      .send({
        period,
        json: {
          data: {
            gstin: SELLER,
            rtnprd: "012026",
            docdata: {
              b2b: [
                {
                  ctin: WEST,
                  inv: [
                    {
                      inum: `WARN/${sfx}`,
                      dt: "08-01-2026",
                      val: 1180,
                      itcavl: "Y",
                      items: [line(18, 1000, false)],
                    },
                  ],
                },
              ],
            },
          },
        },
      });

    const { imsService } = await import("../../src/modules/gst-returns/ims.service");
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    const { demoCompany } = await import("../factories");
    const company = await demoCompany();
    const first = await runAsTenant(company.id, () => imsService.warnIfPending(period, null, 5));
    expect(first).toMatchObject({ warned: true, pending: 1 });
    // The job runs daily; the same nudge must not arrive every one of those days.
    const second = await runAsTenant(company.id, () => imsService.warnIfPending(period, null, 5));
    expect(second.warned).toBe(false);
    // Two days out is a different, louder message, so that one does go.
    const urgent = await runAsTenant(company.id, () => imsService.warnIfPending(period, null, 2));
    expect(urgent.warned).toBe(true);

    expect(
      (await client.get("/api/gst-returns/gstr2b").query({ period }).set(supervisor.auth)).status
    ).toBe(403);
    expect(
      (
        await client
          .post("/api/gst-returns/gstr2b/import")
          .set(supervisor.auth)
          .send({ period, json: portalFile([]) })
      ).status
    ).toBe(403);
  });

  it("draws a 2B from the fixture provider with differences to reconcile", async () => {
    const accountant = await authed("demo.accounts");
    const client = await api();
    const period = "2025-12";
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: SELLER,
      stateCode: "33",
    });
    for (let i = 1; i <= 8; i++) {
      await receive(supplier.id, `FX${i}/${sfx}`, 1000 * i, `${period}-0${(i % 9) + 1}`);
    }
    const pulled = await client
      .post("/api/gst-returns/gstr2b/pull")
      .set(accountant.auth)
      .send({ period });
    expect(pulled.status, JSON.stringify(pulled.body).slice(0, 300)).toBe(200);
    const s = pulled.body.data.summary;
    // The fixture is deliberately imperfect: the package exists for the disagreements.
    expect(s.matched + s.mismatch).toBeGreaterThan(0);
    expect(s.missingInBooks).toBeGreaterThanOrEqual(1); // the invented record
  });
});
