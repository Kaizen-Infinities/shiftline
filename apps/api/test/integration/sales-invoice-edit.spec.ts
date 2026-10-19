import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct } from "../factories";
import { voucherPostingService } from "../../src/modules/accounts/voucherPosting.service";

/**
 * Editing a sales invoice re-posts its voucher in the same transaction; an invoice with a live
 * IRN is not editable; a voucher that cannot be posted fails the creation as a whole.
 */
const n = (v: unknown) => Number(v);
let owner: { auth: Record<string, string> };
/** A taxable product with an HSN and rate on its master; a sale refuses a line without them. */
const taxableProduct = async () => {
  const prisma = await getPrisma();
  const hsn = await asDemoTenant(() =>
    prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } })
  );
  return createProduct({ gstRate: 18, hsnCodeId: hsn.id });
};

const body = (customerId: string, productId: bigint, rate: number, date = "2026-09-01") => ({
  invoiceDate: date,
  customerId,
  items: [{ productId: productId.toString(), qty: 1, rate }],
});

const salesVouchers = async (invoiceId: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.voucher.findMany({
      where: { refDocType: "SALES_INVOICE", refDocId: invoiceId },
      include: { items: { include: { debitLedger: true } } },
      orderBy: { id: "asc" },
    })
  );
};

describe("sales invoice edit and posting", () => {
  beforeAll(async () => {
    owner = await authed("demo.owner");
  });
  afterEach(() => vi.restoreAllMocks());

  it("cancels the old voucher and posts a new one with the new amount on edit", async () => {
    const client = await api();
    const customer = await createCustomer({ stateCode: "33" });
    const product = await taxableProduct();
    const created = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send(body(customer.id, product.id, 100));
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const id = created.body.data.id as string;
    const oldTotal = n(created.body.data.grandTotal);

    const edited = await client
      .put(`/api/sales-invoices/${id}`)
      .set(owner.auth)
      .send(body(customer.id, product.id, 500));
    expect(edited.status, JSON.stringify(edited.body).slice(0, 300)).toBe(200);
    const newTotal = n(edited.body.data.grandTotal);
    expect(newTotal).toBeGreaterThan(oldTotal);

    const vouchers = await salesVouchers(id);
    const cancelled = vouchers.filter((v) => v.status === "CANCELLED");
    const posted = vouchers.filter((v) => v.status === "POSTED");
    expect(cancelled).toHaveLength(1);
    expect(posted).toHaveLength(1);
    const debit = (v: (typeof vouchers)[number]) =>
      v.items.reduce((s, i) => s + (i.debitLedger ? n(i.debitAmount) : 0), 0);
    expect(debit(cancelled[0])).toBeCloseTo(oldTotal, 2);
    expect(debit(posted[0])).toBeCloseTo(newTotal, 2);

    // Net effect on the customer ledger: old + reversal + new == the new total.
    const prisma = await getPrisma();
    const ledger = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { customerId: customer.id } })
    );
    const lines = await asDemoTenant(() =>
      prisma.journalItem.findMany({
        where: { OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }] },
      })
    );
    const balance = lines.reduce(
      (s, i) => s + (i.debitLedgerId === ledger.id ? n(i.debitAmount) : -n(i.creditAmount)),
      0
    );
    expect(balance).toBeCloseTo(newTotal, 2);
  });

  it("refuses to edit an invoice with a live IRN", async () => {
    const client = await api();
    const customer = await createCustomer({ stateCode: "33" });
    const product = await taxableProduct();
    const created = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send(body(customer.id, product.id, 100));
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.eInvoice.create({
        data: {
          docType: "INV",
          docId: id,
          docNo: created.body.data.invoiceNo,
          docDate: new Date("2026-09-01"),
          sellerGstin: "33AAAAA0000A1Z5",
          buyerGstin: "33BBBBB0000B1Z5",
          status: "GENERATED",
          irn: "a".repeat(64),
          request: {},
        },
      })
    );
    const res = await client
      .put(`/api/sales-invoices/${id}`)
      .set(owner.auth)
      .send(body(customer.id, product.id, 500));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IRN_LIVE");
    expect((await salesVouchers(id)).filter((v) => v.status === "CANCELLED")).toHaveLength(0);
  });

  it("fails creation and commits nothing when the voucher cannot be posted", async () => {
    const client = await api();
    const customer = await createCustomer({ stateCode: "33" });
    const product = await taxableProduct();
    vi.spyOn(voucherPostingService, "postSalesVoucher").mockResolvedValue(null);
    const res = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send(body(customer.id, product.id, 100));
    expect(res.status).toBe(422);
    const prisma = await getPrisma();
    const rows = await asDemoTenant(() =>
      prisma.salesInvoice.count({ where: { customerId: customer.id } })
    );
    expect(rows).toBe(0);
  });
});
