import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, createSupplier, demoCompany } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";
import { fixtureFollowUpProvider } from "../../src/modules/gst-returns/followup.providers";
import { msmeService } from "../../src/modules/msme/msme.service";

/**
 * GST and MSME follow-ups (P2-10): chasing a supplier from the 2B reconciliation, per-tenant
 * matching tolerances, and the MSME section-15 clock reaching supplier expenses as well as GRN
 * invoices, with a heads-up on the payment voucher before a small supplier's bill goes overdue.
 */
const SELLER = "33AAAAA0000A1Z9";
const PERIOD = "2026-08";
const sfx = Date.now().toString(36);

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
let OWNER: { auth: Record<string, string> };

const receive = async (supplierId: number, invoiceNo: string, unitPrice: number, date: string) => {
  const material = await createRawMaterial({ hsnCodeId: HSN_ID });
  const res = await (
    await api()
  )
    .post("/api/grn-invoices")
    .set(OWNER.auth)
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

const line = (rate: number, taxable: number) => ({
  num: 1,
  rt: rate,
  txval: taxable,
  igst: 0,
  cgst: Math.round((taxable * rate) / 2) / 100,
  sgst: Math.round((taxable * rate) / 2) / 100,
  cess: 0,
});

/** `ctin` is the *supplier's* GSTIN in the 2B, never the company's own filing GSTIN. */
const portalFile = (invoices: Record<string, unknown>[], ctin: string) => ({
  data: {
    gstin: SELLER,
    rtnprd: "082026",
    docdata: {
      b2b: [{ ctin, trdnm: "Followup Supplier", supprd: "082026", inv: invoices }],
    },
  },
});

const expense = async (
  supplierId: number,
  amount: number,
  date: string,
  status: "Pending" | "Approved" = "Pending"
) => {
  const res = await (
    await api()
  )
    .post("/api/expenses")
    .set(OWNER.auth)
    .send({
      expenseNumber: `EXP-F-${sfx}-${Math.round(Math.random() * 1e6)}`,
      status,
      expenseCategory: "Job work",
      date,
      expense: "Job work charges",
      amount,
      paymentMethod: "Cash",
      supplierId,
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data as { id: string; expenseNumber: string };
};

describe("GST and MSME follow-ups", () => {
  beforeAll(async () => {
    const prisma = await getPrisma();
    OWNER = await authed("demo.owner");
    HSN_ID = (
      await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } }))
    ).id;
  });

  it("sends a follow-up over WhatsApp (fixture), records it, and shows it on the reconciliation", async () => {
    fixtureFollowUpProvider.reset();
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: SELLER,
      stateCode: "33",
      whatsapp: "9876543210",
    });
    await receive(supplier.id, `CHASE/${sfx}`, 5000, `${PERIOD}-05`);

    const imported = await (
      await api()
    )
      .post("/api/gst-returns/gstr2b/import")
      .set(OWNER.auth)
      .send({ period: PERIOD, gstin: SELLER, json: portalFile([], SELLER) });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 300)).toBe(200);
    const missing = imported.body.data.missingIn2b.find((b: { docNo: string }) =>
      b.docNo.includes("CHASE")
    );
    expect(missing).toBeDefined();
    const recordId = `${missing.docType}:${missing.docId}`;

    const preview = await (
      await api()
    )
      .post(`/api/gst-returns/gstr2b/${PERIOD}/follow-up/preview`)
      .set(OWNER.auth)
      .send({ gstin: SELLER, supplierId: supplier.id, channel: "WHATSAPP", recordIds: [recordId] });
    expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(200);
    expect(preview.body.data.message).toContain("CHASE");
    // A preview never writes anything.
    expect(fixtureFollowUpProvider.sent).toHaveLength(0);

    const sent = await (
      await api()
    )
      .post(`/api/gst-returns/gstr2b/${PERIOD}/follow-up`)
      .set(OWNER.auth)
      .send({ gstin: SELLER, supplierId: supplier.id, channel: "WHATSAPP", recordIds: [recordId] });
    expect(sent.status, JSON.stringify(sent.body).slice(0, 300)).toBe(200);
    expect(sent.body.data.status).toBe("SENT");
    expect(sent.body.data.recipient).toBe("9876543210");
    expect(fixtureFollowUpProvider.sent).toHaveLength(1);
    expect(fixtureFollowUpProvider.sent[0]).toMatchObject({
      channel: "WHATSAPP",
      to: "9876543210",
    });

    const summary = await (
      await api()
    )
      .get("/api/gst-returns/gstr2b/summary")
      .query({ period: PERIOD, gstin: SELLER })
      .set(OWNER.auth);
    expect(summary.status).toBe(200);
    const lastFollowUp = summary.body.data.followUps.find(
      (f: { supplierGstin: string }) => f.supplierGstin === SELLER
    );
    expect(lastFollowUp).toMatchObject({ channel: "WHATSAPP", status: "SENT" });
  });

  it("refuses a follow-up when the supplier has no contact detail for that channel", async () => {
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: "29AAACT2727Q1ZW",
      stateCode: "29",
      email: null,
      whatsapp: null,
    });
    await receive(supplier.id, `NOCONTACT/${sfx}`, 3000, `${PERIOD}-06`);
    const imported = await (
      await api()
    )
      .post("/api/gst-returns/gstr2b/import")
      .set(OWNER.auth)
      .send({ period: PERIOD, gstin: SELLER, json: portalFile([], "29AAACT2727Q1ZW") });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 300)).toBe(200);
    const missing = imported.body.data.missingIn2b.find((b: { docNo: string }) =>
      b.docNo.includes("NOCONTACT")
    );
    expect(missing).toBeDefined();
    const recordId = `${missing.docType}:${missing.docId}`;

    const res = await (
      await api()
    )
      .post(`/api/gst-returns/gstr2b/${PERIOD}/follow-up`)
      .set(OWNER.auth)
      .send({
        gstin: SELLER,
        supplierId: supplier.id,
        channel: "EMAIL",
        recordIds: [recordId],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_CONTACT");
  });

  it("per-tenant tolerance settings turn a mismatch into a match, and back", async () => {
    const period = "2026-08"; // same period as the first test, a fresh supplier of its own
    // Same state as the business place (33, Tamil Nadu): an intra-state bill, so both the book
    // and the portal record split IGST-free into CGST/SGST and only the taxable value differs.
    const supplierGstin = "33AABCT1234H1Z1";
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: supplierGstin,
      stateCode: "33",
    });
    await receive(supplier.id, `TOL/${sfx}`, 10000, `${period}-05`);
    const file = portalFile(
      [
        {
          inum: `TOL/${sfx}`,
          dt: "05-08-2026",
          val: 11800,
          itcavl: "Y",
          items: [line(18, 9995)], // ₹5 short of the books
        },
      ],
      supplierGstin
    );
    const before = await (
      await api()
    )
      .post("/api/gst-returns/gstr2b/import")
      .set(OWNER.auth)
      .send({ period, gstin: SELLER, json: file });
    expect(before.status, JSON.stringify(before.body).slice(0, 300)).toBe(200);
    expect(before.body.data.summary.mismatch).toBeGreaterThanOrEqual(1);

    const put = await (
      await api()
    )
      .put("/api/gst-returns/gstr2b/settings")
      .set(OWNER.auth)
      .send({ dateToleranceDays: 7, valueTolerance: 10 });
    expect(put.status, JSON.stringify(put.body).slice(0, 300)).toBe(200);
    expect(put.body.data).toMatchObject({ dateToleranceDays: 7, valueTolerance: 10 });

    const wider = await (
      await api()
    )
      .get("/api/gst-returns/gstr2b/summary")
      .query({ period, gstin: SELLER })
      .set(OWNER.auth);
    const widened = wider.body.data.records.find((r: { docNo: string }) => r.docNo.includes("TOL"));
    expect(widened.matchStatus).toBe("MATCHED");

    // Back to the default tolerance, and the mismatch is a mismatch again.
    const revert = await (
      await api()
    )
      .put("/api/gst-returns/gstr2b/settings")
      .set(OWNER.auth)
      .send({ dateToleranceDays: 7, valueTolerance: 1 });
    expect(revert.status).toBe(200);
    const narrow = await (
      await api()
    )
      .get("/api/gst-returns/gstr2b/summary")
      .query({ period, gstin: SELLER })
      .set(OWNER.auth);
    const narrowed = narrow.body.data.records.find((r: { docNo: string }) =>
      r.docNo.includes("TOL")
    );
    expect(narrowed.matchStatus).toBe("MISMATCH");
  });

  it("puts a supplier expense on the same MSME clock as a GRN invoice, and warns at 2 days left", async () => {
    const supplier = await createSupplier({ msmeCategory: "MICRO", hasWrittenContract: false });
    const accepted = "2029-11-01";
    const row = await expense(supplier.id, 4500, accepted, "Pending");

    const bills = await (
      await api()
    )
      .get("/api/msme/bills")
      .query({ supplierId: supplier.id, asOn: "2029-11-16" }) // 15 days later: the due date
      .set(OWNER.auth);
    expect(bills.status).toBe(200);
    const found = bills.body.data.find((b: { grnId: string }) => b.grnId === row.id);
    expect(found, JSON.stringify(bills.body.data).slice(0, 300)).toBeDefined();
    expect(found.source).toBe("EXPENSE");
    expect(found.outstanding).toBe(4500);
    expect(found.dueDate).toBe("2029-11-16");

    // 15-day clock, 2 days left: the alert that actually fires (day 15 minus 2 = day 13).
    const warned = await asDemoTenant(() =>
      msmeService.warnUpcoming(new Date("2029-11-14T09:00:00Z"))
    );
    expect(warned.sent).toBeGreaterThan(0);
  });

  it("warns a payment about to make a small supplier's bill run out of time, without blocking it", async () => {
    const small = await createSupplier({ msmeCategory: "SMALL", hasWrittenContract: false });
    const large = await createSupplier({ msmeCategory: "MEDIUM" });
    // Due in 3 days as at "asOn" below (15-day clock from acceptance).
    await expense(small.id, 6000, "2029-12-01", "Pending");

    const forSmall = await (
      await api()
    )
      .get("/api/msme/payment-warning")
      .query({ supplierId: small.id })
      .set(OWNER.auth);
    expect(forSmall.status).toBe(200);
    // asOn defaults to "now" inside the service, so pin the check through the service directly
    // for a fixed date, and the route for the shape of the response.
    expect(forSmall.body.data.type).toBe("PAYEE_SMALL");

    const direct = await asDemoTenant(() =>
      msmeService.paymentWarning(small.id, new Date("2029-12-13T00:00:00Z"))
    );
    expect(direct.type).toBe("PAYEE_SMALL");
    if (direct.type === "PAYEE_SMALL") {
      expect(direct.bills.some((b) => b.supplierId === small.id)).toBe(true);
    }

    const forLarge = await asDemoTenant(() =>
      msmeService.paymentWarning(large.id, new Date("2029-12-13T00:00:00Z"))
    );
    expect(forLarge.type).toBe("OTHER_SMALL");
    if (forLarge.type === "OTHER_SMALL") {
      expect(forLarge.count).toBeGreaterThan(0);
    }
  });

  it("refuses a follow-up and the settings without gst-returns.prepare", async () => {
    const production = await authed("demo.production");
    const client = await api();
    expect(
      (
        await client
          .put("/api/gst-returns/gstr2b/settings")
          .set(production.auth)
          .send({ dateToleranceDays: 5, valueTolerance: 2 })
      ).status
    ).toBe(403);
    expect(
      (
        await client
          .post(`/api/gst-returns/gstr2b/${PERIOD}/follow-up`)
          .set(production.auth)
          .send({ gstin: SELLER, supplierGstin: SELLER, channel: "EMAIL", recordIds: ["x"] })
      ).status
    ).toBe(403);
  });

  it("keeps every row tenant-scoped: a foreign company's settings and follow-ups are invisible", async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    const other = await prisma.company.upsert({
      where: { companyCode: "TEN-FOLLOWUP" },
      update: {},
      create: { companyCode: "TEN-FOLLOWUP", companyName: "Other Tenant Co", isOnboarded: true },
    });

    await runAsTenant(other.id, () =>
      prisma.gstr2bSettings.create({ data: { dateToleranceDays: 30, valueTolerance: 500 } })
    );
    await runAsTenant(other.id, () =>
      prisma.supplierFollowUp.create({
        data: {
          periodKey: PERIOD,
          gstin: "99ZZZZZ0000Z1Z9",
          supplierGstin: "99ZZZZZ0000Z1Z8",
          channel: "EMAIL",
          recordIds: ["x"],
          recipient: "someone@othertenant.example",
          message: "should not leak",
          status: "SENT",
        },
      })
    );

    const seenFromDemo = await runAsTenant(company.id, () =>
      prisma.supplierFollowUp.findMany({ where: { message: "should not leak" } })
    );
    expect(seenFromDemo).toHaveLength(0);

    const settingsViaApi = await (
      await api()
    )
      .get("/api/gst-returns/gstr2b/settings")
      .set(OWNER.auth);
    expect(settingsViaApi.body.data.dateToleranceDays).not.toBe(30);
  });
});
