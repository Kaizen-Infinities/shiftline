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
 * Due dates and ageing (P1-10a): documents fall due after the party's credit days; unpaid
 * balances are bucketed by days past due, per party and per document, with optional interest.
 */
const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

describe("due dates and ageing", () => {
  it("dates invoices due after the customer's credit days and ages the unpaid balance", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const product = await createProduct({ gstRate: 0 });
    const slow = await createCustomer({
      stateCode: "33",
      creditDays: 30,
      overdueInterestRate: 18,
      firmName: "Slow Payer (Test)",
    });
    const prompt = await createCustomer({
      stateCode: "33",
      creditDays: null,
      firmName: "Prompt (Test)",
    });
    const early = await createCustomer({
      stateCode: "33",
      creditDays: 60,
      firmName: "Not Due (Test)",
    });

    const invoiceFor = async (customerId: string, invoiceDate: string, rate: number) => {
      const res = await client
        .post("/api/sales-invoices")
        .set(owner.auth)
        .send({
          invoiceDate,
          customerId,
          items: [{ productId: product.id.toString(), qty: 1, rate }],
        });
      expect(res.status).toBe(201);
      return res.body.data as { id: string; dueDate: string; grandTotal: string | number };
    };
    const slowInvoice = await invoiceFor(slow.id, isoDaysAgo(70), 1000);
    expect(slowInvoice.dueDate.slice(0, 10)).toBe(plusDays(isoDaysAgo(70), 30));
    const promptInvoice = await invoiceFor(prompt.id, isoDaysAgo(10), 500);
    expect(promptInvoice.dueDate.slice(0, 10)).toBe(isoDaysAgo(10));
    await invoiceFor(early.id, isoDaysAgo(10), 200);

    const report = await client.get("/api/accounts/receivable/ageing").set(owner.auth);
    expect(report.status).toBe(200);
    const rows = report.body.data.rows as {
      partyId: string;
      buckets: Record<string, number>;
      total: number;
      overdue: number;
      interest: number;
      creditDays: number | null;
    }[];
    const slowRow = rows.find((r) => r.partyId === slow.id)!;
    const slowTotal = Number(slowInvoice.grandTotal);
    expect(slowRow.buckets.d31_60).toBe(slowTotal); // 70 days old, 30 credit days → 40 overdue
    expect(slowRow.overdue).toBe(slowTotal);
    expect(slowRow.creditDays).toBe(30);
    expect(slowRow.interest).toBeCloseTo((slowTotal * 0.18 * 40) / 365, 1);
    const promptRow = rows.find((r) => r.partyId === prompt.id)!;
    expect(promptRow.buckets.d0_30).toBe(Number(promptInvoice.grandTotal));
    const earlyRow = rows.find((r) => r.partyId === early.id)!;
    expect(earlyRow.buckets.notDue).toBeGreaterThan(0);
    expect(earlyRow.overdue).toBe(0);
    expect(report.body.data.totals.total).toBeGreaterThanOrEqual(
      slowRow.total + promptRow.total + earlyRow.total
    );

    // Drill-down lists the invoices behind one customer; an as-on date before the invoice hides it.
    const detail = await client
      .get("/api/accounts/receivable/ageing")
      .query({ customerId: slow.id })
      .set(owner.auth);
    expect(detail.body.data.rows).toHaveLength(1);
    const docs = detail.body.data.rows[0].documents as {
      id: string;
      daysOverdue: number;
      bucket: string;
      dueDate: string;
    }[];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: slowInvoice.id, daysOverdue: 40, bucket: "d31_60" });
    const before = await client
      .get("/api/accounts/receivable/ageing")
      .query({ customerId: slow.id, asOnDate: isoDaysAgo(80) })
      .set(owner.auth);
    expect(before.body.data.rows[0].total).toBe(0);
    // Ageing as on the due date itself is 0 days overdue, not "not due".
    const onDue = await client
      .get("/api/accounts/receivable/ageing")
      .query({ customerId: slow.id, asOnDate: slowInvoice.dueDate.slice(0, 10) })
      .set(owner.auth);
    expect(onDue.body.data.rows[0].buckets.d0_30).toBe(slowTotal);
  });

  it("dates supplier bills due after the supplier's credit days and ages payables", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await createSupplier({ creditDays: 45, legalName: "Slow Supplier (Test)" });
    const material = await createRawMaterial();
    const grnDate = isoDaysAgo(60);
    const res = await client
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send({
        ...GRN_ADDRESS,
        invoiceNo: `SUP-AGE-${Date.now()}`,
        grnDate,
        supplierId: supplier.id,
        storeId: "ST-RM",
        updateStock: false,
        items: [
          {
            productId: material.rawMaterialId,
            description: material.materialName,
            uom: "KG",
            quantity: 10,
            unitPrice: 100,
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(String(res.body.data.billDueDate).slice(0, 10)).toBe(plusDays(grnDate, 45));

    const report = await client
      .get("/api/accounts/payable/ageing")
      .query({ supplierId: supplier.id })
      .set(owner.auth);
    expect(report.status).toBe(200);
    const row = report.body.data.rows[0];
    expect(row.partyId).toBe(String(supplier.id));
    expect(row.buckets.d0_30).toBe(Number(res.body.data.netAmount)); // 60 − 45 = 15 days overdue
    expect(row.documents[0]).toMatchObject({ daysOverdue: 15, bucket: "d0_30" });
    expect(row.interest).toBe(0);
  });

  it("validates the new credit fields and keeps ageing behind its permissions", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const customer = await createCustomer({ stateCode: "33" });
    const supplier = await createSupplier();

    const badRate = await client
      .put(`/api/customers/${customer.id}`)
      .set(owner.auth)
      .send({ overdueInterestRate: 150 });
    expect(badRate.status).toBe(400);
    const goodRate = await client
      .put(`/api/customers/${customer.id}`)
      .set(owner.auth)
      .send({ overdueInterestRate: 12.5 });
    expect(goodRate.status).toBe(200);
    const prisma = await getPrisma();
    const saved = await asDemoTenant(() =>
      prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })
    );
    expect(Number(saved.overdueInterestRate)).toBe(12.5);

    const badDays = await client
      .put(`/api/suppliers/${supplier.id}`)
      .set(owner.auth)
      .send({ creditDays: -1 });
    expect(badDays.status).toBe(400);
    const goodDays = await client
      .put(`/api/suppliers/${supplier.id}`)
      .set(owner.auth)
      .send({ creditDays: 21 });
    expect(goodDays.status).toBe(200);
    const savedSupplier = await asDemoTenant(() =>
      prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } })
    );
    expect(savedSupplier.creditDays).toBe(21);

    const stores = await authed("demo.stores");
    expect((await client.get("/api/accounts/receivable/ageing").set(stores.auth)).status).toBe(403);
    expect((await client.get("/api/accounts/payable/ageing").set(stores.auth)).status).toBe(403);
    expect(
      (
        await client
          .get("/api/accounts/receivable/ageing")
          .query({ asOnDate: "not-a-date" })
          .set(owner.auth)
      ).status
    ).toBe(400);
  });
});
