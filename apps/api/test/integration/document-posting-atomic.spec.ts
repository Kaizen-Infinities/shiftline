import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createCustomer,
  createProduct,
  createRawMaterial,
  createSupplier,
} from "../factories";
import { voucherPostingService } from "../../src/modules/accounts/voucherPosting.service";

/**
 * Expense edit/approval, sales return and GRN post their vouchers inside the document's own
 * transaction: a voucher that cannot be posted fails the request and commits nothing.
 */
const sfx = Date.now().toString(36).slice(-6);
let owner: { auth: Record<string, string> };

const vouchers = async (refDocType: string, refDocId: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.voucher.findMany({ where: { refDocType, refDocId }, orderBy: { id: "asc" } })
  );
};

describe("document + voucher atomicity", () => {
  beforeAll(async () => {
    owner = await authed("demo.owner");
  });
  afterEach(() => vi.restoreAllMocks());

  describe("expense", () => {
    const create = async (suffix: string) => {
      const res = await (
        await api()
      )
        .post("/api/expenses")
        .set(owner.auth)
        .send({
          expenseNumber: `EXP-AT-${sfx}-${suffix}`,
          status: "Approved",
          expenseCategory: "Repairs",
          date: "2026-09-07",
          expense: "Repair",
          amount: 1000,
          paymentMethod: "Cash",
        });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      return res.body.data.id as string;
    };

    it("rolls back the edit and keeps the old voucher when re-posting fails", async () => {
      const id = await create("a");
      vi.spyOn(voucherPostingService, "postExpenseVoucher").mockResolvedValue(null);
      const res = await (
        await api()
      )
        .put(`/api/expenses/${id}`)
        .set(owner.auth)
        .send({ amount: 2500 });
      expect(res.status).toBe(422);
      const prisma = await getPrisma();
      const expense = await asDemoTenant(() => prisma.expense.findUniqueOrThrow({ where: { id } }));
      expect(Number(expense.amount)).toBe(1000);
      expect((await vouchers("EXPENSE", id)).map((v) => v.status)).toEqual(["POSTED"]);
    });

    it("rolls back the approval when posting fails", async () => {
      const prisma = await getPrisma();
      const res = await (
        await api()
      )
        .post("/api/expenses")
        .set(owner.auth)
        .send({
          expenseNumber: `EXP-AT-${sfx}-p`,
          status: "Pending",
          expenseCategory: "Repairs",
          date: "2026-09-07",
          expense: "Repair",
          amount: 400,
          paymentMethod: "Cash",
        });
      expect(res.status).toBe(201);
      const id = res.body.data.id as string;
      // Maker-checker: the claimant cannot approve their own claim.
      await asDemoTenant(() => prisma.expense.update({ where: { id }, data: { createdBy: null } }));
      vi.spyOn(voucherPostingService, "postExpenseVoucher").mockResolvedValue(null);
      const approve = await (await api()).post(`/api/expenses/${id}/approve`).set(owner.auth);
      expect([409, 422]).toContain(approve.status);
      const expense = await asDemoTenant(() => prisma.expense.findUniqueOrThrow({ where: { id } }));
      expect(expense.status).toBe("Pending");
      expect(await vouchers("EXPENSE", id)).toHaveLength(0);
    });
  });

  describe("sales return", () => {
    const body = (customerId: string, productId: bigint) => ({
      customerId,
      items: [{ productId: Number(productId), quantity: 1, unitPrice: 100, taxRate: 18 }],
    });

    it("posts the credit note with the return", async () => {
      const customer = await createCustomer({ stateCode: "33" });
      const product = await createProduct();
      const res = await (
        await api()
      )
        .post("/api/returns/sales")
        .set(owner.auth)
        .send(body(customer.id, product.id));
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      const posted = (await vouchers("SALES_RETURN", res.body.data.id)).filter(
        (v) => v.status === "POSTED"
      );
      expect(posted).toHaveLength(1);
    });

    it("commits no return when the credit note cannot be posted", async () => {
      const customer = await createCustomer({ stateCode: "33" });
      const product = await createProduct();
      vi.spyOn(voucherPostingService, "postSalesReturnVoucher").mockResolvedValue(null);
      const res = await (
        await api()
      )
        .post("/api/returns/sales")
        .set(owner.auth)
        .send(body(customer.id, product.id));
      expect(res.status).toBe(422);
      const prisma = await getPrisma();
      const count = await asDemoTenant(() =>
        prisma.salesReturn.count({ where: { customerId: customer.id } })
      );
      expect(count).toBe(0);
    });

    it("re-posts the credit note on edit and rolls back when that fails", async () => {
      const customer = await createCustomer({ stateCode: "33" });
      const product = await createProduct();
      const client = await api();
      const created = await client
        .post("/api/returns/sales")
        .set(owner.auth)
        .send(body(customer.id, product.id));
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;
      const bigger = {
        customerId: customer.id,
        items: [{ productId: Number(product.id), quantity: 3, unitPrice: 100, taxRate: 18 }],
      };

      const spy = vi.spyOn(voucherPostingService, "postSalesReturnVoucher");
      spy.mockResolvedValueOnce(null);
      const failed = await client.put(`/api/returns/sales/${id}`).set(owner.auth).send(bigger);
      expect(failed.status).toBe(422);
      expect((await vouchers("SALES_RETURN", id)).map((v) => v.status)).toEqual(["POSTED"]);

      spy.mockRestore();
      const ok = await client.put(`/api/returns/sales/${id}`).set(owner.auth).send(bigger);
      expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
      expect((await vouchers("SALES_RETURN", id)).map((v) => v.status)).toEqual([
        "CANCELLED",
        "POSTED",
      ]);
    });
  });

  describe("GRN", () => {
    let supplier: Awaited<ReturnType<typeof createSupplier>>;
    let rawMaterial: Awaited<ReturnType<typeof createRawMaterial>>;
    beforeAll(async () => {
      supplier = await createSupplier({ gstin: "33AAAAA0000A1Z1", gstRegType: "REGULAR" });
      rawMaterial = await createRawMaterial({ baseUom: "KG", onHandQty: 0 });
    });
    const payload = (tag: string) => ({
      invoiceNo: `INV-AT-${sfx}-${tag}`,
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
      items: [
        {
          productId: rawMaterial.rawMaterialId,
          description: rawMaterial.materialName,
          uom: "KG",
          quantity: 10,
          unitPrice: 100,
          tax: 18,
        },
      ],
    });

    it("posts the purchase voucher with the GRN", async () => {
      const res = await (await api()).post("/api/grn-invoices").set(owner.auth).send(payload("ok"));
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      const posted = (await vouchers("GRN_INVOICE", res.body.data.id)).filter(
        (v) => v.status === "POSTED"
      );
      expect(posted).toHaveLength(1);
    });

    it("commits no GRN when the purchase voucher cannot be posted", async () => {
      vi.spyOn(voucherPostingService, "postPurchaseVoucher").mockResolvedValue(null);
      const body = payload("fail");
      const res = await (await api()).post("/api/grn-invoices").set(owner.auth).send(body);
      expect(res.status).toBe(422);
      const prisma = await getPrisma();
      const count = await asDemoTenant(() =>
        prisma.grnInvoice.count({ where: { invoiceNo: body.invoiceNo } })
      );
      expect(count).toBe(0);
    });

    it("re-posts the purchase voucher on edit", async () => {
      const client = await api();
      const created = await client.post("/api/grn-invoices").set(owner.auth).send(payload("ed"));
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;
      const edited = await client
        .put(`/api/grn-invoices/${id}`)
        .set(owner.auth)
        .send({ ...payload("ed"), items: [{ ...payload("ed").items[0], quantity: 20 }] });
      expect(edited.status, JSON.stringify(edited.body).slice(0, 300)).toBe(200);
      expect((await vouchers("GRN_INVOICE", id)).map((v) => v.status)).toEqual([
        "CANCELLED",
        "POSTED",
      ]);
    });
  });
});
