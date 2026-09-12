import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createCustomer,
  createProduct,
  createRawMaterial,
  createSupplier,
} from "../factories";

/**
 * GSTR-3B and the ITC ledger (P1-13b): a fixed set of documents in one month produces exact
 * values in every table, the set-off in 6.1 follows sections 49A/49B, and rule 37 reverses and
 * reclaims credit in the periods the reversal and the payment fall in.
 */
const SELLER = "33AAAAA0000A1Z9";
const BUYER = "27AAPFU0939F1ZV";
/** A month no other suite writes to, so the golden values stand on their own. */
const PERIOD = "2026-11";
const sfx = randomUUID().slice(0, 6).toUpperCase();
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

const customerIn = (stateCode: string, over: Record<string, unknown> = {}) =>
  createCustomer({
    stateCode,
    addresses: {
      create: [
        {
          label: "Billing",
          is_default: true,
          state_code: stateCode,
          address: {
            addressLine1: "1 Road",
            city: stateCode === "33" ? "Chennai" : "Pune",
            state: stateCode === "33" ? "Tamil Nadu" : "Maharashtra",
            pincode: "411001",
          },
        },
      ],
    },
    ...over,
  });

const sellTo = async (customerId: string, qty: number, rate: number, date = `${PERIOD}-12`) => {
  const owner = await authed("demo.owner");
  const product = await createProduct({ gstRate: 18, rate });
  const res = await (
    await api()
  )
    .post("/api/sales-invoices")
    .set(owner.auth)
    .send({
      invoiceDate: date,
      customerId,
      items: [{ productId: product.id.toString(), qty, rate, taxPercent: 18, hsnCode: "3923" }],
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return {
    inv: res.body.data as { id: string; invoiceNo: string; items: { id: string }[] },
    product,
  };
};

const receive = async (
  supplierId: number,
  qty: number,
  unitPrice: number,
  over: Record<string, unknown> = {},
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
      invoiceNo: `SUP-${sfx}-${Math.random().toString(36).slice(2, 7)}`,
      grnDate: date,
      supplierId,
      storeId: "ST-RM",
      updateStock: false,
      items: [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: qty,
          unitPrice,
        },
      ],
      ...over,
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data;
};

let HSN_ID: string;

describe("GSTR-3B and the ITC ledger", () => {
  beforeAll(async () => {
    const prisma = await getPrisma();
    HSN_ID = (
      await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } }))
    ).id;
  });

  it("builds every table from a fixed month of documents and sets off the tax in 6.1", async () => {
    const owner = await authed("demo.owner");
    const client = await api();

    // ── Outward ──────────────────────────────────────────────────────────────
    const b2b = await customerIn("27", { gstin: BUYER, gstRegType: "REGULAR" });
    const walkIn27 = await customerIn("27", { gstin: null, gstRegType: "UNREGISTERED" });
    const walkIn33 = await customerIn("33", { gstin: null, gstRegType: "UNREGISTERED" });
    const overseas = await customerIn("27", { gstin: null, gstRegType: "OVERSEAS" });

    const { inv: invB2b, product: b2bProduct } = await sellTo(b2b.id, 10, 1000); // 10,000 + IGST 1,800
    await sellTo(walkIn33.id, 2, 500); //  1,000 + CGST 90 + SGST 90
    await sellTo(walkIn27.id, 5, 1000); //  5,000 + IGST 900
    await sellTo(overseas.id, 20, 1000); // 20,000 + IGST 3,600, zero rated

    const cn = await client
      .post("/api/returns/sales")
      .set(owner.auth)
      .send({
        customerId: b2b.id,
        salesInvoiceId: invB2b.id,
        returnDate: `${PERIOD}-22`,
        reason: "Short supply",
        items: [
          {
            productId: Number(b2bProduct.id),
            salesInvoiceItemId: invB2b.items[0].id,
            quantity: 2,
            unitPrice: 1000,
          },
        ],
      });
    expect(cn.status, JSON.stringify(cn.body).slice(0, 300)).toBe(201);

    // ── Inward ───────────────────────────────────────────────────────────────
    const local = await createSupplier({ gstRegType: "REGULAR", gstin: SELLER, stateCode: "33" });
    const outState = await createSupplier({ gstRegType: "REGULAR", gstin: BUYER, stateCode: "27" });
    const foreign = await createSupplier({ gstRegType: "OVERSEAS", gstin: null, stateCode: "27" });

    const grnLocal = await receive(local.id, 10, 100); //  1,000 + CGST 90 + SGST 90
    await receive(outState.id, 20, 100); //  2,000 + IGST 360
    await receive(foreign.id, 5, 200); //  1,000 + IGST 180, import

    const freight = await client
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `EXP-${sfx}-RCM`,
        status: "Approved",
        expenseCategory: "Freight",
        date: `${PERIOD}-06`,
        expense: "Inward freight (GTA)",
        amount: 5000,
        paymentMethod: "Cash",
        gstRate: 5,
        reverseCharge: true,
      });
    expect(freight.status, JSON.stringify(freight.body).slice(0, 300)).toBe(201);

    const lunch = await client
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `EXP-${sfx}-BLK`,
        status: "Approved",
        expenseCategory: "Staff Welfare",
        date: `${PERIOD}-06`,
        expense: "Team lunch",
        amount: 1050,
        paymentMethod: "Cash",
        vendorGstin: SELLER,
        gstRate: 5,
        itcEligible: false,
      });
    expect(lunch.status, JSON.stringify(lunch.body).slice(0, 300)).toBe(201);

    const petty = await client
      .post("/api/petty-cash")
      .set(owner.auth)
      .send({
        entryDate: `${PERIOD}-07`,
        category: "Stationery",
        description: "Printer paper",
        amount: 1180,
        type: "OUT",
        vendorGstin: "29AAAAA0000A1ZY",
        gstRate: 18,
      });
    expect(petty.status, JSON.stringify(petty.body).slice(0, 300)).toBe(201);

    // Goods sent back to the local supplier give their credit back.
    const pr = await client
      .post("/api/returns/purchase")
      .set(owner.auth)
      .send({
        supplierId: local.id,
        grnInvoiceId: grnLocal.id,
        returnDate: `${PERIOD}-20`,
        reason: "Off specification",
        items: [{ rawMaterialId: grnLocal.items[0].productId, quantity: 2, unitPrice: 100 }],
      });
    expect(pr.status, JSON.stringify(pr.body).slice(0, 300)).toBe(201);

    // ── The return ───────────────────────────────────────────────────────────
    const res = await client
      .get("/api/gst-returns/gstr3b")
      .query({ period: PERIOD, gstin: SELLER })
      .set(owner.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const r = res.body.data;
    expect(r).toMatchObject({ gstin: SELLER, periodKey: PERIOD, fp: "112026" });

    // 3.1 outward, net of the credit note.
    expect(r.table31.a).toEqual({ taxable: 14000, igst: 2340, cgst: 90, sgst: 90, cess: 0 });
    expect(r.table31.b).toEqual({ taxable: 20000, igst: 3600, cgst: 0, sgst: 0, cess: 0 });
    expect(r.table31.c).toEqual({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
    expect(r.table31.d).toEqual({ taxable: 5000, igst: 0, cgst: 125, sgst: 125, cess: 0 });
    expect(r.table31.e).toEqual({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
    expect(r.table311.ecoPays.taxable).toBe(0);

    // 3.2 only the inter-state part of 3.1(a) that went to an unregistered buyer.
    expect(r.table32.unregistered).toEqual([{ pos: "27", taxable: 5000, igst: 900 }]);
    expect(r.table32.composition).toEqual([]);
    expect(r.table32.uin).toEqual([]);

    // 4 credit, by source.
    expect(r.table4.available.importGoods).toEqual({
      taxable: 1000,
      igst: 180,
      cgst: 0,
      sgst: 0,
      cess: 0,
    });
    expect(r.table4.available.reverseCharge).toEqual({
      taxable: 5000,
      igst: 0,
      cgst: 125,
      sgst: 125,
      cess: 0,
    });
    expect(r.table4.available.other).toEqual({
      taxable: 4000,
      igst: 540,
      cgst: 90,
      sgst: 90,
      cess: 0,
    });
    expect(r.table4.available.isd.taxable).toBe(0);
    expect(r.table4.available.total).toEqual({
      taxable: 10000,
      igst: 720,
      cgst: 215,
      sgst: 215,
      cess: 0,
    });
    expect(r.table4.reversed.others).toEqual({
      taxable: 200,
      igst: 0,
      cgst: 18,
      sgst: 18,
      cess: 0,
    });
    expect(r.table4.reversed.rules.cgst).toBe(0); // rules 42/43 are not computed yet
    expect(r.table4.net).toEqual({ taxable: 9800, igst: 720, cgst: 197, sgst: 197, cess: 0 });
    expect(r.table4.other.reclaimed.igst).toBe(0);
    expect(r.table4.other.ineligible.taxable).toBe(1000);
    expect(r.table4.other.ineligible.cgst).toBe(25);
    expect(r.table4.other.ineligible.sgst).toBe(25);

    // 6.1 the set-off: IGST credit first, then CGST and SGST credit against their own head
    // and the balance against IGST. Reverse charge is cash.
    const row = (head: string) =>
      r.table61.otherThanReverseCharge.find((x: { head: string }) => x.head === head);
    expect(row("IGST")).toEqual({
      head: "IGST",
      payable: 5940,
      paidThroughItc: { igst: 720, cgst: 107, sgst: 107, cess: 0 },
      cash: 5006,
    });
    expect(row("CGST")).toEqual({
      head: "CGST",
      payable: 90,
      paidThroughItc: { igst: 0, cgst: 90, sgst: 0, cess: 0 },
      cash: 0,
    });
    expect(row("SGST")).toEqual({
      head: "SGST",
      payable: 90,
      paidThroughItc: { igst: 0, cgst: 0, sgst: 90, cess: 0 },
      cash: 0,
    });
    const rcmRow = (head: string) =>
      r.table61.reverseCharge.find((x: { head: string }) => x.head === head);
    expect(rcmRow("CGST")).toEqual({
      head: "CGST",
      payable: 125,
      paidThroughItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      cash: 125,
    });
    expect(r.table61.cashPayable).toEqual({
      igst: 5006,
      cgst: 125,
      sgst: 125,
      cess: 0,
      total: 5256,
    });
    expect(r.table61.creditBalance).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });

    // The ledger behind table 4 names every document and the rule that classified it.
    const blocked = r.itc.find((e: { docNo: string }) => e.docNo === `EXP-${sfx}-BLK`);
    expect(blocked).toMatchObject({ status: "INELIGIBLE", rule: "17(5)", docType: "EXPENSE" });
    const rcm = r.itc.find((e: { docNo: string }) => e.docNo === `EXP-${sfx}-RCM`);
    expect(rcm).toMatchObject({ status: "ELIGIBLE", source: "RCM" });
    expect(r.itc.find((e: { source: string }) => e.source === "IMPORT_GOODS")).toBeTruthy();
    expect(r.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reverses credit unpaid for 180 days and reclaims it in the period the bill is paid", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: SELLER,
      stateCode: "33",
    });
    // Bought in April; still unpaid when December is computed, 180 days later.
    const grn = await receive(supplier.id, 10, 100, {}, "2026-04-05");

    const april = await client
      .get("/api/gst-returns/gstr3b")
      .query({ period: "2026-04" })
      .set(owner.auth);
    expect(april.status).toBe(200);
    const availed = april.body.data.itc.find((e: { docNo: string }) => e.docNo === grn.grnNumber);
    expect(availed).toMatchObject({ status: "ELIGIBLE", periodKey: "2026-04" });
    expect(april.body.data.table4.available.other.cgst).toBe(90);

    // Bought 5 April, so day 181 is 3 October: that month owns the reversal, whichever month
    // the accountant happens to open, and no other month's return mentions the bill at all.
    const december = await client
      .get("/api/gst-returns/gstr3b")
      .query({ period: "2026-12" })
      .set(owner.auth);
    expect(december.status).toBe(200);
    expect(december.body.data.itc.some((e: { docNo: string }) => e.docNo === grn.grnNumber)).toBe(
      false
    );
    expect(december.body.data.table4.reversed.others.cgst).toBe(0);

    const october = await client
      .get("/api/gst-returns/gstr3b")
      .query({ period: "2026-10" })
      .set(owner.auth);
    expect(october.status).toBe(200);
    const reversed = october.body.data.itc.find(
      (e: { docNo: string }) => e.docNo === grn.grnNumber
    );
    expect(reversed).toMatchObject({
      status: "REVERSED",
      rule: "180D",
      periodKey: "2026-04",
      reversedPeriod: "2026-10",
    });
    // The reversal lands in 4B(2) of October, not of the month the credit was taken.
    expect(october.body.data.table4.reversed.others.cgst).toBe(90);
    expect(october.body.data.table4.reversed.others.sgst).toBe(90);

    // The bill is settled in January; the credit comes back in that month.
    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.grnInvoicePayment.create({
        data: {
          grnInvoiceId: grn.id,
          amount: n(grn.netAmount),
          paymentMethod: "Bank Transfer",
          paymentDate: new Date("2027-01-10T00:00:00Z"),
        },
      })
    );
    const january = await client
      .get("/api/gst-returns/gstr3b")
      .query({ period: "2027-01" })
      .set(owner.auth);
    expect(january.status).toBe(200);
    const back = january.body.data.itc.find((e: { docNo: string }) => e.docNo === grn.grnNumber);
    expect(back).toMatchObject({
      status: "RECLAIMED",
      rule: "180D",
      reversedPeriod: "2026-10",
      reclaimedPeriod: "2027-01",
    });
    expect(january.body.data.table4.other.reclaimed.cgst).toBe(90);
    // Reclaimed credit is available again in 4A(5).
    expect(january.body.data.table4.available.other.cgst).toBeGreaterThanOrEqual(90);
  });

  it("reverses a bill from a month whose return was never opened", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: SELLER,
      stateCode: "33",
    });
    // Bought 2025-05-06 and never paid. Nobody ever computes May, so the ledger has no row for
    // it until November asks: day 181 is 2025-11-03, and November's return has to find the bill
    // on its own or the liability is understated.
    const grn = await receive(supplier.id, 10, 100, {}, "2025-05-06");

    const november = await client
      .get("/api/gst-returns/gstr3b")
      .query({ period: "2025-11" })
      .set(owner.auth);
    expect(november.status, JSON.stringify(november.body).slice(0, 300)).toBe(200);
    const row = november.body.data.itc.find((e: { docNo: string }) => e.docNo === grn.grnNumber);
    expect(row).toMatchObject({
      status: "REVERSED",
      rule: "180D",
      periodKey: "2025-05",
      reversedPeriod: "2025-11",
    });
    expect(november.body.data.table4.reversed.others.cgst).toBe(90);
    // May still carries the availment, even though it was ingested by November's rebuild.
    const may = await client
      .get("/api/gst-returns/gstr3b")
      .query({ period: "2025-05" })
      .set(owner.auth);
    expect(may.body.data.table4.available.other.cgst).toBe(90);
    expect(may.body.data.table4.reversed.others.cgst).toBe(0);
  });

  it("keeps a hand classification across a rebuild and voids a cancelled document's credit", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: SELLER,
      stateCode: "33",
    });
    const period = "2026-10";
    const keep = await receive(supplier.id, 10, 100, {}, `${period}-04`);
    const doomed = await receive(supplier.id, 4, 100, {}, `${period}-05`);

    const first = await client.get("/api/gst-returns/gstr3b").query({ period }).set(owner.auth);
    expect(first.status).toBe(200);
    const entry = first.body.data.itc.find((e: { docNo: string }) => e.docNo === keep.grnNumber);
    expect(entry.status).toBe("ELIGIBLE");

    const reclass = await client
      .patch(`/api/gst-returns/itc/${entry.id}`)
      .set(owner.auth)
      .send({ status: "INELIGIBLE", reason: "Used for an exempt supply" });
    expect(reclass.status, JSON.stringify(reclass.body).slice(0, 300)).toBe(200);
    expect(
      (
        await client
          .patch(`/api/gst-returns/itc/${entry.id}`)
          .set(owner.auth)
          .send({ status: "INELIGIBLE" })
      ).status
    ).toBe(400);

    expect(
      (await client.post(`/api/grn-invoices/${doomed.id}/cancel`).set(owner.auth)).status
    ).toBe(200);

    const second = await client.get("/api/gst-returns/gstr3b").query({ period }).set(owner.auth);
    expect(second.status).toBe(200);
    const kept = second.body.data.itc.find((e: { docNo: string }) => e.docNo === keep.grnNumber);
    expect(kept).toMatchObject({ status: "INELIGIBLE", rule: "MANUAL" });
    expect(kept.reason).toBe("Used for an exempt supply");
    const gone = second.body.data.itc.find((e: { docNo: string }) => e.docNo === doomed.grnNumber);
    expect(gone).toMatchObject({ status: "VOID", rule: "CANCELLED" });
    // Neither survives in the credit available for the month.
    expect(second.body.data.table4.available.other.cgst).toBe(0);
    expect(second.body.data.table4.other.ineligible.cgst).toBe(90);
  });

  it("refuses without the permission, rejects a bad period, and gates filing on an approval", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const supervisor = await authed("demo.production");
    const client = await api();
    const period = "2027-02"; // an empty month, independent of the rest of the suite

    expect(
      (await client.get("/api/gst-returns/gstr3b").query({ period }).set(supervisor.auth)).status
    ).toBe(403);
    expect(
      (await client.get("/api/gst-returns/gstr3b").query({ period: "2027-2" }).set(owner.auth))
        .status
    ).toBe(400);

    const reg = await client
      .post("/api/gst-returns/gstr3b/register")
      .set(accountant.auth)
      .send({ period });
    expect(reg.status, JSON.stringify(reg.body).slice(0, 300)).toBe(200);
    expect(reg.body.data.filing).toMatchObject({
      status: "DRAFT",
      filingType: "GSTR3B",
      periodKey: period,
      businessPlaceId: null,
    });

    const early = await client
      .post("/api/gst-returns/gstr3b/filed")
      .set(accountant.auth)
      .send({ period, submissionRef: "ARN-3B" });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("FILING_NOT_APPROVED");

    const id = reg.body.data.filing.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      200
    );

    const filed = await client
      .post("/api/gst-returns/gstr3b/filed")
      .set(accountant.auth)
      .send({ period, submissionRef: `AA3311${sfx}` });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 300)).toBe(200);
    expect(filed.body.data.filing).toMatchObject({ status: "SUBMITTED" });
  });
});
