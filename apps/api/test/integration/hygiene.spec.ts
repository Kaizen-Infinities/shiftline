import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, createSupplier } from "../factories";

/**
 * Accounts hygiene (P1-10d): expense claims are approved before they reach the books, purchase
 * returns can be re-dated or annotated in place, and the payment/receipt side guard reads the
 * chart-of-accounts group rather than the ledger's name.
 */
const today = new Date().toISOString().slice(0, 10);
const sfx = Date.now().toString(36);

const expenseVoucher = async (expenseId: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.voucher.findFirst({
      where: { refDocType: "EXPENSE", refDocId: expenseId, status: "POSTED" },
    })
  );
};

describe("expense claims", () => {
  it("posts the voucher only on approval, by someone other than the claimant", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const supervisor = await authed("demo.production");
    const client = await api();

    const created = await client
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `CLM-${sfx}-1`,
        expenseCategory: "Travel & Lodging",
        date: today,
        expense: "Site visit taxi",
        amount: 1200,
        paymentMethod: "Cash",
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data.status).toBe("Draft");
    expect(await expenseVoucher(id)).toBeNull();

    // Status is not editable through PUT.
    const put = await client
      .put(`/api/expenses/${id}`)
      .set(owner.auth)
      .send({ status: "Approved" });
    expect(put.status).toBe(400);

    const submitted = await client.post(`/api/expenses/${id}/submit`).set(owner.auth);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe("Pending");
    expect(await expenseVoucher(id)).toBeNull();

    // A supervisor cannot approve; the claimant cannot approve their own claim.
    expect((await client.post(`/api/expenses/${id}/approve`).set(supervisor.auth)).status).toBe(
      403
    );
    const self = await client.post(`/api/expenses/${id}/approve`).set(owner.auth);
    expect(self.status).toBe(403);

    const approved = await client.post(`/api/expenses/${id}/approve`).set(accountant.auth);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("Approved");
    expect(approved.body.data.approvedBy).toBeTruthy();
    const voucher = await expenseVoucher(id);
    expect(voucher).not.toBeNull();

    // Approving twice is refused; cancelling reverses the voucher.
    expect((await client.post(`/api/expenses/${id}/approve`).set(accountant.auth)).status).toBe(
      409
    );
    const cancelled = await client
      .post(`/api/expenses/${id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Duplicate claim" });
    expect(cancelled.status).toBe(200);
    expect(await expenseVoucher(id)).toBeNull();
  });

  it("rejects with a reason and lets the claimant resubmit", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const client = await api();
    const created = await client
      .post("/api/expenses")
      .set(owner.auth)
      .send({
        expenseNumber: `CLM-${sfx}-2`,
        expenseCategory: "Office Supplies",
        date: today,
        expense: "Printer toner",
        amount: 3500,
        paymentMethod: "Cash",
        status: "Pending",
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    expect(
      (await client.post(`/api/expenses/${id}/reject`).set(accountant.auth).send({})).status
    ).toBe(400);
    const rejected = await client
      .post(`/api/expenses/${id}/reject`)
      .set(accountant.auth)
      .send({ reason: "No bill attached" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      status: "Rejected",
      rejectReason: "No bill attached",
    });
    expect(await expenseVoucher(id)).toBeNull();

    const again = await client.post(`/api/expenses/${id}/submit`).set(owner.auth);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ status: "Pending", rejectReason: null });
  });
});

describe("purchase return update", () => {
  it("edits the header in place and re-posts the voucher when the date moves", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const prisma = await getPrisma();
    const supplier = await createSupplier({ legalName: "Return Supplies (Test)" });
    const material = await createRawMaterial({ onHandQty: 100 });
    const created = await client
      .post("/api/returns/purchase")
      .set(owner.auth)
      .send({
        supplierId: supplier.id,
        kind: "PRICE_ADJUSTMENT",
        returnDate: today,
        reason: "Rate difference",
        items: [{ rawMaterialId: material.rawMaterialId, quantity: 2, unitPrice: 50 }],
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const vouchersOf = () =>
      asDemoTenant(() =>
        prisma.voucher.findMany({
          where: { refDocType: "PURCHASE_RETURN", refDocId: id },
          orderBy: { id: "asc" },
        })
      );
    expect((await vouchersOf()).filter((v) => v.status === "POSTED")).toHaveLength(1);

    const annotated = await client
      .put(`/api/returns/purchase/${id}`)
      .set(owner.auth)
      .send({ reason: "Rate difference agreed on phone", narration: "DN raised" });
    expect(annotated.status).toBe(200);
    expect(annotated.body.data).toMatchObject({
      reason: "Rate difference agreed on phone",
      narration: "DN raised",
    });
    expect((await vouchersOf()).filter((v) => v.status === "POSTED")).toHaveLength(1);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const moved = await client
      .put(`/api/returns/purchase/${id}`)
      .set(owner.auth)
      .send({ returnDate: yesterday });
    expect(moved.status).toBe(200);
    expect(String(moved.body.data.returnDate).slice(0, 10)).toBe(yesterday);
    const after = await vouchersOf();
    const posted = after.filter((v) => v.status === "POSTED");
    expect(posted).toHaveLength(1);
    expect(posted[0].date.toISOString().slice(0, 10)).toBe(yesterday);
    expect(after.some((v) => v.status === "CANCELLED")).toBe(true);

    expect(
      (
        await client
          .put(`/api/returns/purchase/${id}`)
          .set(owner.auth)
          .send({ returnDate: "7/9/2026" })
      ).status
    ).toBe(400);
    expect(
      (
        await client
          .put("/api/returns/purchase/00000000-0000-0000-0000-000000000000")
          .set(owner.auth)
          .send({ reason: "x" })
      ).status
    ).toBe(404);

    const cancelled = await client
      .post(`/api/returns/purchase/${id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Wrong supplier" });
    expect(cancelled.status).toBe(200);
    expect(
      (await client.put(`/api/returns/purchase/${id}`).set(owner.auth).send({ reason: "late" }))
        .status
    ).toBe(409);
  });
});

describe("payment side guard", () => {
  it("accepts any ledger under the cash or bank groups and refuses the rest", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const prisma = await getPrisma();
    const supplier = await createSupplier({ legalName: "Guarded Supplies (Test)" });
    // The factory writes the supplier straight to the database; the service makes its ledger.
    const { accountsService } = await import("../../src/modules/accounts/accounts.service");
    const supplierLedger = await asDemoTenant(() => accountsService.ensureSupplierLedger(supplier));
    const cashGroup = await asDemoTenant(() =>
      prisma.ledgerGroup.findFirstOrThrow({ where: { code: "CASH_IN_HAND" } })
    );
    const till = await client
      .post("/api/accounts/ledgers")
      .set(owner.auth)
      .send({
        code: `TILL-${sfx}`,
        name: "Front desk drawer",
        type: "ASSET",
        groupId: cashGroup.id,
      });
    expect(till.status).toBe(201);

    const pay = (creditLedgerId: number) =>
      client
        .post("/api/vouchers")
        .set(owner.auth)
        .send({
          type: "PAYMENT",
          date: today,
          narration: `guard ${sfx}`,
          items: [
            { debitLedgerId: supplierLedger.id, debitAmount: 100, creditAmount: 0 },
            { creditLedgerId, debitAmount: 0, creditAmount: 100 },
          ],
        });
    // The credit side of a payment must be money: a ledger under Cash-in-Hand passes whatever
    // it is called; the supplier's own ledger does not.
    expect((await pay(till.body.data.id)).status).toBe(201);
    const wrong = await pay(supplierLedger.id);
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/Bank or Cash/);
  });
});
