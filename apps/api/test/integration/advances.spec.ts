import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct } from "../factories";

/**
 * Advances, exports and foreign currency (P1-14).
 *
 * The advance is the interesting one: tax on it falls due when the money arrives, so the receipt
 * carries GST *inside* the amount received, and adjusting it against an invoice releases that
 * tax rather than charging it again. Getting either half wrong means paying the same tax twice.
 */
const SELLER = "33AAAAA0000A1Z9";
const sfx = Date.now().toString(36);
const n = (v: unknown) => Number(v);
let HSN_ID: string;

/** Ledger code → amount for one side of a voucher. */
const sideOf = async (refDocType: string, refDocId: string) => {
  const prisma = await getPrisma();
  const voucher = await asDemoTenant(() =>
    prisma.voucher.findFirstOrThrow({
      where: { refDocType, refDocId },
      include: { items: { include: { debitLedger: true, creditLedger: true } } },
    })
  );
  const debits: Record<string, number> = {};
  const credits: Record<string, number> = {};
  for (const item of voucher.items) {
    if (item.debitLedger) debits[item.debitLedger.code] = n(item.debitAmount);
    if (item.creditLedger) credits[item.creditLedger.code] = n(item.creditAmount);
  }
  const total = (side: Record<string, number>) =>
    Math.round(Object.values(side).reduce((s, v) => s + v, 0) * 100) / 100;
  expect(total(debits), "the voucher balances").toBe(total(credits));
  return { voucher, debits, credits };
};

describe("advances, exports and foreign currency", () => {
  beforeAll(async () => {
    const prisma = await getPrisma();
    HSN_ID = (
      await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } }))
    ).id;
  });

  it("takes an advance with the tax inside it and posts it as money owed, not income", async () => {
    const accountant = await authed("demo.accounts");
    const client = await api();
    const customer = await createCustomer({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "33",
    });

    const res = await client.post("/api/advances").set(accountant.auth).send({
      customerId: customer.id,
      receiptDate: "2026-05-04",
      amount: 11800, // what the customer actually paid
      gstRate: 18,
      paymentMethod: "Bank Transfer",
      narration: "Advance against the May order",
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const advance = res.body.data;

    // ₹11,800 at 18% is ₹10,000 plus ₹1,800 — not ₹11,800 plus tax.
    expect(n(advance.amount)).toBe(11800);
    expect(n(advance.taxable)).toBe(10000);
    expect(n(advance.cgst)).toBe(900);
    expect(n(advance.sgst)).toBe(900);
    expect(n(advance.igst)).toBe(0);
    expect(advance.status).toBe("OPEN");
    expect(advance.receiptNo).toMatch(/^RV\//);

    const { debits, credits } = await sideOf("ADVANCE_RECEIPT", advance.id);
    expect(debits).toMatchObject({ "BANK-001": 11800 });
    // The money is a liability until it is earned, and the tax is already the government's.
    expect(credits).toMatchObject({
      "ADV-CUST-001": 10000,
      "CGST-LIA-001": 900,
      "SGST-LIA-001": 900,
    });
  });

  it("releases the tax in proportion when the advance is applied to an invoice", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const client = await api();
    const customer = await createCustomer({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "33",
    });
    const product = await createProduct({ gstRate: 18, rate: 1000, hsnCodeId: HSN_ID });

    const advance = (
      await client
        .post("/api/advances")
        .set(accountant.auth)
        .send({ customerId: customer.id, receiptDate: "2026-05-06", amount: 11800, gstRate: 18 })
    ).body.data;

    const invoice = (
      await client
        .post("/api/sales-invoices")
        .set(owner.auth)
        .send({
          invoiceDate: "2026-05-20",
          customerId: customer.id,
          items: [{ productId: product.id.toString(), qty: 20, rate: 1000, taxPercent: 18 }],
        })
    ).body.data;
    expect(n(invoice.grandTotal)).toBe(23600);

    // Half the advance goes against this invoice.
    const adjusted = await client
      .post(`/api/advances/${advance.id}/adjust`)
      .set(accountant.auth)
      .send({ salesInvoiceId: invoice.id, amount: 5900, on: "2026-05-20" });
    expect(adjusted.status, JSON.stringify(adjusted.body).slice(0, 300)).toBe(200);
    // Half the money carries half the tax with it, which is what table 11B reports.
    expect(n(adjusted.body.data.taxable)).toBe(5000);
    expect(n(adjusted.body.data.cgst)).toBe(450);
    expect(n(adjusted.body.data.sgst)).toBe(450);

    const after = (await client.get(`/api/advances/${advance.id}`).set(accountant.auth)).body.data;
    expect(after.status).toBe("PART_ADJUSTED");
    expect(n(after.balance)).toBe(5900);

    const { debits, credits } = await sideOf("ADVANCE_ADJUSTMENT", adjusted.body.data.id);
    // Only money moves: the invoice already carries the tax on the supply.
    expect(debits).toMatchObject({ "ADV-CUST-001": 5900 });
    expect(Object.values(credits)).toEqual([5900]);
    expect(credits["CGST-LIA-001"]).toBeUndefined();

    // More than the balance is refused, and so is an advance belonging to someone else.
    const tooMuch = await client
      .post(`/api/advances/${advance.id}/adjust`)
      .set(accountant.auth)
      .send({ salesInvoiceId: invoice.id, amount: 9000 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.code).toBe("ADVANCE_EXHAUSTED");

    const other = await createCustomer({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "33",
    });
    const otherInvoice = (
      await client
        .post("/api/sales-invoices")
        .set(owner.auth)
        .send({
          invoiceDate: "2026-05-21",
          customerId: other.id,
          items: [{ productId: product.id.toString(), qty: 1, rate: 1000, taxPercent: 18 }],
        })
    ).body.data;
    const wrongCustomer = await client
      .post(`/api/advances/${advance.id}/adjust`)
      .set(accountant.auth)
      .send({ salesInvoiceId: otherInvoice.id, amount: 100 });
    expect(wrongCustomer.status).toBe(400);
    expect(wrongCustomer.body.code).toBe("CUSTOMER_MISMATCH");
  });

  it("gives an advance back with the tax that was paid on it", async () => {
    const accountant = await authed("demo.accounts");
    const owner = await authed("demo.owner");
    const client = await api();
    const customer = await createCustomer({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "33",
    });
    const advance = (
      await client.post("/api/advances").set(accountant.auth).send({
        customerId: customer.id,
        receiptDate: "2026-05-08",
        amount: 5900,
        gstRate: 18,
        paymentMethod: "Cash",
      })
    ).body.data;

    // Refunding needs its own permission: giving money back is not the same as taking it.
    expect(
      (
        await client
          .post(`/api/advances/${advance.id}/refund`)
          .set((await authed("demo.production")).auth)
          .send({ amount: 5900 })
      ).status
    ).toBe(403);

    const refund = await client
      .post(`/api/advances/${advance.id}/refund`)
      .set(owner.auth)
      .send({ amount: 5900, on: "2026-05-25", reason: "Order cancelled" });
    expect(refund.status, JSON.stringify(refund.body).slice(0, 300)).toBe(200);
    expect(refund.body.data.refundVoucherNo).toMatch(/^RFV\//);

    const { debits, credits } = await sideOf("ADVANCE_REFUND", refund.body.data.id);
    // The supply is not happening, so the tax comes back out of the payable ledgers.
    expect(debits).toMatchObject({
      "ADV-CUST-001": 5000,
      "CGST-LIA-001": 450,
      "SGST-LIA-001": 450,
    });
    expect(credits).toMatchObject({ "CASH-001": 5900 });

    const after = (await client.get(`/api/advances/${advance.id}`).set(accountant.auth)).body.data;
    expect(after.status).toBe("CLOSED");
    expect(n(after.balance)).toBe(0);
    expect(
      (await client.post(`/api/advances/${advance.id}/refund`).set(owner.auth).send({ amount: 1 }))
        .body.code
    ).toBe("ADVANCE_EXHAUSTED");
  });

  it("reports advances in GSTR-1 tables 11A and 11B", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const client = await api();
    const period = "2025-08";
    const customer = await createCustomer({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "27",
    });
    const product = await createProduct({ gstRate: 18, rate: 1000, hsnCodeId: HSN_ID });

    const advance = (
      await client
        .post("/api/advances")
        .set(accountant.auth)
        .send({
          customerId: customer.id,
          receiptDate: `${period}-05`,
          amount: 11800,
          gstRate: 18,
          placeOfSupply: "27",
        })
    ).body.data;
    expect(n(advance.igst)).toBe(1800); // inter-state, so the whole tax is IGST

    const ret = (await client.get("/api/gst-returns/gstr1").query({ period }).set(accountant.auth))
      .body.data;
    const at = ret.json.at.find((r: { pos: string; rt: number }) => r.pos === "27" && r.rt === 18);
    expect(at).toMatchObject({ sply_ty: "INTER", ad_amt: 10000, iamt: 1800 });
    // Nothing is adjusted yet, so 11B is empty for this place.
    expect(ret.json.txpd.some((r: { pos: string }) => r.pos === "27")).toBe(false);

    const invoice = (
      await client
        .post("/api/sales-invoices")
        .set(owner.auth)
        .send({
          invoiceDate: `${period}-18`,
          customerId: customer.id,
          items: [{ productId: product.id.toString(), qty: 12, rate: 1000, taxPercent: 18 }],
        })
    ).body.data;
    await client
      .post(`/api/advances/${advance.id}/adjust`)
      .set(accountant.auth)
      .send({ salesInvoiceId: invoice.id, amount: 11800, on: `${period}-18` });

    const after = (
      await client.get("/api/gst-returns/gstr1").query({ period }).set(accountant.auth)
    ).body.data;
    const txpd = after.json.txpd.find(
      (r: { pos: string; rt: number }) => r.pos === "27" && r.rt === 18
    );
    expect(txpd).toMatchObject({ ad_amt: 10000, iamt: 1800 });
  });

  it("carries the shipping bill into the GSTR-1 export table and warns when it is missing", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const period = "2025-10";
    const overseas = await createCustomer({ gstin: null, gstRegType: "OVERSEAS", stateCode: null });
    const product = await createProduct({ gstRate: 0, rate: 500, hsnCodeId: HSN_ID });

    const documented = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: `${period}-06`,
        customerId: overseas.id,
        exportType: "UNDER_LUT",
        lutNumber: `LUT/${sfx}`,
        shippingBillNo: "7213456",
        shippingBillDate: `${period}-09`,
        portCode: "INMAA1",
        items: [{ productId: product.id.toString(), qty: 40, rate: 500, taxPercent: 0 }],
      });
    expect(documented.status, JSON.stringify(documented.body).slice(0, 300)).toBe(201);
    expect(documented.body.data.exportType).toBe("UNDER_LUT");

    const bare = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: `${period}-07`,
        customerId: overseas.id,
        items: [{ productId: product.id.toString(), qty: 2, rate: 500, taxPercent: 0 }],
      });
    expect(bare.status).toBe(201);

    const ret = (await client.get("/api/gst-returns/gstr1").query({ period }).set(owner.auth)).body
      .data;
    const wopay = ret.json.exp.find((e: { exp_typ: string }) => e.exp_typ === "WOPAY");
    expect(wopay).toBeTruthy();
    const row = wopay.inv.find((i: { inum: string }) => i.inum === documented.body.data.invoiceNo);
    expect(row).toMatchObject({ sbnum: "7213456", sbdt: `09-10-2025`, sbpcode: "INMAA1" });
    // The one without a shipping bill goes out, and says so, rather than being dropped.
    expect(
      ret.warnings.some(
        (w: string) => w.includes(bare.body.data.invoiceNo) && w.includes("shipping bill")
      )
    ).toBe(true);
  });

  it("bills in a foreign currency and keeps the books in rupees at the day's rate", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const client = await api();
    const overseas = await createCustomer({ gstin: null, gstRegType: "OVERSEAS", stateCode: null });
    const product = await createProduct({ gstRate: 0, rate: 100, hsnCodeId: HSN_ID });

    // The currency master seeds itself the first time it is read.
    const currencies = await client.get("/api/currencies").set(accountant.auth);
    expect(currencies.status).toBe(200);
    expect(currencies.body.data.some((c: { code: string }) => c.code === "USD")).toBe(true);

    // With no rate on file the invoice is refused rather than posted as if a dollar were a rupee.
    const noRate = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2025-09-10",
        customerId: overseas.id,
        currencyCode: "USD",
        items: [{ productId: product.id.toString(), qty: 10, rate: 100, taxPercent: 0 }],
      });
    expect(noRate.status).toBe(409);
    expect(noRate.body.code).toBe("NO_RATE");

    expect(
      (
        await client
          .post("/api/currencies/rates")
          .set(accountant.auth)
          .send({ currencyCode: "USD", rateDate: "2025-09-01", rate: 83.5 })
      ).status
    ).toBe(200);

    const invoice = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2025-09-10",
        customerId: overseas.id,
        currencyCode: "USD",
        items: [{ productId: product.id.toString(), qty: 10, rate: 100, taxPercent: 0 }],
      });
    expect(invoice.status, JSON.stringify(invoice.body).slice(0, 300)).toBe(201);
    // The rate on or before the invoice date is used: a holiday has no rate of its own.
    expect(n(invoice.body.data.exchangeRate)).toBe(83.5);
    // $1,000 billed, ₹83,500 in the books.
    expect(n(invoice.body.data.foreignTotal)).toBe(1000);
    expect(n(invoice.body.data.grandTotal)).toBe(83500);
    expect(invoice.body.data.currencyCode).toBe("USD");

    // The rupee is the base currency and has no rate against itself.
    expect(
      (
        await client
          .post("/api/currencies/rates")
          .set(accountant.auth)
          .send({ currencyCode: "INR", rateDate: "2025-09-01", rate: 1 })
      ).body.code
    ).toBe("BASE_CURRENCY");
  });

  it("refuses the routes without the permission", async () => {
    const supervisor = await authed("demo.production");
    const client = await api();
    expect((await client.get("/api/advances").set(supervisor.auth)).status).toBe(403);
    expect((await client.get("/api/currencies").set(supervisor.auth)).status).toBe(403);
  });
});
