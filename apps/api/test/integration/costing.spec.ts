import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";
import { costingService } from "../../src/modules/costing/costing.service";
import { valuationService } from "../../src/modules/costing/valuation.service";

/**
 * Valuation, costing, cost centres and budgets (P1-19).
 *
 * The weighted average is what most of this is about, and the bug it exists to prevent is subtle:
 * an issue must leave at the average of the day and must **not** change it. Value the issue at the
 * last receipt's rate, or recompute the average on the way out, and the closing stock quietly
 * drifts away from what was actually paid — which only shows up at a year end.
 */
const sfx = Date.now().toString(36).slice(-5);
const ITEM = `VAL-${sfx}`;
const STORE = "ST-RM";

let OWNER: { auth: Record<string, string> };

const move = async (body: Record<string, unknown>) => {
  const res = await (
    await api()
  )
    .post("/api/costing/valuation/movements")
    .set(OWNER.auth)
    .send({ itemType: "RAW_MATERIAL", itemId: ITEM, storeId: STORE, ...body });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data as {
    balanceQuantity: string;
    balanceValue: string;
    avgRate: string;
    rate: string;
    value: string;
  };
};

describe("valuation, costing, cost centres and budgets", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("weights two receipts by quantity", async () => {
    const first = await move({ movedOn: "2033-04-01", kind: "RECEIPT", quantity: 100, rate: 50 });
    expect(Number(first.avgRate)).toBe(50);

    const second = await move({ movedOn: "2033-04-05", kind: "RECEIPT", quantity: 100, rate: 60 });
    // 100 at 50 and 100 at 60 is 11,000 over 200: fifty-five, not the latest rate.
    expect(Number(second.balanceQuantity)).toBe(200);
    expect(Number(second.balanceValue)).toBe(11000);
    expect(Number(second.avgRate)).toBe(55);
  });

  it("issues at the average and leaves the average alone", async () => {
    const issue = await move({ movedOn: "2033-04-10", kind: "ISSUE", quantity: 50 });
    // It left at 55 — not at 60, the last rate paid.
    expect(Number(issue.rate)).toBe(55);
    expect(Number(issue.value)).toBe(2750);
    expect(Number(issue.balanceQuantity)).toBe(150);
    expect(Number(issue.balanceValue)).toBe(8250);
    // ...and the average is untouched. This is the assertion the whole method rests on.
    expect(Number(issue.avgRate)).toBe(55);
  });

  it("moves the average again on the next receipt, from what is left rather than from zero", async () => {
    const third = await move({ movedOn: "2033-04-15", kind: "RECEIPT", quantity: 50, rate: 75 });
    // 150 at 55 plus 50 at 75 is 12,000 over 200: sixty.
    expect(Number(third.balanceQuantity)).toBe(200);
    expect(Number(third.balanceValue)).toBe(12000);
    expect(Number(third.avgRate)).toBe(60);
  });

  it("refuses an inward movement with no rate, and flags stock that goes negative", async () => {
    const noRate = await (
      await api()
    )
      .post("/api/costing/valuation/movements")
      .set(OWNER.auth)
      .send({
        itemType: "RAW_MATERIAL",
        itemId: ITEM,
        storeId: STORE,
        movedOn: "2033-04-16",
        kind: "RECEIPT",
        quantity: 10,
      });
    expect(noRate.status).toBe(400);
    expect(noRate.body.code).toBe("RATE_REQUIRED");

    const other = `VAL-NEG-${sfx}`;
    const res = await (await api()).post("/api/costing/valuation/movements").set(OWNER.auth).send({
      itemType: "RAW_MATERIAL",
      itemId: other,
      storeId: STORE,
      movedOn: "2033-04-17",
      kind: "ISSUE",
      quantity: 5,
    });
    expect(res.status).toBe(201);
    // Issuing what is not there is allowed — production races the paperwork — but it is flagged,
    // because an average over a negative balance means nothing.
    expect(res.body.data.wentNegative).toBe(true);
  });

  it("reads the closing stock as at a date straight off the ledger", async () => {
    const before = await asDemoTenant(() =>
      valuationService.closingStock(new Date("2033-04-12T00:00:00Z"))
    );
    const row = before.rows.find((r) => r.itemId === ITEM);
    // On the 12th the third receipt has not happened: 150 at 55.
    expect(row?.quantity).toBe(150);
    expect(row?.value).toBe(8250);

    const after = await asDemoTenant(() =>
      valuationService.closingStock(new Date("2033-04-30T00:00:00Z"))
    );
    expect(after.rows.find((r) => r.itemId === ITEM)?.value).toBe(12000);
  });

  it("posts the movement in stock for a period, not the closing balance", async () => {
    const res = await (
      await api()
    )
      .post("/api/costing/valuation/2033-04/post-closing-stock")
      .set(OWNER.auth)
      .send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const out = res.body.data as {
      posted: boolean;
      opening: number;
      closing: number;
      movement: number;
    };
    expect(out.posted).toBe(true);
    // The entry is the change, not the balance; posting the balance every month would pile the
    // stock up again and again.
    expect(out.movement).toBe(Math.round((out.closing - out.opening) * 100) / 100);

    // Twice does not post twice.
    const again = await (
      await api()
    )
      .post("/api/costing/valuation/2033-04/post-closing-stock")
      .set(OWNER.auth)
      .send({});
    expect(again.body.data.posted).toBe(false);
  });

  it("reports a profit and loss by cost centre, with what is unallocated shown rather than spread", async () => {
    const client = await api();
    const centre = await client
      .post("/api/costing/cost-centres")
      .set(OWNER.auth)
      .send({ code: `CC${sfx}`, name: `Moulding ${sfx}`, kind: "PRODUCTION" });
    expect(centre.status).toBe(200);

    const prisma = await getPrisma();
    const ledgers = await asDemoTenant(async () => ({
      expense: await prisma.accountLedger.findFirstOrThrow({ where: { code: "EXP-001" } }),
      cash: await prisma.accountLedger.findFirstOrThrow({ where: { code: "CASH-001" } }),
    }));
    const voucher = await client
      .post("/api/vouchers")
      .set(OWNER.auth)
      .send({
        type: "PAYMENT",
        date: "2033-05-10",
        narration: `Costing test ${sfx}`,
        items: [
          { debitLedgerId: ledgers.expense.id, debitAmount: 4000, creditAmount: 0 },
          { creditLedgerId: ledgers.cash.id, debitAmount: 0, creditAmount: 4000 },
        ],
      });
    expect(voucher.status).toBe(201);

    const items = await asDemoTenant(() =>
      prisma.journalItem.findMany({ where: { voucherId: voucher.body.data.id } })
    );
    const expenseLine = items.find((i) => i.debitLedgerId === ledgers.expense.id)!;
    const tagged = await client
      .post("/api/costing/cost-centres/tag")
      .set(OWNER.auth)
      .send({ journalItemIds: [expenseLine.id], costCentreId: centre.body.data.id });
    expect(tagged.status).toBe(200);
    expect(tagged.body.data.tagged).toBe(1);

    const pl = await asDemoTenant(() =>
      costingService.costCentreProfitAndLoss(
        new Date("2033-05-01T00:00:00Z"),
        new Date("2033-05-31T00:00:00Z")
      )
    );
    // Codes are stored upper-cased, as every code in the product is.
    const row = pl.rows.find((r) => r.code === `CC${sfx}`.toUpperCase());
    expect(row?.expense).toBe(4000);
    // The report names an unallocated figure instead of quietly spreading it over the centres,
    // which would make every centre wrong by an unknown amount.
    expect(pl).toHaveProperty("unallocatedResult");
  });

  it("reads a budget variance with the sign the right way round for income and for expense", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const { expense, sales } = await asDemoTenant(async () => ({
      expense: await prisma.accountLedger.findFirstOrThrow({ where: { code: "EXP-001" } }),
      sales: await prisma.accountLedger.findFirstOrThrow({ where: { code: "SALES-001" } }),
    }));

    // Budget 10,000 of expense; 4,000 was spent, so 6,000 is left and that is favourable.
    const b1 = await client
      .post("/api/costing/budgets")
      .set(OWNER.auth)
      .send({ fyCode: "2033-34", periodKey: "2033-05", ledgerId: expense.id, amount: 10000 });
    expect(b1.status).toBe(200);
    const b2 = await client
      .post("/api/costing/budgets")
      .set(OWNER.auth)
      .send({ fyCode: "2033-34", periodKey: "2033-05", ledgerId: sales.id, amount: 500000 });
    expect(b2.status).toBe(200);

    const res = await client
      .get("/api/costing/budgets/2033-34/variance")
      .query({ periodKey: "2033-05" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as {
      ledgerType: string;
      budget: number;
      actual: number;
      variance: number;
      favourable: boolean;
    }[];
    const exp = rows.find((r) => r.ledgerType === "EXPENSE")!;
    expect(exp.actual).toBeGreaterThanOrEqual(4000);
    // Under budget on a cost is favourable: budget less actual.
    expect(exp.variance).toBe(Math.round((exp.budget - exp.actual) * 100) / 100);
    expect(exp.favourable).toBe(true);

    const inc = rows.find((r) => r.ledgerType === "INCOME")!;
    // Under budget on income is adverse: actual less budget, and the sign flips.
    expect(inc.variance).toBe(Math.round((inc.actual - inc.budget) * 100) / 100);
    expect(inc.favourable).toBe(false);

    // Saving the same scope twice updates rather than duplicating, nulls included.
    const again = await client
      .post("/api/costing/budgets")
      .set(OWNER.auth)
      .send({ fyCode: "2033-34", periodKey: "2033-05", ledgerId: expense.id, amount: 12000 });
    expect(again.body.data.id).toBe(b1.body.data.id);
    expect(Number(again.body.data.amount)).toBe(12000);
  });

  it("builds a cost sheet from what was issued, crediting the scrap back", async () => {
    const prisma = await getPrisma();
    const product = await asDemoTenant(() => prisma.product.findFirstOrThrow());
    const issueItem = `CS-${sfx}`;
    await asDemoTenant(async () => {
      await valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: issueItem,
        storeId: STORE,
        movedOn: "2033-06-01",
        kind: "RECEIPT",
        quantity: 100,
        rate: 40,
      });
      await valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: issueItem,
        storeId: STORE,
        movedOn: "2033-06-05",
        kind: "ISSUE",
        quantity: 80,
        refDocType: "PRODUCTION_ORDER",
        refDocId: `PO-${sfx}`,
      });
      await valuationService.record({
        itemType: "RAW_MATERIAL",
        itemId: issueItem,
        storeId: STORE,
        movedOn: "2033-06-06",
        kind: "SCRAP",
        quantity: 5,
      });
    });

    const res = await (
      await api()
    )
      .post("/api/costing/cost-sheets")
      .set(OWNER.auth)
      .send({
        productId: String(product.id),
        periodKey: "2033-06",
        quantityProduced: 150,
        labourCost: 3000,
        overheadCost: 1000,
        overheadBasis: "QUANTITY",
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const sheet = res.body.data as {
      materialCost: string;
      scrapCredit: string;
      totalCost: string;
      perUnitCost: string;
      overheadBasis: string;
    };
    // 80 kilos issued at the average of 40.
    expect(Number(sheet.materialCost)).toBe(3200);
    // The scrap left at the same average and comes off the cost of the good output — carrying it
    // at full material cost would overstate the finished goods by the value of the waste.
    expect(Number(sheet.scrapCredit)).toBe(200);
    expect(Number(sheet.totalCost)).toBe(3200 + 3000 + 1000 - 200);
    expect(Number(sheet.perUnitCost)).toBeCloseTo(7000 / 150, 3);
    // The rule the overhead was spread by is recorded, so the number can be argued with.
    expect(sheet.overheadBasis).toBe("QUANTITY");
  });

  it("refuses a user without the permission and hides another tenant's valuation", async () => {
    const client = await api();
    const production = await authed("demo.production");
    expect(
      (await client.get("/api/costing/valuation/closing-stock").set(production.auth)).status
    ).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Costing Tenant B", companyCode: `CSB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.stockValuationEntry.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.stockValuationEntry.count())).toBeGreaterThan(0);
  });
});
