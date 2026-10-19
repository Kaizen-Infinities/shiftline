import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

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
 * TDS on purchase bills and TCS on sales invoices (P2-05).
 *
 * The section master and the arithmetic already existed (P1-15); what did not was anything
 * calling it. So these tests exercise the document paths: a bill over the threshold deducts and
 * posts the journal, one under it does not, a 206AB supplier pays double, declining the preview
 * (`deductTds: false`) records nothing, a scrap sale collects TCS, a challan posts its own
 * journal, and cancelling either document reverses the deduction alongside the rest of the
 * reversal.
 */
const n = (v: unknown) => Number(v);
const sfx = randomUUID().slice(0, 6).toUpperCase();

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
  const total = (side: Record<string, number>) =>
    Math.round(Object.values(side).reduce((s, v) => s + v, 0) * 100) / 100;
  expect(total(debits)).toBe(total(credits));
  return { voucher, debits, credits };
};

const grnBody = (
  supplierId: number,
  material: string,
  amount: number,
  over: Record<string, unknown> = {}
) => ({
  ...GRN_ADDRESS,
  invoiceNo: `SUP-${sfx}-${Math.random().toString(36).slice(2, 6)}`,
  grnDate: "2026-09-07",
  supplierId,
  storeId: "ST-RM",
  updateStock: false,
  items: [
    {
      productId: material,
      description: "material",
      uom: "KG",
      quantity: 1,
      unitPrice: amount,
    },
  ],
  ...over,
});

describe("TDS/TCS on documents", () => {
  it("deducts TDS on a bill over the threshold and posts Dr supplier / Cr TDS-<section>", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY" });
    const material = await createRawMaterial();

    // 194C: single-payment threshold is 30,000 — this bill crosses it on its own.
    const res = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send(grnBody(supplier.id, material.rawMaterialId, 50000, { tdsSectionCode: "194C" }));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    // Not accepted yet: a preview only, nothing recorded.
    expect(res.body.data.tdsPreview).toMatchObject({ rate: 2, belowThreshold: false });
    expect(n(res.body.data.tdsAmount)).toBe(0);

    const accepted = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send(
        grnBody(supplier.id, material.rawMaterialId, 50000, {
          tdsSectionCode: "194C",
          deductTds: true,
        })
      );
    expect(accepted.status, JSON.stringify(accepted.body).slice(0, 300)).toBe(201);
    const grn = accepted.body.data;
    expect(n(grn.tdsAmount)).toBe(1000); // 2% of 50,000
    expect(grn.tdsSectionCode).toBe("194C");
    expect(grn.paymentStatus).toBe("Unpaid");

    const posted = await sideOf("TDS_DEDUCTION", await tdsDeductionIdFor("GRN_INVOICE", grn.id));
    expect(posted.credits).toMatchObject({ "TDS-194C": 1000 });
    expect(Object.values(posted.debits)).toEqual([1000]);

    // The supplier's ledger nets to netAmount - tdsAmount (purchase voucher credits netAmount,
    // the deduction voucher debits the supplier for tdsAmount).
    const prisma = await getPrisma();
    const supplierLedgerNet = await asDemoTenant(async () => {
      const ledger = await prisma.accountLedger.findFirstOrThrow({
        where: { supplierId: supplier.id },
      });
      const [d, c] = await Promise.all([
        prisma.journalItem.aggregate({
          where: { debitLedgerId: ledger.id },
          _sum: { debitAmount: true },
        }),
        prisma.journalItem.aggregate({
          where: { creditLedgerId: ledger.id },
          _sum: { creditAmount: true },
        }),
      ]);
      return n(c._sum.creditAmount) - n(d._sum.debitAmount);
    });
    // Two bills were posted for this supplier in this test (the preview-only one above, plus
    // this accepted one), each crediting the full netAmount; the TDS voucher debits only 1,000.
    expect(supplierLedgerNet).toBe(2 * n(grn.netAmount) - 1000);
  });

  it("does not deduct below the threshold", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY" });
    const material = await createRawMaterial();

    const res = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send(
        grnBody(supplier.id, material.rawMaterialId, 5000, {
          tdsSectionCode: "194C",
          deductTds: true,
        })
      );
    expect(res.status).toBe(201);
    expect(n(res.body.data.tdsAmount)).toBe(0);
    // A PENDING row is kept for the threshold running total, but nothing was actually withheld
    // and no journal was posted for it.
    const prisma = await getPrisma();
    const row = await asDemoTenant(() =>
      prisma.tdsDeduction.findFirst({ where: { docType: "GRN_INVOICE", docId: res.body.data.id } })
    );
    expect(row).not.toBeNull();
    expect(n(row!.tdsAmount)).toBe(0);
    const voucher = await asDemoTenant(() =>
      prisma.voucher.findFirst({ where: { refDocType: "TDS_DEDUCTION", refDocId: row!.id } })
    );
    expect(voucher).toBeNull();
  });

  it("deducts at the 206AB higher rate for a non-filer supplier", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({
      pan: "AAACT1234H",
      deducteeType: "COMPANY",
      higherRate206AB: true,
    });
    const material = await createRawMaterial();

    const res = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send(
        grnBody(supplier.id, material.rawMaterialId, 50000, {
          tdsSectionCode: "194C",
          deductTds: true,
        })
      );
    expect(res.status).toBe(201);
    // 194C company rate is 2%; 206AB doubles it (max(2x, 5%) = 5%... 2*2=4, so max(4,5)=5).
    expect(n(res.body.data.tdsAmount)).toBe(2500);
  });

  it("records nothing when the preview is declined", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY" });
    const material = await createRawMaterial();

    const res = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send(
        grnBody(supplier.id, material.rawMaterialId, 50000, {
          tdsSectionCode: "194C",
          deductTds: false,
        })
      );
    expect(res.status).toBe(201);
    expect(n(res.body.data.tdsAmount)).toBe(0);
    const prisma = await getPrisma();
    const row = await asDemoTenant(() =>
      prisma.tdsDeduction.findFirst({ where: { docType: "GRN_INVOICE", docId: res.body.data.id } })
    );
    expect(row).toBeNull();
  });

  it("collects TCS on a scrap sale and credits the TCS payable", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const customer = await createCustomer({ gstin: "33AAAAA0000A1Z9", stateCode: "33" });
    const product = await createProduct({ gstRate: 0 });

    const res = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2026-09-07",
        customerId: customer.id,
        collectTcs: true,
        tcsSectionCode: "206C(1)",
        items: [{ productId: product.id.toString(), qty: 1, rate: 100000 }],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const inv = res.body.data;
    expect(n(inv.tcsAmount)).toBe(1000); // 1% of 1,00,000
    expect(n(inv.grandTotal)).toBe(101000);

    const posted = await sideOf("SALES_INVOICE", inv.id);
    expect(posted.credits["TCS-206C1"]).toBe(1000);
    const totalDebit = Object.values(posted.debits).reduce((s, v) => s + v, 0);
    expect(Math.round(totalDebit * 100) / 100).toBe(101000); // customer debited the full receivable, TCS included

    const prisma = await getPrisma();
    const row = await asDemoTenant(() =>
      prisma.tdsDeduction.findFirst({ where: { docType: "SALES_INVOICE", docId: inv.id } })
    );
    expect(row).not.toBeNull();
    expect(n(row!.tdsAmount)).toBe(1000);
  });

  it("posts a challan payment Dr TDS-<section> / Cr bank", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const client = await api();
    const supplier = await createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY" });
    const material = await createRawMaterial();

    const res = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send(
        grnBody(supplier.id, material.rawMaterialId, 50000, {
          tdsSectionCode: "194C",
          deductTds: true,
        })
      );
    expect(res.status).toBe(201);
    const deductionId = await tdsDeductionIdFor("GRN_INVOICE", res.body.data.id);

    const challan = await client
      .post("/api/tds/challans")
      .set(accountant.auth)
      .send({
        bsrCode: "0510308",
        challanSerial: `PD${sfx}`.slice(0, 10),
        challanDate: "2026-09-10",
        periodKey: "2026-09",
        deductionIds: [deductionId],
      });
    expect(challan.status, JSON.stringify(challan.body).slice(0, 300)).toBe(201);

    const posted = await sideOf("TDS_CHALLAN", challan.body.data.id);
    expect(posted.debits).toMatchObject({ "TDS-194C": 1000 });
    expect(posted.credits).toMatchObject({ "BANK-001": 1000 });
  });

  it("cancelling the bill reverses the deduction and its voucher", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY" });
    const material = await createRawMaterial();

    const res = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send(
        grnBody(supplier.id, material.rawMaterialId, 50000, {
          tdsSectionCode: "194C",
          deductTds: true,
        })
      );
    expect(res.status).toBe(201);
    const deductionId = await tdsDeductionIdFor("GRN_INVOICE", res.body.data.id);

    const cancel = await client
      .post(`/api/grn-invoices/${res.body.data.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "test cancellation" });
    expect(cancel.status, JSON.stringify(cancel.body).slice(0, 300)).toBe(200);

    const prisma = await getPrisma();
    const [row, voucher] = await asDemoTenant(() =>
      Promise.all([
        prisma.tdsDeduction.findUniqueOrThrow({ where: { id: deductionId } }),
        prisma.voucher.findFirst({ where: { refDocType: "TDS_DEDUCTION", refDocId: deductionId } }),
      ])
    );
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelledAt).not.toBeNull();
    expect(voucher?.status).toBe("CANCELLED");
  });

  it("stores and returns a supplier's default TDS section (P2-11: the GRN form defaults from it)", async () => {
    const owner = await authed("demo.owner");
    const client = await api();

    const created = await client
      .post("/api/suppliers")
      .set(owner.auth)
      .send({
        supplierCode: `TDSDEF-${sfx}`,
        legalName: "Default Section Supplier (Test)",
        billingAddressLine1: "1 Demo Road",
        billingCity: "Chennai",
        billingState: "Tamil Nadu",
        billingPincode: "600001",
        stateCode: "33",
        defaultTdsSectionCode: "194C",
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(created.body.data.defaultTdsSectionCode).toBe("194C");

    const fetched = await client.get(`/api/suppliers/${created.body.data.id}`).set(owner.auth);
    expect(fetched.body.data.defaultTdsSectionCode).toBe("194C");

    const updated = await client
      .put(`/api/suppliers/${created.body.data.id}`)
      .set(owner.auth)
      .send({ defaultTdsSectionCode: "194J" });
    expect(updated.status, JSON.stringify(updated.body).slice(0, 300)).toBe(200);
    expect(updated.body.data.defaultTdsSectionCode).toBe("194J");
  });

  it("refuses TDS section edits without the permission", async () => {
    const supervisor = await authed("demo.production");
    const client = await api();
    expect(
      (
        await client
          .post("/api/tds/sections")
          .set(supervisor.auth)
          .send({ code: "194C", name: "x", rateCompany: 2, rateIndividual: 1 })
      ).status
    ).toBe(403);
  });

  it("a foreign tenant sees none of this tenant's TDS deductions", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY" });
    const material = await createRawMaterial();

    const res = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send(
        grnBody(supplier.id, material.rawMaterialId, 50000, {
          tdsSectionCode: "194C",
          deductTds: true,
        })
      );
    expect(res.status).toBe(201);
    const deductionId = await tdsDeductionIdFor("GRN_INVOICE", res.body.data.id);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "TDS Tenant B", companyCode: `TDSB-${sfx}` } })
    );
    expect(
      await runAsTenant(other.id, () =>
        prisma.tdsDeduction.findUnique({ where: { id: deductionId } })
      )
    ).toBeNull();
  });
});

/** Looks up the TdsDeduction row created for a document, inside the demo tenant. */
async function tdsDeductionIdFor(docType: string, docId: string): Promise<string> {
  const prisma = await getPrisma();
  const row = await asDemoTenant(() =>
    prisma.tdsDeduction.findFirstOrThrow({ where: { docType, docId } })
  );
  return row.id;
}
