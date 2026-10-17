import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, createSupplier } from "../factories";
import { tdsService } from "../../src/modules/tds/tds.service";
import { ApiError } from "../../src/utils/ApiError";

/**
 * An Approved expense / a GRN with an accepted TDS deduction commits the document, its
 * TdsDeduction row and its voucher(s) together; a failing deduction rolls all of it back.
 */
const sfx = Date.now().toString(36).slice(-6);
let owner: { auth: Record<string, string> };

/** Journal lines of every POSTED voucher of a document, as "debit ledger code|credit ledger code|amount". */
const journal = async (refDocType: string, refDocId: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const vs = await prisma.voucher.findMany({
      where: { refDocType, refDocId, status: "POSTED" },
      include: { items: { include: { debitLedger: true, creditLedger: true } } },
      orderBy: { id: "asc" },
    });
    return vs.flatMap((v) =>
      v.items
        .map((i) => ({
          dr: i.debitLedger?.code ?? null,
          cr: i.creditLedger?.code ?? null,
          amt: Number(i.debitAmount) || Number(i.creditAmount),
        }))
        .sort((a, b) => `${a.dr}${a.cr}`.localeCompare(`${b.dr}${b.cr}`))
    );
  });
};
const tdsRows = async (docType: string, docId?: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() => prisma.tdsDeduction.findMany({ where: { docType, docId } }));
};

describe("TDS atomicity", () => {
  beforeAll(async () => {
    owner = await authed("demo.owner");
  });
  afterEach(() => vi.restoreAllMocks());

  describe("expense created as Approved", () => {
    let supplier: Awaited<ReturnType<typeof createSupplier>>;
    beforeAll(async () => {
      supplier = await createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY" });
    });
    const body = (tag: string) => ({
      expenseNumber: `EXP-TDS-${sfx}-${tag}`,
      status: "Approved",
      expenseCategory: "Repairs",
      date: "2026-09-07",
      expense: "Contract repair",
      amount: 50000,
      paymentMethod: "Cash",
      supplierId: supplier.id,
      tdsSection: "194C",
      deductTds: true,
    });

    it("commits expense, TDS row and voucher together", async () => {
      const res = await (await api()).post("/api/expenses").set(owner.auth).send(body("ok"));
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      const id = res.body.data.id as string;
      expect(Number(res.body.data.tdsAmount)).toBe(1000);
      const rows = await tdsRows("EXPENSE", id);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].tdsAmount)).toBe(1000);
      const lines = await journal("EXPENSE", id);
      // The voucher carries the TDS payable line (same journal as before the change).
      console.info("EXPENSE journal", JSON.stringify(lines));
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.some((l) => l.amt === 1000)).toBe(true);
    });

    it("commits nothing when the deduction fails", async () => {
      vi.spyOn(tdsService, "deduct").mockRejectedValue(new ApiError(409, "TDS refused"));
      const b = body("fail");
      const res = await (await api()).post("/api/expenses").set(owner.auth).send(b);
      expect(res.status).toBe(409);
      const prisma = await getPrisma();
      const found = await asDemoTenant(() =>
        prisma.expense.findFirst({ where: { expenseNumber: b.expenseNumber } })
      );
      expect(found).toBeNull();
    });

    it("commits nothing when the voucher cannot be posted", async () => {
      const { voucherPostingService } =
        await import("../../src/modules/accounts/voucherPosting.service");
      vi.spyOn(voucherPostingService, "postExpenseVoucher").mockResolvedValue(null);
      const b = body("vfail");
      const res = await (await api()).post("/api/expenses").set(owner.auth).send(b);
      expect(res.status).toBe(422);
      const prisma = await getPrisma();
      const found = await asDemoTenant(() =>
        prisma.expense.findFirst({ where: { expenseNumber: b.expenseNumber } })
      );
      expect(found).toBeNull();
      const stray = await asDemoTenant(() =>
        prisma.tdsDeduction.count({ where: { docType: "EXPENSE", docNo: b.expenseNumber } })
      );
      expect(stray).toBe(0);
    });
  });

  describe("GRN with a TDS-applicable supplier", () => {
    let supplier: Awaited<ReturnType<typeof createSupplier>>;
    let material: Awaited<ReturnType<typeof createRawMaterial>>;
    beforeAll(async () => {
      supplier = await createSupplier({
        pan: "AAACT1234H",
        deducteeType: "COMPANY",
        gstin: "33AAAAA0000A1Z1",
        gstRegType: "REGULAR",
      });
      material = await createRawMaterial({ baseUom: "KG", onHandQty: 0 });
    });
    const body = (tag: string) => ({
      invoiceNo: `INV-TDS-${sfx}-${tag}`,
      grnDate: new Date().toISOString().slice(0, 10),
      supplierId: supplier.id,
      storeId: "ST-RM",
      billingAddressLine1: "Plot 1, Demo Industrial Estate",
      billingCity: "Chennai",
      billingState: "Tamil Nadu",
      billingPincode: "600001",
      shippingAddressLine1: "Plot 1, Demo Industrial Estate",
      shippingCity: "Chennai",
      shippingState: "Tamil Nadu",
      shippingPincode: "600001",
      tdsSectionCode: "194C",
      deductTds: true,
      items: [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: 500,
          unitPrice: 100,
          tax: 18,
        },
      ],
    });

    it("commits GRN, TDS row, purchase voucher and TDS voucher together", async () => {
      const res = await (await api()).post("/api/grn-invoices").set(owner.auth).send(body("ok"));
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      const grn = res.body.data;
      expect(Number(grn.tdsAmount)).toBe(1000);
      const rows = await tdsRows("GRN_INVOICE", grn.id);
      expect(rows).toHaveLength(1);
      const purchase = await journal("GRN_INVOICE", grn.id);
      const tds = await journal("TDS_DEDUCTION", rows[0].id);
      console.info("GRN purchase journal", JSON.stringify(purchase));
      console.info("GRN TDS journal", JSON.stringify(tds));
      expect(purchase.length).toBeGreaterThan(1);
      expect(tds).toEqual([
        { dr: null, cr: "TDS-194C", amt: 1000 },
        { dr: expect.stringMatching(/^SUPP-/), cr: null, amt: 1000 },
      ]);
    });

    it("commits nothing when the deduction fails", async () => {
      vi.spyOn(tdsService, "deduct").mockRejectedValue(new ApiError(409, "TDS refused"));
      const b = body("fail");
      const res = await (await api()).post("/api/grn-invoices").set(owner.auth).send(b);
      expect(res.status).toBe(409);
      const prisma = await getPrisma();
      const found = await asDemoTenant(() =>
        prisma.grnInvoice.findFirst({ where: { invoiceNo: b.invoiceNo } })
      );
      expect(found).toBeNull();
      const vouchers = await asDemoTenant(() =>
        prisma.voucher.count({ where: { narration: { contains: b.invoiceNo } } })
      );
      expect(vouchers).toBe(0);
    });

    it("commits nothing when posting the TDS voucher throws", async () => {
      vi.spyOn(tdsService, "postDeductionVoucher").mockRejectedValue(
        new ApiError(422, "TDS voucher refused")
      );
      const b = body("vfail");
      const res = await (await api()).post("/api/grn-invoices").set(owner.auth).send(b);
      expect(res.status).toBe(422);
      const prisma = await getPrisma();
      const found = await asDemoTenant(() =>
        prisma.grnInvoice.findFirst({ where: { invoiceNo: b.invoiceNo } })
      );
      expect(found).toBeNull();
    });
  });
});
