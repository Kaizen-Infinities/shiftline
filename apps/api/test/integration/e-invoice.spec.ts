import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct } from "../factories";
import { computeIrn } from "../../src/modules/e-invoice/providers/fixture.provider";
import { unitCode } from "../../src/modules/e-invoice/e-invoice.payload";

/**
 * E-invoicing (P1-11): settings with encrypted secrets, IRN generation from a B2B invoice and
 * a credit note through the fixture provider, idempotency, the 24-hour cancel window, the
 * books guard on a live IRN, B2C refusal and the 30-day window for large businesses.
 */
const SELLER = "33AAAAA0000A1Z9"; // the demo company's GSTIN (seed-lib)
const BUYER = "27AAPFU0939F1ZV"; // a valid GSTIN in Maharashtra: inter-state, IGST
const sfx = Date.now().toString(36);

const b2bCustomer = () =>
  createCustomer({
    gstin: BUYER,
    gstRegType: "REGULAR",
    stateCode: "27",
    addresses: {
      create: [
        {
          label: "Billing",
          is_default: true,
          state_code: "27",
          address: {
            addressLine1: "12 Industrial Estate",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
          },
        },
      ],
    },
  });

const invoiceFor = async (customerId: string, date = "2026-09-07") => {
  const owner = await authed("demo.owner");
  const product = await createProduct({ gstRate: 18 });
  const res = await (
    await api()
  )
    .post("/api/sales-invoices")
    .set(owner.auth)
    .send({
      invoiceDate: date,
      customerId,
      items: [
        { productId: product.id.toString(), qty: 2, rate: 500, taxPercent: 18, hsnCode: "3923" },
      ],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { invoice: res.body.data, product };
};

describe("e-invoice", () => {
  it("settings: off by default, secrets stored encrypted and never returned, GSP needs credentials", async () => {
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    expect((await client.get("/api/e-invoice/settings").set(supervisor.auth)).status).toBe(403);
    const initial = await client.get("/api/e-invoice/settings").set(owner.auth);
    expect(initial.status).toBe(200);
    expect(initial.body.data).toMatchObject({
      provider: "FIXTURE",
      enabled: false,
      hasPassword: false,
    });

    const gspOn = await client
      .put("/api/e-invoice/settings")
      .set(owner.auth)
      .send({ provider: "GSP", enabled: true, baseUrl: "https://gsp.example.com" });
    expect(gspOn.status).toBe(400);

    const saved = await client.put("/api/e-invoice/settings").set(owner.auth).send({
      provider: "FIXTURE",
      enabled: true,
      applicableFrom: "2026-04-01",
      clientId: "client-1",
      clientSecret: "s3cret-value",
      username: "apiuser",
      password: "p4ssword",
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data).toMatchObject({
      enabled: true,
      hasClientSecret: true,
      hasPassword: true,
    });
    expect(JSON.stringify(saved.body)).not.toMatch(/s3cret-value|p4ssword/);
    const prisma = await getPrisma();
    const row = await asDemoTenant(() => prisma.eInvoiceConfig.findFirstOrThrow());
    expect(row.clientSecret).toMatch(/^enc:v1:/);
    expect(row.password).toMatch(/^enc:v1:/);

    // A blank secret keeps the stored one.
    const kept = await client.put("/api/e-invoice/settings").set(owner.auth).send({
      provider: "FIXTURE",
      enabled: true,
      applicableFrom: "2026-04-01",
      clientId: "client-1",
      username: "apiuser",
    });
    expect(kept.body.data.hasPassword).toBe(true);
    const verify = await client.post("/api/e-invoice/settings/verify").set(owner.auth);
    expect(verify.body.data.ok).toBe(true);
  });

  it("raises an IRN for a B2B invoice, is idempotent, guards the books and cancels within 24 hours", async () => {
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    const customer = await b2bCustomer();
    const { invoice } = await invoiceFor(customer.id);

    const applies = await client
      .get("/api/e-invoice/applicability")
      .query({ date: "2026-09-07", buyerGstin: BUYER })
      .set(owner.auth);
    expect(applies.body.data).toMatchObject({ applies: true, deadline: null });

    expect(
      (
        await client
          .post("/api/e-invoice/generate")
          .set(supervisor.auth)
          .send({ docType: "INV", docId: invoice.id })
      ).status
    ).toBe(403);
    const gen = await client
      .post("/api/e-invoice/generate")
      .set(owner.auth)
      .send({ docType: "INV", docId: invoice.id });
    expect(gen.status, JSON.stringify(gen.body)).toBe(200);
    const row = gen.body.data;
    expect(row.status).toBe("GENERATED");
    expect(row.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(row.irn).toBe(computeIrn(SELLER, "07/09/2026", "INV", invoice.invoiceNo));
    expect(row.ackNo).toMatch(/^\d{15}$/);
    expect(row.signedQr).toMatch(/^fixture\./);
    expect(row.request).toMatchObject({
      Version: "1.1",
      TranDtls: { SupTyp: "B2B" },
      DocDtls: { Typ: "INV", No: invoice.invoiceNo, Dt: "07/09/2026" },
      SellerDtls: { Gstin: SELLER, Stcd: "33" },
      BuyerDtls: { Gstin: BUYER, Stcd: "27", Pos: "27", Pin: 411001, Loc: "Pune" },
      ValDtls: { AssVal: 1000, IgstVal: 180, CgstVal: 0, TotInvVal: 1180 },
    });
    expect(row.request.ItemList[0]).toMatchObject({
      HsnCd: "3923",
      GstRt: 18,
      IgstAmt: 180,
      TotItemVal: 1180,
      Qty: 2,
    });

    // Same document again: the same IRN, nothing re-sent.
    const again = await client
      .post("/api/e-invoice/generate")
      .set(owner.auth)
      .send({ docType: "INV", docId: invoice.id });
    expect(again.status).toBe(200);
    expect(again.body.data.irn).toBe(row.irn);
    const byDoc = await client.get(`/api/e-invoice/document/INV/${invoice.id}`).set(owner.auth);
    expect(byDoc.body.data.id).toBe(row.id);
    const list = await client.get("/api/e-invoice").query({ status: "GENERATED" }).set(owner.auth);
    expect(list.body.data.some((r: { id: string }) => r.id === row.id)).toBe(true);

    // The books refuse to cancel an invoice whose IRN is live.
    const blocked = await client
      .delete(`/api/sales-invoices/${invoice.id}`)
      .set(owner.auth)
      .send({ reason: "Wrong rate" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("IRN_LIVE");

    expect(
      (await client.post(`/api/e-invoice/${row.id}/cancel`).set(owner.auth).send({ reason: "2" }))
        .status
    ).toBe(400);
    const cancelled = await client
      .post(`/api/e-invoice/${row.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "2", remarks: "Wrong rate on line 1" });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: "CANCELLED", cancelReason: "2" });
    expect(
      (
        await client
          .post(`/api/e-invoice/${row.id}/cancel`)
          .set(owner.auth)
          .send({ reason: "2", remarks: "x again" })
      ).status
    ).toBe(409);

    // Now the invoice can leave the books, and the number cannot get a new IRN.
    const freed = await client
      .delete(`/api/sales-invoices/${invoice.id}`)
      .set(owner.auth)
      .send({ reason: "Wrong rate" });
    expect(freed.status).toBe(200);
    const redo = await client
      .post("/api/e-invoice/generate")
      .set(owner.auth)
      .send({ docType: "INV", docId: invoice.id });
    expect(redo.status).toBe(409);

    // Audited by trigger.
    const prisma = await getPrisma();
    const audit = await asDemoTenant(() =>
      prisma.auditLog.count({ where: { entityName: "e_invoices", entityId: row.id } })
    );
    expect(audit).toBeGreaterThanOrEqual(2);
  });

  it("refuses a B2C document, a document older than the 30-day window for a large business, and past-window cancellation", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const walkIn = await createCustomer({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "33",
    });
    const { invoice: b2c } = await invoiceFor(walkIn.id);
    const refused = await client
      .post("/api/e-invoice/generate")
      .set(owner.auth)
      .send({ docType: "INV", docId: b2c.id });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("B2C_DOCUMENT");
    const na = await client
      .get("/api/e-invoice/applicability")
      .query({ date: "2026-09-07" })
      .set(owner.auth);
    expect(na.body.data.applies).toBe(false);

    await client
      .put("/api/e-invoice/settings")
      .set(owner.auth)
      .send({ provider: "FIXTURE", enabled: true, applicableFrom: "2026-04-01", aatoCrore: 12 });
    const big = await client
      .get("/api/e-invoice/applicability")
      .query({ date: "2026-08-01", buyerGstin: BUYER })
      .set(owner.auth);
    expect(big.body.data).toMatchObject({ applies: true, deadline: "2026-08-31" });
    const customer = await b2bCustomer();
    const { invoice: old } = await invoiceFor(customer.id, "2026-07-30");
    const late = await client
      .post("/api/e-invoice/generate")
      .set(owner.auth)
      .send({ docType: "INV", docId: old.id });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("IRN_WINDOW_CLOSED");

    // Cancellation after 24 hours is refused (ack date pushed back).
    const { invoice: fresh } = await invoiceFor(customer.id);
    const gen = await client
      .post("/api/e-invoice/generate")
      .set(owner.auth)
      .send({ docType: "INV", docId: fresh.id });
    expect(gen.status).toBe(200);
    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.eInvoice.update({
        where: { id: gen.body.data.id },
        data: { ackDate: new Date(Date.now() - 25 * 3600 * 1000) },
      })
    );
    const tooLate = await client
      .post(`/api/e-invoice/${gen.body.data.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "3", remarks: "Order cancelled" });
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.code).toBe("CANCEL_WINDOW_CLOSED");
    await client
      .put("/api/e-invoice/settings")
      .set(owner.auth)
      .send({ provider: "FIXTURE", enabled: true, applicableFrom: "2026-04-01" });
  });

  it("raises an IRN for a credit note that references the invoice", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const customer = await b2bCustomer();
    const { invoice, product } = await invoiceFor(customer.id);
    const ret = await client
      .post("/api/returns/sales")
      .set(owner.auth)
      .send({
        customerId: customer.id,
        salesInvoiceId: invoice.id,
        reason: "Damaged",
        items: [
          {
            productId: Number(product.id),
            salesInvoiceItemId: invoice.items[0].id,
            quantity: 1,
            unitPrice: 500,
          },
        ],
      });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    const gen = await client
      .post("/api/e-invoice/generate")
      .set(owner.auth)
      .send({ docType: "CRN", docId: ret.body.data.id });
    expect(gen.status, JSON.stringify(gen.body)).toBe(200);
    expect(gen.body.data).toMatchObject({
      status: "GENERATED",
      docType: "CRN",
      docNo: ret.body.data.creditNoteNo,
    });
    expect(gen.body.data.request.DocDtls.Typ).toBe("CRN");
    expect(gen.body.data.request.RefDtls.PrecDocDtls[0].InvNo).toBe(invoice.invoiceNo);
    expect(gen.body.data.request.ValDtls.TotInvVal).toBe(590);
    const blocked = await client
      .post(`/api/returns/sales/${ret.body.data.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "x" });
    expect(blocked.status).toBe(409);
  });

  it("maps units to UQC codes", () => {
    expect(unitCode("Nos")).toBe("NOS");
    expect(unitCode("kg")).toBe("KGS");
    expect(unitCode("Widgets")).toBe("OTH");
  });
});
