import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, createSupplier } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { fixtureFollowUpProvider } from "../../src/modules/gst-returns/followup.providers";
import { gstr2bNudgeService } from "../../src/modules/gst-returns/gstr2b-nudge.service";
import { msmeService } from "../../src/modules/msme/msme.service";

/**
 * GST and job-work follow-ups (P2-18): the ITC-04 filing gate keyed per business place, a
 * challan refused for carrying both a return and a transfer, a mixed-supplier follow-up split
 * one send per supplier with normalised WhatsApp numbers and a per-tenant provider setting, the
 * MSME payment warning merged across every payee row, and the daily nudge for whatever nobody
 * chased.
 */
const sfx = Date.now().toString(36);
let HSN_ID: string;

const material = async () => createRawMaterial({ hsnCodeId: HSN_ID });

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

describe("GST and job-work follow-ups", () => {
  beforeAll(async () => {
    const prisma = await getPrisma();
    HSN_ID = (
      await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } }))
    ).id;
  });

  const worker = async (over: Record<string, unknown> = {}) => {
    const owner = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/job-work/workers")
      .set(owner.auth)
      .send({
        name: `P2-18 Worker ${Math.random().toString(36).slice(2, 7)}`,
        gstin: "33AABCT1234H1ZT",
        processType: "Buffing",
        ...over,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    return res.body.data;
  };

  const sendOut = async (
    jobWorkerId: string,
    quantity: number,
    over: Record<string, unknown> = {}
  ) => {
    const owner = await authed("demo.owner");
    const rm = await material();
    const res = await (
      await api()
    )
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_OUT",
        challanDate: "2026-05-10",
        jobWorkerId,
        storeId: "ST-RM",
        items: [
          {
            itemType: "RAW_MATERIAL",
            rawMaterialId: rm.rawMaterialId,
            description: "P2-18 goods",
            uom: "KG",
            quantity,
            rate: 100,
            gstRate: 18,
          },
        ],
        ...over,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    return res.body.data;
  };

  it("refuses a challan that both returns to a parent and transfers from another job worker", async () => {
    const jwA = await worker();
    const jwB = await worker();
    const owner = await authed("demo.owner");
    const out = await sendOut(jwA.id, 10);

    const res = await (
      await api()
    )
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_RETURN",
        challanDate: "2026-06-01",
        jobWorkerId: jwB.id,
        parentChallanId: out.id,
        fromJobWorkerId: jwA.id,
        items: [
          { description: "Bad combo", uom: "KG", quantity: 5, parentItemId: out.items[0].id },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(res.body.code).toBe("RETURN_AND_TRANSFER");
  });

  it("keys the ITC-04 filing gate per business place and refuses to file one place on another's approval", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const client = await api();

    const place = await asDemoTenant(() =>
      prisma.businessPlace.create({
        data: {
          code: `BP-${sfx}`,
          name: "P2-18 Branch",
          type: "FACTORY",
          gstPlaceCode: "27",
          gstin: "27AAAAA0000A1Z5",
          isActive: true,
        },
      })
    );

    const jw = await worker();
    const period = "2029-H1";
    const atPlace = await sendOut(jw.id, 12, {
      businessPlaceId: String(place.id),
      challanDate: "2029-05-10",
    });
    const companyWide = await sendOut(jw.id, 7, { challanDate: "2029-05-11" });

    // Scoped to the branch: only its own challan shows up.
    const scoped = await client
      .get("/api/job-work/itc04")
      .query({ period, businessPlaceId: String(place.id) })
      .set(owner.auth);
    expect(scoped.status, JSON.stringify(scoped.body).slice(0, 300)).toBe(200);
    expect(
      scoped.body.data.table4.some((r: { challanNo: string }) => r.challanNo === atPlace.challanNo)
    ).toBe(true);
    expect(
      scoped.body.data.table4.some(
        (r: { challanNo: string }) => r.challanNo === companyWide.challanNo
      )
    ).toBe(false);

    // Register and approve the branch's half-year only.
    const reg = await client
      .post("/api/job-work/itc04/register")
      .set(accountant.auth)
      .send({ period, businessPlaceId: String(place.id) });
    expect(reg.status, JSON.stringify(reg.body).slice(0, 300)).toBe(200);
    const id = reg.body.data.filing.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      200
    );

    // The company-wide (no business place) gate is a separate row: still unapproved.
    const companyFile = await client
      .post("/api/job-work/itc04/mark-filed")
      .set(accountant.auth)
      .send({ period });
    expect(companyFile.status).toBe(409);
    expect(companyFile.body.code).toBe("FILING_NOT_APPROVED");

    // The branch's own gate is approved and files clean.
    const branchFile = await client
      .post("/api/job-work/itc04/mark-filed")
      .set(accountant.auth)
      .send({ period, businessPlaceId: String(place.id), submissionRef: `ARN-${sfx}` });
    expect(branchFile.status, JSON.stringify(branchFile.body).slice(0, 300)).toBe(200);
    expect(branchFile.body.data.filing).toMatchObject({ status: "SUBMITTED" });
  });

  it("splits a mixed-supplier follow-up into one send per supplier and normalises WhatsApp numbers", async () => {
    fixtureFollowUpProvider.reset();
    const SELLER = "33AAAAA0000A1Z9";
    const PERIOD = "2026-09";
    const owner = await authed("demo.owner");
    const client = await api();

    const supplierA = await createSupplier({
      gstRegType: "REGULAR",
      gstin: "29AABCU9603R1ZM",
      stateCode: "29",
      // A number typed with a country code and spaces — normaliseMobile should reduce it.
      whatsapp: "+91 98765 43211",
    });
    const supplierB = await createSupplier({
      gstRegType: "REGULAR",
      gstin: "24AABCU9603R1ZN",
      stateCode: "24",
      whatsapp: "9876543212",
    });

    const receive = async (supplierId: number, invoiceNo: string, unitPrice: number) => {
      const rm = await createRawMaterial({ hsnCodeId: HSN_ID });
      const res = await client
        .post("/api/grn-invoices")
        .set(owner.auth)
        .send({
          ...ADDRESS,
          invoiceNo,
          grnDate: `${PERIOD}-05`,
          supplierId,
          storeId: "ST-RM",
          updateStock: false,
          items: [
            {
              productId: rm.rawMaterialId,
              description: rm.materialName,
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
    await receive(supplierA.id, `MIXA/${sfx}`, 4000);
    await receive(supplierB.id, `MIXB/${sfx}`, 6000);

    const imported = await client
      .post("/api/gst-returns/gstr2b/import")
      .set(owner.auth)
      .send({
        period: PERIOD,
        gstin: SELLER,
        json: {
          data: {
            gstin: SELLER,
            rtnprd: PERIOD.split("-").reverse().join(""),
            docdata: { b2b: [] },
          },
        },
      });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 300)).toBe(200);
    const missA = imported.body.data.missingIn2b.find((b: { docNo: string }) =>
      b.docNo.includes("MIXA")
    );
    const missB = imported.body.data.missingIn2b.find((b: { docNo: string }) =>
      b.docNo.includes("MIXB")
    );
    expect(missA).toBeDefined();
    expect(missB).toBeDefined();

    const sent = await client
      .post(`/api/gst-returns/gstr2b/${PERIOD}/follow-up`)
      .set(owner.auth)
      .send({
        gstin: SELLER,
        channel: "WHATSAPP",
        recordIds: [`${missA.docType}:${missA.docId}`, `${missB.docType}:${missB.docId}`],
      });
    expect(sent.status, JSON.stringify(sent.body).slice(0, 300)).toBe(200);
    expect(Array.isArray(sent.body.data)).toBe(true);
    expect(sent.body.data).toHaveLength(2);
    const bySupplier = new Map(
      (sent.body.data as { supplierGstin: string; recipient: string }[]).map((r) => [
        r.supplierGstin,
        r,
      ])
    );
    expect(bySupplier.get(supplierA.gstin!)?.recipient).toBe("9876543211");
    expect(bySupplier.get(supplierB.gstin!)?.recipient).toBe("9876543212");
    expect(fixtureFollowUpProvider.sent).toHaveLength(2);

    const rows = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.supplierFollowUp.findMany({ where: { periodKey: PERIOD, gstin: SELLER } });
    });
    expect(rows.filter((r) => r.status === "SENT")).toHaveLength(2);
  });

  it("Gstr2bSettings defaults the follow-up provider to FIXTURE and saves a live/nudge choice", async () => {
    const owner = await authed("demo.owner");
    const client = await api();

    const got = await client.get("/api/gst-returns/gstr2b/settings").set(owner.auth);
    expect(got.status).toBe(200);
    expect(got.body.data.followUpProvider).toBe("FIXTURE");
    expect(got.body.data.nudgeAfterDays).toBe(5);

    const put = await client.put("/api/gst-returns/gstr2b/settings").set(owner.auth).send({
      dateToleranceDays: got.body.data.dateToleranceDays,
      valueTolerance: got.body.data.valueTolerance,
      followUpProvider: "LIVE",
      nudgeAfterDays: 3,
    });
    expect(put.status, JSON.stringify(put.body).slice(0, 300)).toBe(200);
    expect(put.body.data.followUpProvider).toBe("LIVE");
    expect(put.body.data.nudgeAfterDays).toBe(3);

    // Put it back so the rest of the suite (and the nudge test below) sees the FIXTURE default.
    await client.put("/api/gst-returns/gstr2b/settings").set(owner.auth).send({
      dateToleranceDays: got.body.data.dateToleranceDays,
      valueTolerance: got.body.data.valueTolerance,
      followUpProvider: "FIXTURE",
      nudgeAfterDays: 5,
    });
  });

  it("merges the MSME payment-voucher warning across every payee row", async () => {
    const small = await createSupplier({ msmeCategory: "SMALL" });
    const alsoSmall = await createSupplier({ msmeCategory: "MICRO" });
    const large = await createSupplier({ msmeCategory: "NOT_REGISTERED" });

    const bill = async (supplierId: number, amount: number) => {
      const owner = await authed("demo.owner");
      const rm = await createRawMaterial({ hsnCodeId: HSN_ID });
      const res = await (
        await api()
      )
        .post("/api/grn-invoices")
        .set(owner.auth)
        .send({
          ...ADDRESS,
          invoiceNo: `WARN-${sfx}-${supplierId}`,
          // 12 days ago: within 3 days of the 15-day section-15 clock (no written contract), so
          // the warning's "due soon" filter picks it up.
          grnDate: new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10),
          supplierId,
          storeId: "ST-RM",
          updateStock: false,
          items: [
            {
              productId: rm.rawMaterialId,
              description: rm.materialName,
              uom: "KG",
              quantity: 1,
              unitPrice: amount,
              tax: 0,
            },
          ],
        });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    };
    await bill(small.id, 5000);
    await bill(alsoSmall.id, 7000);

    // A single-payee call still behaves exactly as before.
    const single = await asDemoTenant(() => msmeService.paymentWarning(small.id));
    expect(single.type).toBe("PAYEE_SMALL");

    // Both payees in one voucher: the warning has to see both suppliers' bills, not just the
    // first row.
    const merged = await asDemoTenant(() => msmeService.paymentWarning([small.id, alsoSmall.id]));
    expect(merged.type).toBe("PAYEE_SMALL");
    if (merged.type === "PAYEE_SMALL") {
      const suppliers = new Set(merged.bills.map((b) => b.supplierId));
      expect(suppliers.has(small.id)).toBe(true);
      expect(suppliers.has(alsoSmall.id)).toBe(true);
    }

    // A payee list with nobody covered falls back to the general "other small suppliers" count.
    const other = await asDemoTenant(() => msmeService.paymentWarning([large.id]));
    expect(other.type).toBe("OTHER_SMALL");
  });

  it("the daily GSTR-2B nudge flags an unfollowed record once per period, idempotently, and stays within its own tenant", async () => {
    const SELLER = "33AAAAA0000A1Z9";
    const PERIOD = "2031-01";
    const owner = await authed("demo.owner");
    const client = await api();

    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: "07AAACT2727Q1ZY",
      stateCode: "07",
      email: `nudge-${sfx}@example.test`,
    });
    const rm = await createRawMaterial({ hsnCodeId: HSN_ID });
    const grn = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send({
        ...ADDRESS,
        invoiceNo: `NUDGE/${sfx}`,
        grnDate: `${PERIOD}-02`,
        supplierId: supplier.id,
        storeId: "ST-RM",
        updateStock: false,
        items: [
          {
            productId: rm.rawMaterialId,
            description: rm.materialName,
            uom: "KG",
            quantity: 1,
            unitPrice: 9000,
            tax: 18,
          },
        ],
      });
    expect(grn.status, JSON.stringify(grn.body).slice(0, 300)).toBe(201);

    // 20 days after the document date, well past the 5-day default.
    const today = new Date(`${PERIOD}-22T00:00:00Z`);
    const first = await asDemoTenant(() => gstr2bNudgeService.nudge(PERIOD, today));
    expect(first.flagged).toBeGreaterThanOrEqual(1);

    const notified = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.notification.findFirst({
        where: { category: "gst-returns", link: { contains: encodeURIComponent(`GRN:`) } },
      });
    });
    expect(notified).toBeTruthy();

    // Idempotent: running it again the same day raises nothing new.
    const second = await asDemoTenant(() => gstr2bNudgeService.nudge(PERIOD, today));
    expect(second.flagged).toBe(0);

    // Following up on the record stops the nudge from flagging it again in a later run.
    const summary = await client
      .get("/api/gst-returns/gstr2b/summary")
      .query({ period: PERIOD, gstin: SELLER })
      .set(owner.auth);
    expect(summary.status, JSON.stringify(summary.body).slice(0, 300)).toBe(200);
    const rec = (
      summary.body.data.missingIn2b as { docType: string; docId: string; docNo: string }[]
    ).find((m) => m.docNo.includes("NUDGE"));
    expect(rec).toBeDefined();
    const followUp = await client
      .post(`/api/gst-returns/gstr2b/${PERIOD}/follow-up`)
      .set(owner.auth)
      .send({
        gstin: SELLER,
        supplierId: supplier.id,
        channel: "EMAIL",
        recordIds: [`${rec!.docType}:${rec!.docId}`],
      });
    expect(followUp.status, JSON.stringify(followUp.body).slice(0, 300)).toBe(200);

    // A foreign tenant never sees this tenant's nudge notification.
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "P2-18 Tenant B", companyCode: `P218B-${sfx}` },
      })
    );
    const foreignCount = await runAsTenant(other.id, () =>
      prisma.notification.count({ where: { category: "gst-returns" } })
    );
    expect(foreignCount).toBe(0);

    // The full sweep runs across every tenant without throwing.
    await expect(gstr2bNudgeService.sweepAllTenants(today)).resolves.toMatchObject({
      tenants: expect.any(Number),
    });
  });
});
