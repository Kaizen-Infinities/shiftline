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
import { voucherPostingService } from "../../src/modules/accounts/voucherPosting.service";

/**
 * Cancel and reverse (P1-09b): nothing on the books is deleted. A cancelled document stays on
 * file, its vouchers are marked CANCELLED and mirrored by a reversal, and every balance nets out.
 */
const n = (v: unknown) => Number(v);

const ledgerNet = async (ledgerId: number) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const [d, c] = await Promise.all([
      prisma.journalItem.aggregate({
        where: { debitLedgerId: ledgerId },
        _sum: { debitAmount: true },
      }),
      prisma.journalItem.aggregate({
        where: { creditLedgerId: ledgerId },
        _sum: { creditAmount: true },
      }),
    ]);
    return Math.round((n(d._sum.debitAmount ?? 0) - n(c._sum.creditAmount ?? 0)) * 100) / 100;
  });
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

describe("cancellation", () => {
  it("cancels a sales invoice: status, reversal voucher, customer ledger and outstanding net to zero, and the sync leaves it alone", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const customer = await createCustomer({ stateCode: "33" });
    const product = await createProduct();
    const before = n(customer.outstandingAmount);

    const created = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2026-09-07",
        customerId: customer.id,
        items: [{ productId: product.id.toString(), qty: 2, rate: 500, taxPercent: 18 }],
      });
    expect(created.status).toBe(201);
    const invoice = created.body.data;
    const ledger = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { customerId: customer.id } })
    );
    expect(await ledgerNet(ledger.id)).toBe(1180);

    const cancelled = await (
      await api()
    )
      .delete(`/api/sales-invoices/${invoice.id}`)
      .set(owner.auth)
      .send({ reason: "Raised on the wrong customer" });
    expect(cancelled.status).toBe(200);

    const row = await asDemoTenant(() =>
      prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
    );
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelReason).toBe("Raised on the wrong customer");
    expect(row.cancelledAt).not.toBeNull();

    const vouchers = await asDemoTenant(() =>
      prisma.voucher.findMany({
        where: {
          OR: [{ refDocType: "SALES_INVOICE", refDocId: invoice.id }, { refDocType: "REVERSAL" }],
        },
        include: { items: true },
        orderBy: { id: "asc" },
      })
    );
    const original = vouchers.find((v) => v.refDocType === "SALES_INVOICE")!;
    const reversal = vouchers.find((v) => v.reversalOfId === original.id)!;
    expect(original.status).toBe("CANCELLED");
    expect(original.cancelSeq).toBe(original.id);
    expect(reversal).toBeDefined();
    expect(reversal.type).toBe("JOURNAL");
    expect(reversal.voucherNo).toBe(`REV-${original.voucherNo}`.slice(0, 30));
    // Sides swapped, amounts mirrored.
    const debits = (v: typeof original) =>
      v.items.filter((i) => n(i.debitAmount) > 0).map((i) => [i.debitLedgerId, n(i.debitAmount)]);
    const credits = (v: typeof original) =>
      v.items
        .filter((i) => n(i.creditAmount) > 0)
        .map((i) => [i.creditLedgerId, n(i.creditAmount)]);
    expect(credits(reversal).sort()).toEqual(debits(original).sort());
    expect(debits(reversal).sort()).toEqual(credits(original).sort());

    expect(await ledgerNet(ledger.id)).toBe(0);
    const after = await asDemoTenant(() =>
      prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })
    );
    expect(n(after.outstandingAmount)).toBe(before);

    // Cancelling twice is refused; the sync does not re-post a cancelled document.
    const again = await (await api()).delete(`/api/sales-invoices/${invoice.id}`).set(owner.auth);
    expect(again.status).toBe(409);
    await asDemoTenant(() => (voucherPostingService as any)._doSyncUnpostedVouchers());
    const posted = await asDemoTenant(() =>
      prisma.voucher.count({
        where: { refDocType: "SALES_INVOICE", refDocId: invoice.id, status: "POSTED" },
      })
    );
    expect(posted).toBe(0);

    // The trial balance still balances.
    const tb = await (await api()).get("/api/accounts/trial-balance").set(owner.auth);
    expect(tb.status).toBe(200);
    const rows: { closingBalance: number; type: string }[] = tb.body.data.rows;
    const drCr = rows.reduce(
      (acc, r) => {
        const isDr = r.type === "ASSET" || r.type === "EXPENSE";
        if (isDr) acc.dr += n(r.closingBalance);
        else acc.cr += n(r.closingBalance);
        return acc;
      },
      { dr: 0, cr: 0 }
    );
    expect(Math.abs(drCr.dr - drCr.cr)).toBeLessThan(0.05);
  });

  it("cancels a GRN: stock comes back and the purchase voucher is reversed", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const supplier = await createSupplier({
      gstRegType: "REGULAR",
      gstin: "33AAAAA0000A1Z9",
      stateCode: "33",
    });
    const material = await createRawMaterial({ onHandQty: 100 });
    const res = await (
      await api()
    )
      .post("/api/grn-invoices")
      .set(owner.auth)
      .send({
        ...GRN_ADDRESS,
        invoiceNo: `CANCEL-${material.rawMaterialId}`,
        grnDate: "2026-09-07",
        supplierId: supplier.id,
        storeId: "ST-RM",
        updateStock: true,
        items: [
          {
            productId: material.rawMaterialId,
            description: material.materialName,
            uom: "KG",
            quantity: 10,
            unitPrice: 50,
            tax: 18,
          },
        ],
      });
    expect(res.status).toBe(201);
    const grn = res.body.data;
    const onHand = async () =>
      n(
        (
          await asDemoTenant(() =>
            prisma.rawMaterial.findUniqueOrThrow({ where: { id: material.id } })
          )
        ).onHandQty
      );
    expect(await onHand()).toBe(110);

    const cancelled = await (
      await api()
    )
      .post(`/api/grn-invoices/${grn.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Duplicate bill" });
    expect(cancelled.status).toBe(200);
    expect(await onHand()).toBe(100);
    const row = await asDemoTenant(() =>
      prisma.grnInvoice.findUniqueOrThrow({ where: { id: grn.id } })
    );
    expect(row.status).toBe("CANCELLED");
    const original = await asDemoTenant(() =>
      prisma.voucher.findFirstOrThrow({ where: { refDocType: "GRN_INVOICE", refDocId: grn.id } })
    );
    expect(original.status).toBe("CANCELLED");
    const supplierLedger = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { supplierId: supplier.id } })
    );
    expect(await ledgerNet(supplierLedger.id)).toBe(0);
  });

  it("cancels a manual voucher with a reversal, but points document vouchers back to their document", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const cash = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { code: "CASH-001" } })
    );
    const bank = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { code: "BANK-001" } })
    );
    const created = await (
      await api()
    )
      .post("/api/vouchers")
      .set(owner.auth)
      .send({
        type: "CONTRA",
        date: "2026-09-07",
        narration: "Cash deposited",
        items: [
          { debitLedgerId: bank.id, debitAmount: 700, creditAmount: 0 },
          { creditLedgerId: cash.id, debitAmount: 0, creditAmount: 700 },
        ],
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const cashBefore = await ledgerNet(cash.id);

    const cancelled = await (
      await api()
    )
      .post(`/api/vouchers/${id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Wrong amount" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.reversalNo).toMatch(/^REV-/);
    expect(await ledgerNet(cash.id)).toBe(cashBefore + 700);
    expect((await (await api()).delete(`/api/vouchers/${id}`).set(owner.auth)).status).toBe(409);

    // A reversal cannot itself be cancelled, and a document's voucher must be cancelled through the document.
    expect(
      (
        await (
          await api()
        )
          .delete(`/api/vouchers/${cancelled.body.data.reversalId}`)
          .set(owner.auth)
      ).status
    ).toBe(400);
    const expense = await (
      await api()
    )
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `EXP-V-${Date.now().toString().slice(-6)}`,
        status: "Approved",
        expenseCategory: "Misc",
        date: "2026-09-07",
        expense: "Courier",
        amount: 300,
        paymentMethod: "Cash",
      });
    expect(expense.status).toBe(201);
    const docVoucher = await asDemoTenant(() =>
      prisma.voucher.findFirstOrThrow({
        where: { refDocType: "EXPENSE", refDocId: expense.body.data.id, status: "POSTED" },
      })
    );
    const viaVoucher = await (await api()).delete(`/api/vouchers/${docVoucher.id}`).set(owner.auth);
    expect(viaVoucher.status).toBe(400);
    expect(viaVoucher.body.code).toBe("CANCEL_DOCUMENT_INSTEAD");

    // Opening balance vouchers are protected.
    const opening = await asDemoTenant(() =>
      prisma.voucher.findFirst({
        where: { refDocType: { in: ["CUSTOMER_OPENING_BALANCE", "LEDGER_OPENING_BALANCE"] } },
      })
    );
    if (opening) {
      expect(
        (await (await api()).delete(`/api/vouchers/${opening.id}`).set(owner.auth)).status
      ).toBe(400);
    }
  });

  it("cancels an expense with its voucher and mirrored petty-cash entry; an edit reverses and re-posts", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const number = `EXP-C-${Date.now().toString().slice(-6)}`;
    const created = await (await api()).post("/api/expenses").set(owner.auth).send({
      expenseNumber: number,
      status: "Approved",
      expenseCategory: "Repairs",
      date: "2026-09-07",
      expense: "Machine repair",
      amount: 2000,
      paymentMethod: "Cash",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const edited = await (
      await api()
    )
      .put(`/api/expenses/${id}`)
      .set(owner.auth)
      .send({ amount: 2500 });
    expect(edited.status).toBe(200);
    const afterEdit = await asDemoTenant(() =>
      prisma.voucher.findMany({
        where: { refDocType: "EXPENSE", refDocId: id },
        orderBy: { id: "asc" },
      })
    );
    expect(afterEdit.map((v) => v.status)).toEqual(["CANCELLED", "POSTED"]);

    const cancelled = await (
      await api()
    )
      .delete(`/api/expenses/${id}`)
      .set(owner.auth)
      .send({ reason: "Not ours" });
    expect(cancelled.status).toBe(200);
    const expense = await asDemoTenant(() => prisma.expense.findUniqueOrThrow({ where: { id } }));
    expect(expense.cancelledAt).not.toBeNull();
    const posted = await asDemoTenant(() =>
      prisma.voucher.count({ where: { refDocType: "EXPENSE", refDocId: id, status: "POSTED" } })
    );
    expect(posted).toBe(0);
    const mirror = await asDemoTenant(() =>
      prisma.pettyCashEntry.findFirstOrThrow({ where: { entryNo: `PC-EXP-${number}` } })
    );
    expect(mirror.status).toBe("CANCELLED");
  });
});
