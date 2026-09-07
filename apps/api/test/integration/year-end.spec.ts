import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";
import { resetPeriodControl } from "../helpers/books";

/**
 * Year-end closing (P1-09e): the closing journal moves the year's result to Retained Earnings,
 * closes the year's periods, opens the next year's period and numbering, and freezes the books.
 * Approval refuses stale preparations; a closing is reversed, never deleted.
 */
type Auth = Record<string, string>;

const ledger = async (code: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() => prisma.accountLedger.findFirstOrThrow({ where: { code } }));
};

const postJournal = async (
  auth: Auth,
  date: string,
  debitCode: string,
  creditCode: string,
  amount: number
) => {
  const [dr, cr] = await Promise.all([ledger(debitCode), ledger(creditCode)]);
  const res = await (
    await api()
  )
    .post("/api/vouchers")
    .set(auth)
    .send({
      type: "JOURNAL",
      date,
      narration: `year-end test ${date}`,
      items: [
        { debitLedgerId: dr.id, debitAmount: amount, creditAmount: 0 },
        { creditLedgerId: cr.id, debitAmount: 0, creditAmount: amount },
      ],
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: number };
};

const tbRow = async (auth: Auth, asOnDate: string, code: string) => {
  const res = await (
    await api()
  )
    .get("/api/accounts/trial-balance")
    .query({ asOnDate, showZeroBalance: "true" })
    .set(auth);
  expect(res.status).toBe(200);
  return res.body.data.rows.find((r: { code: string }) => r.code === code) as
    { closingBalance: number; debitBalance: number; creditBalance: number } | undefined;
};

describe("year-end closing", () => {
  // Closing a year freezes the books and closes periods; other specs must not inherit that.
  beforeAll(resetPeriodControl);
  afterAll(resetPeriodControl);

  it("refuses to approve a preparation the books have moved past, then closes after re-preparing", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    await postJournal(owner.auth, "2024-01-10", "CASH-001", "SALES-001", 500);

    const prepared = await client
      .post("/api/year-end/prepare")
      .set(owner.auth)
      .send({ fyCode: "2023-24" });
    expect(prepared.status).toBe(201);
    expect(prepared.body.data.status).toBe("PREPARED");
    expect(prepared.body.data.netProfit).toBe(500);

    await postJournal(owner.auth, "2024-02-01", "CASH-001", "SALES-001", 100);
    const stale = await client
      .post(`/api/year-end/${prepared.body.data.id}/approve`)
      .set(owner.auth);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("YEAR_END_STALE");

    const preview = await client
      .get("/api/year-end/preview")
      .query({ fyCode: "2023-24" })
      .set(owner.auth);
    expect(preview.body.data.stale).toBe(true);

    const discarded = await client
      .post(`/api/year-end/${prepared.body.data.id}/discard`)
      .set(owner.auth);
    expect(discarded.status).toBe(200);
    expect(discarded.body.data.status).toBe("DISCARDED");

    const again = await client
      .post("/api/year-end/prepare")
      .set(owner.auth)
      .send({ fyCode: "2023-24" });
    expect(again.status).toBe(201);
    expect(again.body.data.netProfit).toBe(600);
    const approved = await client
      .post(`/api/year-end/${again.body.data.id}/approve`)
      .set(owner.auth);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
    expect(approved.body.data.closingVoucher.voucherNo).toMatch(/^JV\/2023-24\//);
  });

  it("closes FY 2024-25: result to Retained Earnings, periods closed, next year opened, books frozen", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const period = await client
      .post("/api/accounts/periods")
      .set(owner.auth)
      .send({ periodName: "FY 2024-25 (test)", startDate: "2024-04-01", endDate: "2025-03-31" });
    expect(period.status).toBe(201);
    await postJournal(owner.auth, "2025-01-15", "CASH-001", "SALES-001", 1000);
    await postJournal(owner.auth, "2025-02-10", "EXP-001", "CASH-001", 400);

    const preview = await client
      .get("/api/year-end/preview")
      .query({ fyCode: "2024-25" })
      .set(owner.auth);
    expect(preview.status).toBe(200);
    expect(preview.body.data.netProfit).toBe(600);
    expect(preview.body.data.canPrepare).toBe(true);
    expect(preview.body.data.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SALES-001", side: "DEBIT", amount: 1000 }),
        expect.objectContaining({ code: "EXP-001", side: "CREDIT", amount: 400 }),
        expect.objectContaining({ code: "EQ-002", side: "CREDIT", amount: 600 }),
      ])
    );

    const prepared = await client
      .post("/api/year-end/prepare")
      .set(owner.auth)
      .send({ fyCode: "2024-25", notes: "test close" });
    expect(prepared.status).toBe(201);
    const id = prepared.body.data.id as number;

    const auditor = await authed("demo.auditor");
    expect((await client.post(`/api/year-end/${id}/approve`).set(auditor.auth)).status).toBe(403);

    const approved = await client.post(`/api/year-end/${id}/approve`).set(owner.auth);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");
    expect(approved.body.data.closingVoucher.voucherNo).toMatch(/^JV\/2024-25\//);

    // Post-closing trial balance: income and expense at zero, the result in Retained Earnings.
    const sales = await tbRow(owner.auth, "2025-03-31", "SALES-001");
    const expense = await tbRow(owner.auth, "2025-03-31", "EXP-001");
    const retained = await tbRow(owner.auth, "2025-03-31", "EQ-002");
    expect(Math.abs(sales?.closingBalance ?? 0)).toBeLessThan(0.01);
    expect(Math.abs(expense?.closingBalance ?? 0)).toBeLessThan(0.01);
    expect(Math.abs(retained?.closingBalance ?? 0)).toBe(1200); // 600 (FY 2023-24) + 600

    // The statement of profit and loss still shows the year as earned.
    const pnl = await client
      .get("/api/accounts/profit-loss")
      .query({ startDate: "2024-04-01", endDate: "2025-03-31" })
      .set(owner.auth);
    expect(pnl.status).toBe(200);
    expect(pnl.body.data.netProfit).toBe(600);

    // The balance sheet carries the result once, in Retained Earnings.
    const bs = await client
      .get("/api/accounts/balance-sheet")
      .query({ asOnDate: "2025-03-31" })
      .set(owner.auth);
    expect(bs.status).toBe(200);
    const equity = bs.body.data.equity as { code: string; balance: number }[];
    expect(equity.find((e) => e.code === "EQ-002")?.balance).toBe(1200);
    expect(equity.find((e) => e.code === "NET-PNL")).toBeUndefined();

    // Books frozen up to the year end; the year's period closed; the next year open and numbered.
    const control = await client.get("/api/accounts/period-control").set(owner.auth);
    expect(control.body.data.booksFrozenUpTo).toBe("2025-03-31");
    const periods = control.body.data.periods as {
      periodName: string;
      isClosed: boolean;
    }[];
    expect(periods.find((p) => p.periodName === "FY 2024-25 (test)")?.isClosed).toBe(true);
    expect(periods.some((p) => p.periodName === "FY 2025-26")).toBe(true);
    const refused = await client
      .post("/api/vouchers")
      .set(owner.auth)
      .send({
        type: "JOURNAL",
        date: "2025-02-01",
        items: [
          { debitLedgerId: (await ledger("CASH-001")).id, debitAmount: 10, creditAmount: 0 },
          { creditLedgerId: (await ledger("SALES-001")).id, debitAmount: 0, creditAmount: 10 },
        ],
      });
    expect(refused.status).toBe(403);
    // The closed-period gate runs first; either refusal keeps the closed year intact.
    expect(["PERIOD_CLOSED", "BOOKS_FROZEN"]).toContain(refused.body.code);
    const prisma = await getPrisma();
    const seq = await asDemoTenant(() =>
      prisma.documentSequence.findFirst({
        where: { docType: "SALES_INVOICE", fyCode: "2025-26", businessPlaceId: null },
      })
    );
    expect(seq?.next).toBe(1);

    expect(
      (await client.post("/api/year-end/prepare").set(owner.auth).send({ fyCode: "2024-25" }))
        .status
    ).toBe(409);
    const list = await client.get("/api/year-end").set(owner.auth);
    expect(list.body.data.map((c: { fyCode: string }) => c.fyCode)).toEqual(
      expect.arrayContaining(["2024-25", "2023-24"])
    );
  });

  it("reverses a closing only after the freeze date is moved back, cancelling its journal", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const list = await client.get("/api/year-end").set(owner.auth);
    const closing = list.body.data.find(
      (c: { fyCode: string; status: string }) => c.fyCode === "2024-25" && c.status === "APPROVED"
    );
    expect(closing).toBeDefined();

    const frozen = await client
      .post(`/api/year-end/${closing.id}/reverse`)
      .set(owner.auth)
      .send({ reason: "late supplier bill" });
    expect(frozen.status).toBe(409);
    expect(frozen.body.code).toBe("BOOKS_FROZEN");

    expect(
      (
        await client
          .put("/api/accounts/period-control")
          .set(owner.auth)
          .send({ booksFrozenUpTo: "2024-03-31", allowBack: true })
      ).status
    ).toBe(200);
    const reversed = await client
      .post(`/api/year-end/${closing.id}/reverse`)
      .set(owner.auth)
      .send({ reason: "late supplier bill" });
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.status).toBe("REVERSED");
    const prisma = await getPrisma();
    const voucher = await asDemoTenant(() =>
      prisma.voucher.findUniqueOrThrow({ where: { id: closing.closingVoucher.id } })
    );
    expect(voucher.status).toBe("CANCELLED");
    // The voucher screen refuses to cancel a closing entry on its own.
    const direct = await client
      .post(`/api/vouchers/${closing.closingVoucher.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "x" });
    expect([400, 409]).toContain(direct.status);

    const preview = await client
      .get("/api/year-end/preview")
      .query({ fyCode: "2024-25" })
      .set(owner.auth);
    expect(preview.body.data.existing).toBeNull();
    expect(preview.body.data.netProfit).toBe(600);
  });

  it("refuses a year that has not ended and hides itself from users without the permission", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const y =
      new Date().getUTCMonth() >= 3 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
    const current = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    const early = await client
      .post("/api/year-end/prepare")
      .set(owner.auth)
      .send({ fyCode: current });
    expect(early.status).toBe(400);
    expect(early.body.code).toBe("YEAR_END_BLOCKED");
    expect(
      (await client.get("/api/year-end/preview").query({ fyCode: "2024-2025" }).set(owner.auth))
        .status
    ).toBe(400);

    const stores = await authed("demo.stores");
    expect((await client.get("/api/year-end/preview").set(stores.auth)).status).toBe(403);
    const auditor = await authed("demo.auditor");
    expect((await client.get("/api/year-end/preview").set(auditor.auth)).status).toBe(200);
    expect(
      (await client.post("/api/year-end/prepare").set(auditor.auth).send({ fyCode: "2022-23" }))
        .status
    ).toBe(403);
  });
});
