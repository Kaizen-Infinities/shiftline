import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";

/**
 * Books of prime entry and the cash flow statement (P1-10b). The day book lists vouchers by
 * date, the cash and bank books are running-balance statements of the cash and bank ledgers,
 * and the indirect cash flow classifies every balance-sheet movement so that operating +
 * investing + financing equals the change in cash.
 */
const today = new Date().toISOString().slice(0, 10);
const tag = `CFTEST-${Date.now().toString(36)}`;

type CashFlow = {
  operating: { netProfit: number; depreciation: number; total: number };
  investing: { total: number; lines: { groupCode: string; amount: number }[] };
  financing: { total: number; lines: { groupCode: string; amount: number }[] };
  netChange: number;
  openingCash: number;
  closingCash: number;
  reconciles: boolean;
};

const ledgerByCode = async (code: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() => prisma.accountLedger.findFirstOrThrow({ where: { code } }));
};

describe("day book, cash book, bank book and cash flow", () => {
  it("classifies movements into operating, investing and financing and ties to cash", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const prisma = await getPrisma();

    const groupId = async (code: string) =>
      (await asDemoTenant(() => prisma.ledgerGroup.findFirstOrThrow({ where: { code } }))).id;
    const mk = async (code: string, name: string, type: string, group: string) => {
      const res = await client
        .post("/api/accounts/ledgers")
        .set(owner.auth)
        .send({ code, name, type, groupId: await groupId(group) });
      expect(res.status).toBe(201);
      return res.body.data.id as number;
    };
    const suffix = tag.slice(-5);
    const machine = await mk(`FA-${suffix}`, "Machine (Test)", "ASSET", "FIXED_ASSETS");
    const dep = await mk(`DEP-${suffix}`, "Depreciation (Test)", "EXPENSE", "DEPRECIATION");
    const capital = await mk(`CAP-${suffix}`, "Capital (Test)", "EQUITY", "CAPITAL");
    const cash = (await ledgerByCode("CASH-001")).id;
    const bank = (await ledgerByCode("BANK-001")).id;
    const sales = (await ledgerByCode("SALES-001")).id;

    const cashFlow = async () => {
      const res = await client
        .get("/api/accounts/cash-flow")
        .query({ startDate: today, endDate: today })
        .set(owner.auth);
      expect(res.status).toBe(200);
      return res.body.data as CashFlow;
    };
    const before = await cashFlow();
    expect(before.reconciles).toBe(true);

    const post = async (
      type: string,
      narration: string,
      lines: [number, number, "dr" | "cr"][]
    ) => {
      const res = await client
        .post("/api/vouchers")
        .set(owner.auth)
        .send({
          type,
          date: today,
          narration: `${tag} ${narration}`,
          items: lines.map(([ledgerId, amount, side]) =>
            side === "dr"
              ? { debitLedgerId: ledgerId, debitAmount: amount, creditAmount: 0 }
              : { creditLedgerId: ledgerId, debitAmount: 0, creditAmount: amount }
          ),
        });
      expect(res.status).toBe(201);
      return res.body.data as { id: number; voucherNo: string };
    };
    await post("RECEIPT", "capital introduced", [
      [bank, 100000, "dr"],
      [capital, 100000, "cr"],
    ]);
    await post("PAYMENT", "machine bought", [
      [machine, 40000, "dr"],
      [bank, 40000, "cr"],
    ]);
    await post("JOURNAL", "depreciation", [
      [dep, 4000, "dr"],
      [machine, 4000, "cr"],
    ]);
    const cashSale = await post("RECEIPT", "cash sale", [
      [cash, 15000, "dr"],
      [sales, 15000, "cr"],
    ]);
    const contra = await post("CONTRA", "cash deposited", [
      [bank, 5000, "dr"],
      [cash, 5000, "cr"],
    ]);

    const after = await cashFlow();
    const d = (f: (c: CashFlow) => number) => Math.round((f(after) - f(before)) * 100) / 100;
    expect(d((c) => c.operating.netProfit)).toBe(11000);
    expect(d((c) => c.operating.depreciation)).toBe(4000);
    expect(d((c) => c.operating.total)).toBe(15000);
    expect(d((c) => c.investing.total)).toBe(-40000);
    expect(d((c) => c.financing.total)).toBe(100000);
    expect(d((c) => c.netChange)).toBe(75000);
    expect(d((c) => c.closingCash)).toBe(75000);
    expect(d((c) => c.openingCash)).toBe(0);
    expect(after.reconciles).toBe(true);
    expect(after.investing.lines.find((l) => l.groupCode === "FIXED_ASSETS")).toBeDefined();
    expect(after.financing.lines.find((l) => l.groupCode === "CAPITAL")).toBeDefined();

    // Day book: the five vouchers, balanced, grouped under one date; type filter; cancellation.
    const dayBook = (extra: Record<string, string> = {}) =>
      client
        .get("/api/accounts/day-book")
        .query({ startDate: today, endDate: today, search: tag, ...extra })
        .set(owner.auth);
    let db = await dayBook();
    expect(db.status).toBe(200);
    expect(db.body.data.days).toHaveLength(1);
    expect(db.body.data.days[0].date).toBe(today);
    expect(db.body.data.voucherCount).toBe(5);
    expect(db.body.data.totalDebit).toBe(164000);
    expect(db.body.data.totalCredit).toBe(164000);
    const machineLine = db.body.data.days[0].vouchers
      .flatMap((v: { lines: { code: string; debit: number }[] }) => v.lines)
      .find((l: { code: string; debit: number }) => l.debit === 40000);
    expect(machineLine.code).toBe(`FA-${suffix}`);
    db = await dayBook({ type: "CONTRA" });
    expect(db.body.data.voucherCount).toBe(1);
    expect(db.body.data.days[0].vouchers[0].id).toBe(contra.id);

    const cancelled = await client
      .post(`/api/vouchers/${contra.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "test" });
    expect(cancelled.status).toBe(200);
    const ids = (res: { body: { data: { days: { vouchers: { id: number }[] }[] } } }) =>
      res.body.data.days.flatMap((day) => day.vouchers.map((v) => v.id));
    expect(ids(await dayBook())).not.toContain(contra.id);
    expect(ids(await dayBook({ includeCancelled: "true" }))).toContain(contra.id);

    // Cash book: cash-in-hand ledgers merged, our cash sale in it.
    const cb = await client
      .get("/api/accounts/cash-book")
      .query({ startDate: today, endDate: today, search: tag })
      .set(owner.auth);
    expect(cb.status).toBe(200);
    expect(cb.body.data.ledgers.map((l: { code: string }) => l.code)).toEqual(
      expect.arrayContaining(["CASH-001", "PCASH-001"])
    );
    expect(
      cb.body.data.entries.some((e: { voucherNo: string }) => e.voucherNo === cashSale.voucherNo)
    ).toBe(true);

    // Bank book: list bank ledgers, then one ledger's statement; a cash ledger is refused.
    const list = await client.get("/api/accounts/bank-book").set(owner.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.statement).toBeNull();
    expect(list.body.data.ledgers.map((l: { code: string }) => l.code)).toContain("BANK-001");
    const bb = await client
      .get(`/api/accounts/bank-book/${bank}`)
      .query({ startDate: today, endDate: today })
      .set(owner.auth);
    expect(bb.status).toBe(200);
    expect(bb.body.data.statement.entries.length).toBeGreaterThanOrEqual(3);
    const refused = await client.get(`/api/accounts/bank-book/${cash}`).set(owner.auth);
    expect(refused.status).toBe(400);
  });

  it("rejects bad dates and needs accounts.view", async () => {
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    expect(
      (await client.get("/api/accounts/cash-flow").query({ startDate: today }).set(owner.auth))
        .status
    ).toBe(400);
    expect(
      (
        await client
          .get("/api/accounts/cash-flow")
          .query({ startDate: "2026-09-07", endDate: "2026-09-01" })
          .set(owner.auth)
      ).status
    ).toBe(400);
    expect(
      (await client.get("/api/accounts/day-book").query({ startDate: "7/9/2026" }).set(owner.auth))
        .status
    ).toBe(400);
    for (const path of ["day-book", "cash-book", "bank-book", "cash-flow"]) {
      expect((await client.get(`/api/accounts/${path}`).set(supervisor.auth)).status).toBe(403);
    }
  });
});
