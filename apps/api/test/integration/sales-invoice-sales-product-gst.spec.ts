import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct } from "../factories";
import {
  computeSaleLines,
  type SaleGstContext,
} from "../../src/modules/sales-invoice/sales-invoice.service";

/**
 * Tax on sales-product (kit) lines (C16). A kit has no HSN or rate of its own: its tax is its
 * components' tax. A kit line must never be taxed from the product table by the kit's id, and a
 * taxable line that resolves to no HSN or rate must not confirm.
 */
const intraState = { chargeable: true, supplyType: "INTRA_STATE" } as unknown as SaleGstContext;
const sfx = randomUUID().slice(0, 8).toUpperCase();

let owner: { auth: Record<string, string> };
let HSN_3923: string;

const createKit = async (
  components: { productId: bigint; quantity?: number }[],
  opts: { id?: bigint } = {}
) => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.salesProduct.create({
      data: {
        ...(opts.id ? { id: opts.id } : {}),
        salesProductCode: `KIT-${sfx}-${randomUUID().slice(0, 6)}`,
        salesProductName: `Kit ${sfx}`,
        rate: "100",
        components: {
          create: components.map((c) => ({
            componentProductId: c.productId,
            quantity: c.quantity ?? 1,
          })),
        },
      },
    })
  );
};

const invoiceCount = async (customerId: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() => prisma.salesInvoice.count({ where: { customerId } }));
};

describe("sales invoice tax on sales-product lines", () => {
  beforeAll(async () => {
    owner = await authed("demo.owner");
    const prisma = await getPrisma();
    HSN_3923 = (
      await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } }))
    ).id;
  });

  it("taxes a kit line at its component's 18%, split CGST and SGST inside the state", async () => {
    const component = await createProduct({ gstRate: 18, hsnCodeId: HSN_3923 });
    const kit = await createKit([{ productId: component.id }]);
    const prisma = await getPrisma();

    // A payload 0% cannot zero the kit: the kit's tax comes from its components.
    const lines = await asDemoTenant(() =>
      computeSaleLines(
        prisma,
        [
          {
            productId: kit.id.toString(),
            salesProductId: kit.id.toString(),
            qty: 2,
            rate: 100,
            taxPercent: 0,
          },
        ] as any,
        intraState
      )
    );

    expect(lines.items).toHaveLength(1);
    expect(lines.items[0]).toMatchObject({
      hsnCode: "3923",
      tax: 18,
      cgstRate: 9,
      sgstRate: 9,
      igstRate: 0,
    });
    expect(Number(lines.items[0].cgstAmount)).toBeCloseTo(18, 2);
    expect(Number(lines.items[0].sgstAmount)).toBeCloseTo(18, 2);
    expect(lines.taxTotal).toBeCloseTo(36, 2);
  });

  it("does not take the rate of an unrelated product that shares the kit's id", async () => {
    // The kit's id is deliberately the id of a product at 28%. The kit is 5% through its component.
    const unrelated = await createProduct({ gstRate: 28, hsnCodeId: HSN_3923 });
    const component = await createProduct({ gstRate: 5, hsnCodeId: HSN_3923 });
    const kit = await createKit([{ productId: component.id }], { id: unrelated.id });
    const prisma = await getPrisma();

    const [kitLine, productLine] = await asDemoTenant(() =>
      Promise.all([
        computeSaleLines(
          prisma,
          [
            { productId: kit.id.toString(), salesProductId: kit.id.toString(), qty: 1, rate: 100 },
          ] as any,
          intraState
        ),
        // A plain product line with the same number still uses that product's own rate.
        computeSaleLines(
          prisma,
          [{ productId: unrelated.id.toString(), qty: 1, rate: 100 }] as any,
          intraState
        ),
      ])
    );

    expect(kitLine.items[0].tax).toBe(5);
    expect(productLine.items[0].tax).toBe(28);
  });

  it("refuses a kit whose components disagree on the rate, naming the kit", async () => {
    const at5 = await createProduct({ gstRate: 5, hsnCodeId: HSN_3923 });
    const at18 = await createProduct({ gstRate: 18, hsnCodeId: HSN_3923 });
    const kit = await createKit([{ productId: at5.id }, { productId: at18.id }]);
    const prisma = await getPrisma();

    const attempt = asDemoTenant(() =>
      computeSaleLines(
        prisma,
        [
          { productId: kit.id.toString(), salesProductId: kit.id.toString(), qty: 1, rate: 100 },
        ] as any,
        intraState
      )
    );
    await expect(attempt).rejects.toMatchObject({ statusCode: 400 });
    await expect(attempt).rejects.toThrow(/line 1 "Kit /);
  });

  it("confirm with an unresolved kit rate is a 400 naming the line, and nothing is saved", async () => {
    const bare = await createProduct();
    const kit = await createKit([{ productId: bare.id }]);
    const customer = await createCustomer({ stateCode: "33" });
    const client = await api();

    const res = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2026-09-01",
        customerId: customer.id,
        items: [
          {
            productId: kit.id.toString(),
            salesProductId: kit.id.toString(),
            qty: 1,
            rate: 100,
          },
        ],
      });

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(res.body.message).toMatch(/^Cannot confirm the invoice: line 1 "Kit /);
    expect(res.body.message).toContain("no HSN code or GST rate");
    expect(await invoiceCount(customer.id)).toBe(0);
  });

  it("refuses a taxable product line with no HSN code or rate", async () => {
    const bare = await createProduct();
    const customer = await createCustomer({ stateCode: "33" });
    const client = await api();

    const res = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2026-09-01",
        customerId: customer.id,
        items: [{ productId: bare.id.toString(), qty: 1, rate: 100 }],
      });

    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(res.body.message).toMatch(/line 1 "/);
    expect(await invoiceCount(customer.id)).toBe(0);
  });

  it("lets a line through as nil-rated when its item master says 0% explicitly", async () => {
    const prisma = await getPrisma();
    const nil = await createProduct({ gstRate: 0 });
    const lines = await asDemoTenant(() =>
      computeSaleLines(
        prisma,
        [{ productId: nil.id.toString(), qty: 1, rate: 100 }] as any,
        intraState
      )
    );
    expect(lines.items[0].tax).toBe(0);
    expect(lines.taxTotal).toBe(0);
  });
});
