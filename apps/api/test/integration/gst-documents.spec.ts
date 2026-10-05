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
  demoCompany,
} from "../factories";
import {
  documentNumberService,
  fyCodeFor,
} from "../../src/modules/documents/document-number.service";

/**
 * GST on documents (P1-08b): series numbering, place of supply and the
 * CGST/SGST/IGST split from state codes, HSN per line, bills of supply for
 * composition dealers, reverse charge on purchases, credit and debit notes from
 * returns, GST and TDS on expenses and petty cash — and the vouchers each posts.
 */
const fy = fyCodeFor(new Date(), 4);
const n = (v: unknown) => Number(v);
const seriesRe = (prefix: string) => new RegExp(`^${prefix}/${fy}/\\d{4}$`);

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
  expect(total(debits)).toBe(total(credits));
  return { voucher, debits, credits };
};

describe("gst on documents", () => {
  const sfx = randomUUID().slice(0, 6).toUpperCase();
  let hsnId: string;
  let invoice: any;
  let product: Awaited<ReturnType<typeof createProduct>>;
  let customer: Awaited<ReturnType<typeof createCustomer>>;

  beforeAll(async () => {
    const prisma = await getPrisma();
    hsnId = (await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } })))
      .id;
  });

  it("numbers documents per type, financial year and branch, without gaps", async () => {
    const prisma = await getPrisma();
    await asDemoTenant(async () => {
      const first = await documentNumberService.next("SALES_INVOICE");
      const second = await documentNumberService.next("SALES_INVOICE");
      expect(first).toMatch(seriesRe("INV"));
      expect(n(second.split("/")[2])).toBe(n(first.split("/")[2]) + 1);

      // `next()` with no place uses the company-wide series, so peek that one (a bare peek()
      // follows the head-office place, which other specs in the same worker may have advanced).
      const peeked = await documentNumberService.peek("SALES_INVOICE", { businessPlaceId: null });
      expect(n(peeked.split("/")[2])).toBe(n(second.split("/")[2]) + 1);
      expect(await documentNumberService.peek("SALES_INVOICE", { businessPlaceId: null })).toBe(
        peeked
      );

      // A branch runs its own series under the place code.
      const factory = await prisma.businessPlace.findFirstOrThrow({ where: { code: "F1" } });
      expect(
        await documentNumberService.next("DELIVERY_CHALLAN", { businessPlaceId: factory.id })
      ).toBe(`DC-F1/${fy}/0001`);
      expect(await documentNumberService.next("DELIVERY_CHALLAN")).toBe(`DC/${fy}/0001`);
    });

    // Forms ask the API what the next save would take; peeking never consumes a number.
    const owner = await authed("demo.owner");
    const peek = await (
      await api()
    )
      .get("/api/documents/next-number?docType=SALES_INVOICE")
      .set(owner.auth);
    expect(peek.status).toBe(200);
    expect(peek.body.data.number).toMatch(seriesRe("INV"));
    expect(
      (await (await api()).get("/api/documents/next-number?docType=SALES_INVOICE").set(owner.auth))
        .body.data.number
    ).toBe(peek.body.data.number);
    expect(
      (await (await api()).get("/api/documents/next-number?docType=NOPE").set(owner.auth)).status
    ).toBe(400);

    expect(fyCodeFor(new Date("2026-03-31T00:00:00Z"), 4)).toBe("2025-26");
    expect(fyCodeFor(new Date("2026-04-01T00:00:00Z"), 4)).toBe("2026-27");
    expect(fyCodeFor(new Date("2026-04-01T00:00:00Z"), 1)).toBe("2026");
  });

  it("a tax invoice takes HSN and rate from the product and splits CGST/SGST within the state", async () => {
    const owner = await authed("demo.owner");
    customer = await createCustomer({
      gstin: "33AAAAA0000A1Z9",
      gstRegType: "REGULAR",
      stateCode: "33",
    });
    product = await createProduct({ hsnCodeId: hsnId });

    const res = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2026-09-07",
        customerId: customer.id,
        items: [{ productId: product.id.toString(), qty: 10, rate: 100 }],
      });
    expect(res.status).toBe(201);
    invoice = res.body.data;
    expect(invoice.invoiceNo).toMatch(seriesRe("INV"));
    expect(invoice).toMatchObject({
      documentType: "TAX_INVOICE",
      supplyType: "INTRA_STATE",
      placeOfSupply: "33",
      customerGstin: "33AAAAA0000A1Z9",
    });
    expect(invoice.businessPlaceId).toBeTruthy();
    expect(invoice.items[0]).toMatchObject({ hsnCode: "3923" });
    expect(n(invoice.items[0].tax)).toBe(18);
    expect(n(invoice.items[0].cgstAmount)).toBe(90);
    expect(n(invoice.items[0].sgstAmount)).toBe(90);
    expect(n(invoice.items[0].igstAmount)).toBe(0);
    expect(n(invoice.taxTotal)).toBe(180);
    expect(n(invoice.grandTotal)).toBe(1180);

    const { voucher, credits, debits } = await sideOf("SALES_INVOICE", invoice.id);
    expect(String(voucher.businessPlaceId)).toBe(String(invoice.businessPlaceId));
    expect(credits).toMatchObject({ "SALES-001": 1000, "CGST-LIA-001": 90, "SGST-LIA-001": 90 });
    expect(Object.values(debits)).toEqual([1180]);
  });

  it("an inter-state supply carries IGST; a line rate and HSN in the payload win over the master", async () => {
    const owner = await authed("demo.owner");
    const outOfState = await createCustomer({
      gstin: "29AAAAA0000A1ZY",
      gstRegType: "REGULAR",
      stateCode: "29",
    });
    const res = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2026-09-07",
        customerId: outOfState.id,
        items: [
          {
            productId: product.id.toString(),
            qty: 2,
            rate: 500,
            taxPercent: 12,
            hsnCode: "39269099",
          },
        ],
      });
    expect(res.status).toBe(201);
    const inv = res.body.data;
    expect(inv).toMatchObject({ supplyType: "INTER_STATE", placeOfSupply: "29" });
    expect(inv.items[0]).toMatchObject({ hsnCode: "39269099" });
    expect(n(inv.items[0].igstRate)).toBe(12);
    expect(n(inv.items[0].igstAmount)).toBe(120);
    expect(n(inv.items[0].cgstAmount)).toBe(0);
    expect(n(inv.taxTotal)).toBe(120);
    const { credits } = await sideOf("SALES_INVOICE", inv.id);
    expect(credits).toMatchObject({ "SALES-001": 1000, "IGST-LIA-001": 120 });
    expect(credits["CGST-LIA-001"]).toBeUndefined();
  });

  it("a composition dealer issues a bill of supply from its own series and charges no tax", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const company = await demoCompany();
    await asDemoTenant(() =>
      prisma.company.update({
        where: { id: company.id },
        data: { gstRegistrationType: "COMPOSITION" },
      })
    );
    try {
      const res = await (
        await api()
      )
        .post("/api/sales-invoices")
        .set(owner.auth)
        .send({
          invoiceDate: "2026-09-07",
          customerId: customer.id,
          items: [{ productId: product.id.toString(), qty: 1, rate: 1000, taxPercent: 18 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.documentType).toBe("BILL_OF_SUPPLY");
      expect(res.body.data.invoiceNo).toMatch(seriesRe("BOS"));
      expect(n(res.body.data.taxTotal)).toBe(0);
      expect(n(res.body.data.grandTotal)).toBe(1000);
      expect(n(res.body.data.items[0].tax)).toBe(0);
    } finally {
      await asDemoTenant(() =>
        prisma.company.update({
          where: { id: company.id },
          data: { gstRegistrationType: "REGULAR" },
        })
      );
    }
  });

  it("a GRN under reverse charge owes the tax to the government, not the supplier", async () => {
    const owner = await authed("demo.owner");
    const supplier = await createSupplier({
      gstRegType: "UNREGISTERED",
      gstin: null,
      stateCode: "33",
    });
    const material = await createRawMaterial({ hsnCodeId: hsnId });

    const res = await (
      await api()
    )
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send({
        ...GRN_ADDRESS,
        invoiceNo: `SUP-${sfx}`,
        grnDate: "2026-09-07",
        supplierId: supplier.id,
        storeId: "ST-RM",
        reverseCharge: true,
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
    const grn = res.body.data;
    expect(grn.grnNumber).toMatch(seriesRe("GRN"));
    expect(grn).toMatchObject({
      supplyType: "INTRA_STATE",
      placeOfSupply: "33",
      reverseCharge: true,
    });
    expect(grn.items[0]).toMatchObject({ hsnCode: "3923" });
    expect(n(grn.items[0].tax)).toBe(18);
    expect(n(grn.items[0].cgstAmount)).toBe(90);
    expect(n(grn.totalTax)).toBe(180);
    expect(n(grn.netAmount)).toBe(1000); // the supplier's bill carries no GST

    const { debits, credits } = await sideOf("GRN_INVOICE", grn.id);
    expect(debits).toMatchObject({ "PURCH-001": 1000, "RCM-REC-001": 180 });
    expect(credits).toMatchObject({ "RCM-LIA-001": 180 });
    expect(Object.values(credits).sort()).toEqual([1000, 180].sort());

    // Next GRN number is offered from the same series.
    const next = await (await api()).get("/api/grn-invoices/next-code").set(owner.auth);
    expect(next.body.data).toMatch(seriesRe("GRN"));
  });

  it("a sales return raises a credit note that mirrors the invoice's tax split", async () => {
    const owner = await authed("demo.owner");
    const res = await (
      await api()
    )
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
            quantity: 2,
            unitPrice: 100,
          },
        ],
      });
    expect(res.status).toBe(201);
    const ret = res.body.data;
    expect(ret.returnNo).toMatch(seriesRe("SR"));
    expect(ret.creditNoteNo).toMatch(seriesRe("CN"));
    expect(ret).toMatchObject({
      kind: "GOODS_RETURN",
      supplyType: "INTRA_STATE",
      placeOfSupply: "33",
    });
    expect(String(ret.businessPlaceId)).toBe(String(invoice.businessPlaceId));
    expect(ret.items[0]).toMatchObject({ hsnCode: "3923" });
    expect(n(ret.items[0].taxRate)).toBe(18);
    expect(n(ret.items[0].cgstAmount)).toBe(18);
    expect(n(ret.items[0].sgstAmount)).toBe(18);
    expect(n(ret.taxAmount)).toBe(36);
    expect(n(ret.grandTotal)).toBe(236);

    const { debits, credits } = await sideOf("SALES_RETURN", ret.id);
    expect(debits).toMatchObject({ "SRT-001": 200, "CGST-LIA-001": 18, "SGST-LIA-001": 18 });
    expect(Object.values(credits)).toEqual([236]);

    // Over-returning the same line is refused.
    const again = await (
      await api()
    )
      .post("/api/returns/sales")
      .set(owner.auth)
      .send({
        customerId: customer.id,
        salesInvoiceId: invoice.id,
        items: [
          {
            productId: Number(product.id),
            salesInvoiceItemId: invoice.items[0].id,
            quantity: 9,
            unitPrice: 100,
          },
        ],
      });
    expect(again.status).toBe(400);
  });

  it("a purchase return raises a debit note; a price adjustment moves no stock", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: "33AAAAA0000A1Z9",
      stateCode: "33",
    });
    const material = await createRawMaterial({ hsnCodeId: hsnId, onHandQty: 500 });
    const onHand = async () =>
      n(
        (
          await asDemoTenant(() =>
            prisma.rawMaterial.findUniqueOrThrow({ where: { id: material.id } })
          )
        ).onHandQty
      );

    const adjustment = await (
      await api()
    )
      .post("/api/returns/purchase")
      .set(owner.auth)
      .send({
        supplierId: supplier.id,
        kind: "PRICE_ADJUSTMENT",
        reason: "Rate difference",
        items: [{ rawMaterialId: material.rawMaterialId, quantity: 10, unitPrice: 5 }],
      });
    expect(adjustment.status).toBe(201);
    const dn = adjustment.body.data;
    expect(dn.returnNo).toMatch(seriesRe("PR"));
    expect(dn.debitNoteNo).toMatch(seriesRe("DN"));
    expect(dn).toMatchObject({ kind: "PRICE_ADJUSTMENT", supplierGstin: "33AAAAA0000A1Z9" });
    expect(dn.items[0]).toMatchObject({ hsnCode: "3923" });
    expect(n(dn.items[0].taxRate)).toBe(18);
    expect(n(dn.cgstAmount)).toBe(4.5);
    expect(n(dn.sgstAmount)).toBe(4.5);
    expect(n(dn.grandTotal)).toBe(59);
    expect(await onHand()).toBe(500);
    expect(
      await asDemoTenant(() =>
        prisma.stockAdjustment.count({
          where: { sourceDocument: "PURCHASE_RETURN", sourceDocId: dn.id },
        })
      )
    ).toBe(0);
    const { debits, credits } = await sideOf("PURCHASE_RETURN", dn.id);
    expect(Object.values(debits)).toEqual([59]);
    expect(credits).toMatchObject({ "PRT-001": 50, "CGST-REC-001": 4.5, "SGST-REC-001": 4.5 });

    const goods = await (
      await api()
    )
      .post("/api/returns/purchase")
      .set(owner.auth)
      .send({
        supplierId: supplier.id,
        storeId: "ST-RM",
        items: [{ rawMaterialId: material.rawMaterialId, quantity: 5, unitPrice: 100 }],
      });
    expect(goods.status).toBe(201);
    expect(goods.body.data.kind).toBe("GOODS_RETURN");
    expect(await onHand()).toBe(495);
  });

  it("an expense books GST input credit and TDS payable; reverse charge posts to the RCM ledgers", async () => {
    const owner = await authed("demo.owner");
    const fees = await (
      await api()
    )
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `EXP-${sfx}-1`,
        status: "Approved",
        expenseCategory: "Professional Fees",
        date: "2026-09-07",
        expense: "Statutory audit",
        amount: 11800,
        paymentMethod: "Bank Transfer",
        vendorGstin: "33aaaaa0000a1z9",
        hsnCode: "9982",
        gstRate: 18,
        tdsSection: "194J",
        tdsRate: 10,
      });
    expect(fees.status).toBe(201);
    const exp = fees.body.data;
    expect(exp).toMatchObject({
      vendorGstin: "33AAAAA0000A1Z9",
      supplyType: "INTRA_STATE",
      itcEligible: true,
    });
    expect(n(exp.taxableAmount)).toBe(10000);
    expect(n(exp.cgstAmount)).toBe(900);
    expect(n(exp.sgstAmount)).toBe(900);
    expect(n(exp.tdsAmount)).toBe(1000);
    const posted = await sideOf("EXPENSE", exp.id);
    expect(posted.debits).toMatchObject({
      "EXP-001": 10000,
      "CGST-REC-001": 900,
      "SGST-REC-001": 900,
    });
    expect(posted.credits).toMatchObject({ "TDS-LIA-001": 1000, "BANK-001": 10800 });

    const freight = await (
      await api()
    )
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `EXP-${sfx}-2`,
        status: "Approved",
        expenseCategory: "Freight",
        date: "2026-09-07",
        expense: "Inward freight (GTA)",
        amount: 5000,
        paymentMethod: "Cash",
        gstRate: 5,
        reverseCharge: true,
      });
    expect(freight.status).toBe(201);
    expect(n(freight.body.data.taxableAmount)).toBe(5000);
    expect(n(freight.body.data.cgstAmount)).toBe(125);
    const rcm = await sideOf("EXPENSE", freight.body.data.id);
    expect(rcm.debits).toMatchObject({ "EXP-001": 5000, "RCM-REC-001": 250 });
    expect(rcm.credits).toMatchObject({ "RCM-LIA-001": 250, "CASH-001": 5000 });

    // Blocked credit (s.17(5)): the tax stays in the expense.
    const meals = await (
      await api()
    )
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `EXP-${sfx}-3`,
        status: "Approved",
        expenseCategory: "Staff Welfare",
        date: "2026-09-07",
        expense: "Team lunch",
        amount: 1050,
        paymentMethod: "Cash",
        vendorGstin: "33AAAAA0000A1Z9",
        gstRate: 5,
        itcEligible: false,
      });
    expect(meals.status).toBe(201);
    const blocked = await sideOf("EXPENSE", meals.body.data.id);
    expect(blocked.debits).toEqual({ "EXP-001": 1050 });
    expect(blocked.credits).toEqual({ "CASH-001": 1050 });

    const bad = await (
      await api()
    )
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `EXP-${sfx}-4`,
        status: "Approved",
        expenseCategory: "Misc",
        date: "2026-09-07",
        expense: "Bad GSTIN",
        amount: 100,
        paymentMethod: "Cash",
        vendorGstin: "33AAAAA0000A1Z5",
      });
    expect(bad.status).toBe(400);
  });

  it("petty cash claims input credit only against a GSTIN-bearing bill", async () => {
    const owner = await authed("demo.owner");
    const withGstin = await (await api()).post("/api/petty-cash").set(owner.auth).send({
      category: "Stationery",
      description: "Printer paper",
      amount: 1180,
      type: "OUT",
      vendorGstin: "29AAAAA0000A1ZY",
      gstRate: 18,
    });
    expect(withGstin.status).toBe(201);
    expect(n(withGstin.body.data.taxAmount)).toBe(180);
    const claimed = await sideOf("PETTY_CASH", String(withGstin.body.data.id));
    expect(claimed.debits).toMatchObject({ "EXP-001": 1000, "IGST-REC-001": 180 });
    expect(claimed.credits).toEqual({ "PCASH-001": 1180 });

    const cashMemo = await (await api()).post("/api/petty-cash").set(owner.auth).send({
      category: "Refreshments",
      description: "Tea",
      amount: 236,
      type: "OUT",
      gstRate: 18,
    });
    expect(cashMemo.status).toBe(201);
    expect(n(cashMemo.body.data.taxAmount)).toBe(0);
    const absorbed = await sideOf("PETTY_CASH", String(cashMemo.body.data.id));
    expect(absorbed.debits).toEqual({ "EXP-001": 236 });
  });
});
