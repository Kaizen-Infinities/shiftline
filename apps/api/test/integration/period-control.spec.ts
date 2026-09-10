import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct } from "../factories";
import { resetPeriodControl } from "../helpers/books";

/**
 * Period control (P1-09a): a closed period, the company freeze date and a role's backdating
 * allowance each refuse postings, on documents and on manual vouchers alike.
 */
const invoiceBody = (customerId: string, productId: bigint, invoiceDate: string) => ({
  invoiceDate,
  customerId,
  items: [{ productId: productId.toString(), qty: 1, rate: 100 }],
});

describe("period control", () => {
  beforeAll(resetPeriodControl);
  afterAll(resetPeriodControl);

  it("refuses documents and vouchers dated inside a closed period, and allows them again after reopening", async () => {
    const owner = await authed("demo.owner");
    const customer = await createCustomer({ stateCode: "33" });
    const product = await createProduct();

    const created = await (
      await api()
    )
      .post("/api/accounts/periods")
      .set(owner.auth)
      .send({ periodName: "FY 2020-21 (test)", startDate: "2020-04-01", endDate: "2021-03-31" });
    expect(created.status).toBe(201);
    const periodId = created.body.data.id;
    expect(
      (await (await api()).post(`/api/accounts/periods/${periodId}/close`).set(owner.auth)).status
    ).toBe(200);

    const refused = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send(invoiceBody(customer.id, product.id, "2020-06-15"));
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("PERIOD_CLOSED");

    const prisma = await getPrisma();
    const cash = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { code: "CASH-001" } })
    );
    const bank = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { code: "BANK-001" } })
    );
    const voucher = await (
      await api()
    )
      .post("/api/vouchers")
      .set(owner.auth)
      .send({
        type: "CONTRA",
        date: "2020-06-15",
        items: [
          { debitLedgerId: cash.id, debitAmount: 500, creditAmount: 0 },
          { creditLedgerId: bank.id, debitAmount: 0, creditAmount: 500 },
        ],
      });
    expect(voucher.status).toBe(403);
    expect(voucher.body.code).toBe("PERIOD_CLOSED");

    expect(
      (await (await api()).post(`/api/accounts/periods/${periodId}/reopen`).set(owner.auth)).status
    ).toBe(200);
    const allowed = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send(invoiceBody(customer.id, product.id, "2020-06-15"));
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.invoiceNo).toMatch(/^INV\/2020-21\//);
  });

  it("freezes the books up to a date, only moves the freeze forward unless told otherwise, and blocks reopening behind it", async () => {
    const owner = await authed("demo.owner");
    const customer = await createCustomer({ stateCode: "33" });
    const product = await createProduct();

    const set = await (
      await api()
    )
      .put("/api/accounts/period-control")
      .set(owner.auth)
      .send({ booksFrozenUpTo: "2019-03-31" });
    expect(set.status).toBe(200);
    expect(set.body.data.booksFrozenUpTo).toBe("2019-03-31");

    const control = await (await api()).get("/api/accounts/period-control").set(owner.auth);
    expect(control.body.data.booksFrozenUpTo).toBe("2019-03-31");
    expect(Array.isArray(control.body.data.roles)).toBe(true);

    const frozen = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send(invoiceBody(customer.id, product.id, "2019-03-31"));
    expect(frozen.status).toBe(403);
    expect(frozen.body.code).toBe("BOOKS_FROZEN");

    const dayAfter = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send(invoiceBody(customer.id, product.id, "2019-04-01"));
    expect(dayAfter.status).toBe(201);

    // A period behind the freeze date cannot be reopened.
    const period = await (
      await api()
    )
      .post("/api/accounts/periods")
      .set(owner.auth)
      .send({ periodName: "FY 2018-19 (test)", startDate: "2018-04-01", endDate: "2019-03-31" });
    await (await api()).post(`/api/accounts/periods/${period.body.data.id}/close`).set(owner.auth);
    const reopen = await (
      await api()
    )
      .post(`/api/accounts/periods/${period.body.data.id}/reopen`)
      .set(owner.auth);
    expect(reopen.status).toBe(409);
    expect(reopen.body.code).toBe("BOOKS_FROZEN");

    const back = await (
      await api()
    )
      .put("/api/accounts/period-control")
      .set(owner.auth)
      .send({ booksFrozenUpTo: null });
    expect(back.status).toBe(409);
    const cleared = await (
      await api()
    )
      .put("/api/accounts/period-control")
      .set(owner.auth)
      .send({ booksFrozenUpTo: null, allowBack: true });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.booksFrozenUpTo).toBeNull();
    await (await api()).post(`/api/accounts/periods/${period.body.data.id}/reopen`).set(owner.auth);
  });

  it("limits how far back a role may post; the owner and platform admins are unlimited", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const accountsRole = await asDemoTenant(() =>
      prisma.role.findFirstOrThrow({ where: { code: "ACCOUNTS" } })
    );
    const setLimit = await (
      await api()
    )
      .patch(`/api/roles/${accountsRole.id}`)
      .set(owner.auth)
      .send({ backdateDays: 0 });
    expect(setLimit.status).toBe(200);

    try {
      const accountant = await authed("demo.accounts");
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const late = await (await api()).post("/api/petty-cash").set(accountant.auth).send({
        entryDate: yesterday,
        category: "Stationery",
        description: "Backdated",
        amount: 50,
        type: "OUT",
      });
      expect(late.status).toBe(403);
      expect(late.body.code).toBe("BACKDATE_LIMIT");
      expect(late.body.details.backdateDays).toBe(0);

      const today = await (
        await api()
      )
        .post("/api/petty-cash")
        .set(accountant.auth)
        .send({ category: "Stationery", description: "Today", amount: 50, type: "OUT" });
      expect(today.status).toBe(201);

      const ownerLate = await (await api()).post("/api/petty-cash").set(owner.auth).send({
        entryDate: yesterday,
        category: "Stationery",
        description: "Owner backdated",
        amount: 50,
        type: "OUT",
      });
      expect(ownerLate.status).toBe(201);
    } finally {
      await (
        await api()
      )
        .patch(`/api/roles/${accountsRole.id}`)
        .set(owner.auth)
        .send({ backdateDays: null });
    }
  });
});
