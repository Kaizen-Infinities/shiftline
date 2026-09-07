import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer } from "../factories";

/**
 * Chart-of-accounts tree (P1-09c): every tenant carries the standard Schedule III groups,
 * system and party ledgers are filed under the right nodes, custom groups nest beneath
 * a node of the same nature, and the balance sheet and P&L roll up by Schedule III head.
 */
type Node = {
  id: number;
  code: string;
  nature: string;
  parentId: number | null;
  children: Node[];
  ledgerCount: number;
};
const flatten = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

describe("ledger groups", () => {
  it("seeds the standard tree and files system and party ledgers under it", async () => {
    const prisma = await getPrisma();
    const owner = await authed("demo.owner");
    const res = await (await api()).get("/api/accounts/groups").set(owner.auth);
    expect(res.status).toBe(200);
    const all = flatten(res.body.data as Node[]);
    const codes = new Set(all.map((n) => n.code));
    for (const c of [
      "CURRENT_ASSETS",
      "BANK_ACCOUNTS",
      "SUNDRY_DEBTORS",
      "SUNDRY_CREDITORS",
      "TAX_LIABILITIES",
      "SALES_ACCOUNTS",
      "PURCHASE_ACCOUNTS",
      "CAPITAL",
      "RESERVES_SURPLUS",
      "DEPRECIATION",
    ]) {
      expect(codes.has(c), c).toBe(true);
    }
    const bank = all.find((n) => n.code === "BANK_ACCOUNTS")!;
    const currentAssets = all.find((n) => n.code === "CURRENT_ASSETS")!;
    expect(bank.parentId).toBe(currentAssets.id);
    expect(bank.nature).toBe("ASSET");

    const filed = await asDemoTenant(() =>
      prisma.accountLedger.findMany({
        where: {
          code: {
            in: [
              "CASH-001",
              "BANK-001",
              "DEBT-001",
              "CRED-001",
              "SALES-001",
              "PURCH-001",
              "CGST-LIA-001",
              "CGST-REC-001",
              "EQ-001",
            ],
          },
        },
        select: { code: true, ledgerGroup: { select: { code: true, scheduleHead: true } } },
      })
    );
    const groupOf = Object.fromEntries(filed.map((l) => [l.code, l.ledgerGroup?.code]));
    expect(groupOf).toMatchObject({
      "CASH-001": "CASH_IN_HAND",
      "BANK-001": "BANK_ACCOUNTS",
      "DEBT-001": "SUNDRY_DEBTORS",
      "CRED-001": "SUNDRY_CREDITORS",
      "SALES-001": "SALES_ACCOUNTS",
      "PURCH-001": "PURCHASE_ACCOUNTS",
      "CGST-LIA-001": "TAX_LIABILITIES",
      "CGST-REC-001": "TAX_ASSETS",
      "EQ-001": "CAPITAL",
    });
    expect(filed.find((l) => l.code === "DEBT-001")!.ledgerGroup!.scheduleHead).toBe(
      "Trade receivables"
    );

    // A new customer's ledger lands under Sundry Debtors.
    const customer = await createCustomer({ openingBalance: 5000 });
    await (await api()).get(`/api/accounts/receivable/${customer.id}`).set(owner.auth);
    const ledger = await asDemoTenant(() =>
      prisma.accountLedger.findFirst({
        where: { customerId: customer.id },
        include: { ledgerGroup: true },
      })
    );
    expect(ledger?.ledgerGroup?.code).toBe("SUNDRY_DEBTORS");

    // No tenant ledger is left without a group.
    expect(await asDemoTenant(() => prisma.accountLedger.count({ where: { groupId: null } }))).toBe(
      0
    );
  });

  it("custom groups nest under a node of the same nature and take its Schedule III head; ledgers pick a group by id or name", async () => {
    const owner = await authed("demo.owner");
    const flat = (await (await api()).get("/api/accounts/groups?flat=true").set(owner.auth)).body
      .data as (Node & { path: string; scheduleHead: string })[];
    const indirect = flat.find((n) => n.code === "INDIRECT_EXPENSES")!;
    expect(indirect.path).toBe("Indirect Expenses");
    expect(flat.find((n) => n.code === "BANK_ACCOUNTS")!.path).toBe(
      "Current Assets › Bank Accounts"
    );

    const created = await (
      await api()
    )
      .post("/api/accounts/groups")
      .set(owner.auth)
      .send({ name: "Administrative Expenses", parentId: indirect.id });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      code: "ADMINISTRATIVE_EXPENSES",
      nature: "EXPENSE",
      parentId: indirect.id,
      scheduleHead: "Other expenses",
      isSystem: false,
    });
    const groupId = created.body.data.id;

    const ledger = await (
      await api()
    )
      .post("/api/accounts/ledgers")
      .set(owner.auth)
      .send({ code: `ADM-${groupId}`, name: "Office rent", type: "EXPENSE", groupId });
    expect(ledger.status).toBe(201);
    expect(ledger.body.data.groupId).toBe(groupId);
    expect(ledger.body.data.group).toBe("Administrative Expenses");

    const byName = await (
      await api()
    )
      .post("/api/accounts/ledgers")
      .set(owner.auth)
      .send({
        code: `FIN-${groupId}`,
        name: "Bank interest",
        type: "EXPENSE",
        group: "Finance Costs",
      });
    expect(byName.status).toBe(201);
    expect(byName.body.data.group).toBe("Finance Costs");

    // Wrong nature is refused; so is moving a group across natures or deactivating one in use.
    const wrong = await (
      await api()
    )
      .post("/api/accounts/ledgers")
      .set(owner.auth)
      .send({ code: `BAD-${groupId}`, name: "Wrong", type: "ASSET", groupId });
    expect(wrong.status).toBe(400);
    const bank = flat.find((n) => n.code === "BANK_ACCOUNTS")!;
    const moved = await (
      await api()
    )
      .patch(`/api/accounts/groups/${groupId}`)
      .set(owner.auth)
      .send({ parentId: bank.id });
    expect(moved.status).toBe(400);
    const off = await (
      await api()
    )
      .patch(`/api/accounts/groups/${groupId}`)
      .set(owner.auth)
      .send({ isActive: false });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe("GROUP_IN_USE");
    const sys = await (
      await api()
    )
      .patch(`/api/accounts/groups/${bank.id}`)
      .set(owner.auth)
      .send({ isActive: false });
    expect(sys.status).toBe(400);
  });

  it("presents the balance sheet and profit and loss by Schedule III head", async () => {
    const owner = await authed("demo.owner");
    const bs = await (
      await api()
    )
      .get("/api/accounts/balance-sheet?showZeroBalance=true")
      .set(owner.auth);
    expect(bs.status).toBe(200);
    const sIII = bs.body.data.scheduleIII;
    expect(sIII.equityAndLiabilities.map((s: { section: string }) => s.section)).toEqual([
      "Shareholders' funds",
      "Non-current liabilities",
      "Current liabilities",
    ]);
    expect(sIII.assets.map((s: { section: string }) => s.section)).toEqual([
      "Non-current assets",
      "Current assets",
    ]);
    const currentAssets = sIII.assets[1];
    expect(currentAssets.heads.map((h: { head: string }) => h.head)).toContain(
      "Cash and cash equivalents"
    );
    const sideTotal = (side: { total: number }[]) => side.reduce((s, x) => s + x.total, 0);
    expect(Math.abs(sideTotal(sIII.assets) - bs.body.data.totalAssets)).toBeLessThan(0.05);
    expect(
      Math.abs(sideTotal(sIII.equityAndLiabilities) - bs.body.data.totalLiabilitiesAndEquity)
    ).toBeLessThan(0.05);

    const pnl = await (await api()).get("/api/accounts/profit-loss").set(owner.auth);
    expect(pnl.status).toBe(200);
    expect(pnl.body.data.scheduleIII.income.map((h: { head: string }) => h.head)).toEqual([
      "Revenue from operations",
      "Other income",
    ]);
    expect(pnl.body.data.scheduleIII.expenses[0].head).toBe("Cost of materials consumed");
  });
});
