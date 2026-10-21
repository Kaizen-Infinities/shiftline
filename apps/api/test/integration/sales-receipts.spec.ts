import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct, demoCompany } from "../factories";
import { withoutTenant, runAsTenant } from "../../src/lib/tenant-context";

/**
 * Recording a receipt against a sales invoice by hand (P2-12).
 *
 * P2-06 wired cheque registration and FX realisation into `postReceiptVouchersForSales`, but
 * nothing ever appended a hand-entered receipt to `SalesInvoice.payments` — create/update always
 * wrote `payments: []`. `POST /api/sales-invoices/:id/receipts` is the endpoint that does that,
 * and these tests exercise it end to end: a cash receipt posts the voucher, a cheque receipt
 * registers, a post-dated cheque waits for clearing, a foreign-currency invoice realises the
 * exchange difference, and the usual refusals (over-receipt, cancelled document, permission,
 * cross-tenant) hold.
 */
const n = (v: unknown) => Number(v);
const sfx = randomUUID().slice(0, 6).toUpperCase();
const FY = "2026";

/** Ledger code → amount for one side of a voucher raised for a given ref. */
const sideOf = async (refDocType: string, refDocId: string) => {
  const prisma = await getPrisma();
  const voucher = await asDemoTenant(() =>
    prisma.voucher.findFirstOrThrow({
      where: { refDocType, refDocId, status: "POSTED" },
      include: { items: { include: { debitLedger: true, creditLedger: true } } },
    })
  );
  const debits: Record<string, number> = {};
  const credits: Record<string, number> = {};
  for (const item of voucher.items) {
    if (item.debitLedger) debits[item.debitLedger.code] = n(item.debitAmount);
    if (item.creditLedger) credits[item.creditLedger.code] = n(item.creditAmount);
  }
  return { voucher, debits, credits };
};

const makeInvoice = async (owner: { auth: Record<string, string> }, rate: number) => {
  const client = await api();
  const customer = await createCustomer();
  const product = await createProduct({ gstRate: 0 });
  const res = await client
    .post("/api/sales-invoices")
    .set(owner.auth)
    .send({
      invoiceDate: `${FY}-09-01`,
      customerId: customer.id,
      items: [{ productId: product.id.toString(), qty: 1, rate }],
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return {
    invoice: res.body.data as { id: string; invoiceNo: string; grandTotal: number },
    customer,
  };
};

let otherTenantSeq = 0;
const otherTenant = async (name: string) => {
  const prisma = await getPrisma();
  return withoutTenant(() =>
    prisma.company.create({
      data: { companyName: name, companyCode: `SR${sfx}${++otherTenantSeq}` },
    })
  );
};

describe("sales invoice receipts", () => {
  let OWNER: { auth: Record<string, string> };
  let PRODUCTION: { auth: Record<string, string> };

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    PRODUCTION = await authed("demo.production");
  });

  it("posts the receipt voucher and reduces the outstanding on a cash receipt", async () => {
    const client = await api();
    const { invoice } = await makeInvoice(OWNER, 10000);

    const res = await client
      .post(`/api/sales-invoices/${invoice.id}/receipts`)
      .set(OWNER.auth)
      .send({ amount: 4000, paymentDate: `${FY}-09-05`, instrumentType: "CASH" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const payments = res.body.data.payments as any[];
    expect(payments).toHaveLength(1);
    expect(n(payments[0].amount)).toBe(4000);
    expect(payments[0].paymentMethod).toBe("Cash");

    const posted = await sideOf("SALES_PAYMENT", payments[0].id);
    expect(posted.debits).toMatchObject({ "CASH-001": 4000 });
    expect(Object.values(posted.credits).reduce((s, v) => s + v, 0)).toBe(4000);

    const listRes = await client.get(`/api/sales-invoices/${invoice.id}/receipts`).set(OWNER.auth);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(n(listRes.body.data[0].amount)).toBe(4000);

    // Outstanding: 10,000 - 4,000 = 6,000, still not fully paid.
    const invRes = await client.get(`/api/sales-invoices/${invoice.id}`).set(OWNER.auth);
    expect(invRes.body.data.status).not.toBe("PAID");
  });

  it("rejects the same reference and amount posted twice on one invoice (ACC-B01)", async () => {
    const client = await api();
    const { invoice } = await makeInvoice(OWNER, 10000);
    const body = {
      amount: 3000,
      paymentDate: `${FY}-09-03`,
      instrumentType: "BANK",
      referenceNumber: `UTR${sfx}`,
    };
    const url = `/api/sales-invoices/${invoice.id}/receipts`;
    expect((await client.post(url).set(OWNER.auth).send(body)).status).toBe(201);
    const dup = await client
      .post(url)
      .set(OWNER.auth)
      .send({ ...body });
    expect(dup.status).toBe(409);
    expect(dup.body.code ?? dup.body.error?.code).toBe("DUPLICATE_RECEIPT");
    // a different amount on the same reference is a separate receipt
    expect(
      (
        await client
          .post(url)
          .set(OWNER.auth)
          .send({ ...body, amount: 1000 })
      ).status
    ).toBe(201);
    const list = await client.get(url).set(OWNER.auth);
    expect(list.body.data).toHaveLength(2);
  });

  it("a cheque receipt creates the cheque register row", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const { invoice } = await makeInvoice(OWNER, 5000);

    const res = await client
      .post(`/api/sales-invoices/${invoice.id}/receipts`)
      .set(OWNER.auth)
      .send({
        amount: 5000,
        paymentDate: `${FY}-09-05`,
        instrumentType: "CHEQUE",
        chequeNo: `CHQ${sfx}A`,
        chequeDate: `${FY}-09-05`,
        chequeBank: "Test Bank",
        chequeParty: "A Customer",
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const paymentId = res.body.data.payments[0].id as string;

    const cheque = await asDemoTenant(() =>
      prisma.cheque.findFirst({
        where: { refDocType: "SALES_PAYMENT", refDocId: paymentId, sourceDocId: invoice.id },
      })
    );
    expect(cheque).not.toBeNull();
    expect(cheque!.kind).toBe("RECEIVED");
    expect(cheque!.chequeNo).toBe(`CHQ${sfx}A`);
    expect(cheque!.status).toBe("IN_HAND");

    // The invoice is now fully paid; a same-day cheque posts its voucher immediately.
    const posted = await sideOf("SALES_PAYMENT", paymentId);
    expect(Object.values(posted.debits).reduce((s, v) => s + v, 0)).toBe(5000);

    // Reflected on the receipts list with its cheque status.
    const listRes = await client.get(`/api/sales-invoices/${invoice.id}/receipts`).set(OWNER.auth);
    expect(listRes.body.data[0].cheque).toMatchObject({ status: "IN_HAND" });
  });

  it("a post-dated cheque registers but does not post until cleared", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const { invoice } = await makeInvoice(OWNER, 7000);

    const res = await client
      .post(`/api/sales-invoices/${invoice.id}/receipts`)
      .set(OWNER.auth)
      .send({
        amount: 7000,
        paymentDate: `${FY}-09-05`,
        instrumentType: "CHEQUE",
        chequeNo: `CHQ${sfx}B`,
        chequeDate: `${FY}-09-20`, // after the payment date: post-dated
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const paymentId = res.body.data.payments[0].id as string;

    const noVoucher = await asDemoTenant(() =>
      prisma.voucher.findFirst({ where: { refDocType: "SALES_PAYMENT", refDocId: paymentId } })
    );
    expect(noVoucher).toBeNull();

    const cheque = await asDemoTenant(() =>
      prisma.cheque.findFirstOrThrow({
        where: { refDocType: "SALES_PAYMENT", refDocId: paymentId },
      })
    );
    expect(cheque.voucherId).toBeNull();

    // Clearing it posts the receipt for the first time.
    const clearRes = await client
      .post(`/api/banking/cheques/${cheque.id}/status`)
      .set(OWNER.auth)
      .send({ status: "CLEARED", on: `${FY}-09-21` });
    expect(clearRes.status, JSON.stringify(clearRes.body).slice(0, 300)).toBe(200);

    const posted = await sideOf("SALES_PAYMENT", paymentId);
    expect(Object.values(posted.debits).reduce((s, v) => s + v, 0)).toBe(7000);
  });

  it("posts the realised FX difference once on a receipt against a USD invoice at a different rate", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const company = await demoCompany();
    const customer = await createCustomer();

    await client.get("/api/currencies").set(OWNER.auth);
    const rateRes = await client
      .post("/api/currencies/rates")
      .set(OWNER.auth)
      .send({ currencyCode: "USD", rateDate: `${FY}-09-01`, rate: 83 });
    expect(rateRes.status, JSON.stringify(rateRes.body).slice(0, 300)).toBe(200);

    // $1,000 raised at 83, settled at 84: a rupee better, a ₹1,000 gain.
    const invoice = await asDemoTenant(() =>
      prisma.salesInvoice.create({
        data: {
          companyId: company.id,
          invoiceNo: `P212-SI-${sfx}`,
          invoiceDate: new Date(`${FY}-09-01T00:00:00Z`),
          customerId: customer.id,
          subTotal: 83000,
          taxTotal: 0,
          grandTotal: 83000,
          status: "CONFIRMED",
          currencyCode: "USD",
          exchangeRate: 83,
          foreignTotal: 1000,
          payments: [],
        },
      })
    );

    const ledgerBalance = async (code: string) =>
      asDemoTenant(async () => {
        const ledger = await prisma.accountLedger.findFirstOrThrow({ where: { code } });
        const items = await prisma.journalItem.findMany({
          where: {
            OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }],
            voucher: { status: "POSTED" },
          },
          select: {
            debitLedgerId: true,
            creditLedgerId: true,
            debitAmount: true,
            creditAmount: true,
          },
        });
        return items.reduce(
          (s, i) =>
            s +
            (i.debitLedgerId === ledger.id ? n(i.debitAmount) : 0) -
            (i.creditLedgerId === ledger.id ? n(i.creditAmount) : 0),
          0
        );
      });
    const gainBefore = await ledgerBalance("FX-GAIN-001");

    const res = await client
      .post(`/api/sales-invoices/${invoice.id}/receipts`)
      .set(OWNER.auth)
      .send({
        amount: 84000,
        paymentDate: `${FY}-09-05`,
        instrumentType: "BANK",
        settlementRate: 84,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const paymentId = res.body.data.payments[0].id as string;

    const gainAfter = await ledgerBalance("FX-GAIN-001");
    // FX-GAIN-001 is credit-normal: a gain moves debit-minus-credit down, not up.
    expect(Math.round(gainBefore - gainAfter)).toBe(1000);

    const fxVouchers = await asDemoTenant(() =>
      prisma.voucher.count({ where: { refDocType: "FX_REALISED", refDocId: paymentId } })
    );
    expect(fxVouchers).toBe(1);
  });

  it("refuses a receipt larger than the outstanding balance", async () => {
    const client = await api();
    const { invoice } = await makeInvoice(OWNER, 3000);

    const res = await client
      .post(`/api/sales-invoices/${invoice.id}/receipts`)
      .set(OWNER.auth)
      .send({ amount: 5000, paymentDate: `${FY}-09-05`, instrumentType: "CASH" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OVER_RECEIPT");
  });

  it("refuses a receipt against a cancelled invoice", async () => {
    const client = await api();
    const { invoice } = await makeInvoice(OWNER, 3000);

    const cancel = await client
      .post(`/api/sales-invoices/${invoice.id}/cancel`)
      .set(OWNER.auth)
      .send({ reason: "test cancellation" });
    expect(cancel.status, JSON.stringify(cancel.body).slice(0, 300)).toBe(200);

    const res = await client
      .post(`/api/sales-invoices/${invoice.id}/receipts`)
      .set(OWNER.auth)
      .send({ amount: 1000, paymentDate: `${FY}-09-05`, instrumentType: "CASH" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVOICE_CANCELLED");
  });

  it("refuses a receipt without the sales-invoices.edit permission", async () => {
    const client = await api();
    const { invoice } = await makeInvoice(OWNER, 3000);

    const res = await client
      .post(`/api/sales-invoices/${invoice.id}/receipts`)
      .set(PRODUCTION.auth)
      .send({ amount: 1000, paymentDate: `${FY}-09-05`, instrumentType: "CASH" });
    expect(res.status).toBe(403);
  });

  it("cannot record a receipt against, or see, another tenant's invoice", async () => {
    const client = await api();
    const other = await otherTenant("Sales Receipts Other Co");
    const prisma = await getPrisma();

    const foreignInvoiceId = await runAsTenant(other.id, async () => {
      const customer = await prisma.customer.create({
        data: {
          companyId: other.id,
          customerCode: `SR${sfx}CUST`,
          firmName: "Other Co Customer",
          displayName: "Other Co Customer",
          createdBy: "seed",
        },
      });
      const invoice = await prisma.salesInvoice.create({
        data: {
          companyId: other.id,
          invoiceNo: `P212-OTHER-${sfx}`,
          invoiceDate: new Date(`${FY}-09-01T00:00:00Z`),
          customerId: customer.id,
          subTotal: 1000,
          taxTotal: 0,
          grandTotal: 1000,
          status: "CONFIRMED",
          payments: [],
        },
      });
      return invoice.id;
    });

    const res = await client
      .post(`/api/sales-invoices/${foreignInvoiceId}/receipts`)
      .set(OWNER.auth)
      .send({ amount: 500, paymentDate: `${FY}-09-05`, instrumentType: "CASH" });
    expect(res.status).toBe(404);

    const listRes = await client
      .get(`/api/sales-invoices/${foreignInvoiceId}/receipts`)
      .set(OWNER.auth);
    expect(listRes.status).toBe(404);

    // The other tenant's invoice is untouched: no payment was appended from the refused call.
    const stillEmpty = await runAsTenant(other.id, () =>
      prisma.salesInvoice.findUniqueOrThrow({ where: { id: foreignInvoiceId } })
    );
    expect(Array.isArray(stillEmpty.payments) ? stillEmpty.payments.length : 0).toBe(0);
  });
});
