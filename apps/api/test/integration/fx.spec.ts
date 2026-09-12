import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createSalesInvoice } from "../factories";
import { apportion, landedCostOf } from "../../src/modules/currency/imports.service";

/**
 * Foreign exchange and imports (P1-17).
 *
 * Two things are tested hardest because both are silent when wrong: an unrealised restatement
 * that is not reversed doubles the next month's exchange gain, and an import that puts the IGST
 * into the cost of the goods overstates stock and throws the credit away.
 */
const sfx = Date.now().toString(36).slice(-5);

let OWNER: { auth: Record<string, string> };

const ledgerBalance = async (code: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const ledger = await prisma.accountLedger.findFirstOrThrow({ where: { code } });
    const items = await prisma.journalItem.findMany({
      where: {
        OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }],
        voucher: { status: "POSTED" },
      },
      select: { debitLedgerId: true, creditLedgerId: true, debitAmount: true, creditAmount: true },
    });
    return items.reduce(
      (s, i) =>
        s +
        (i.debitLedgerId === ledger.id ? Number(i.debitAmount) : 0) -
        (i.creditLedgerId === ledger.id ? Number(i.creditAmount) : 0),
      0
    );
  });
};

describe("foreign exchange and imports", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("pulls the day's rates and says which currencies had none", async () => {
    const res = await (
      await api()
    )
      .post("/api/fx/rates/pull")
      .set(OWNER.auth)
      .send({ on: "2032-05-10", provider: "FIXTURE", currencies: ["USD", "EUR", "XYZ"] });
    expect(res.status).toBe(200);
    const out = res.body.data as { fetched: number; missing: string[] };
    expect(out.fetched).toBe(2);
    // A currency the feed does not carry is named rather than silently treated as zero.
    expect(out.missing).toEqual(["XYZ"]);

    const prisma = await getPrisma();
    const stored = await asDemoTenant(() =>
      prisma.exchangeRate.findFirst({
        where: { currencyCode: "USD", rateDate: new Date("2032-05-10T00:00:00Z") },
      })
    );
    expect(stored).not.toBeNull();
    expect(Number(stored!.rate)).toBeGreaterThan(70);
  });

  it("posts a realised gain when the rupee moved between raising and settling", async () => {
    const gainBefore = await ledgerBalance("FX-GAIN-001");
    const res = await (
      await api()
    )
      .post("/api/fx/realise")
      .set(OWNER.auth)
      .send({
        documentType: "SALES_INVOICE",
        documentId: `fx-doc-${sfx}-a`,
        documentNo: `FXT-${sfx}A`,
        partyLedgerCode: "DEBT-001",
        currencyCode: "USD",
        foreignAmount: 1000,
        bookedRate: 83,
        settledRate: 84,
        on: "2032-05-20",
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    // 1,000 dollars, one rupee better: a thousand-rupee gain, on the settlement date.
    expect(res.body.data.difference).toBe(1000);
    expect(res.body.data.posted).toBe(true);
    expect(Math.round(gainBefore - (await ledgerBalance("FX-GAIN-001")))).toBe(1000);
  });

  it("posts a realised loss the other way, and never twice for the same document", async () => {
    const lossBefore = await ledgerBalance("FX-LOSS-001");
    const body = {
      documentType: "SALES_INVOICE",
      documentId: `fx-doc-${sfx}-b`,
      documentNo: `FXT-${sfx}B`,
      partyLedgerCode: "DEBT-001",
      currencyCode: "USD",
      foreignAmount: 500,
      bookedRate: 84,
      settledRate: 83.5,
      on: "2032-05-21",
    };
    const first = await (await api()).post("/api/fx/realise").set(OWNER.auth).send(body);
    expect(first.status).toBe(200);
    expect(first.body.data.difference).toBe(-250);
    expect(Math.round((await ledgerBalance("FX-LOSS-001")) - lossBefore)).toBe(250);

    // The same document again finds the voucher already there rather than posting a second one.
    const again = await (await api()).post("/api/fx/realise").set(OWNER.auth).send(body);
    expect(again.status).toBe(200);
    expect(again.body.data.posted).toBe(false);
    expect(Math.round((await ledgerBalance("FX-LOSS-001")) - lossBefore)).toBe(250);
  });

  it("does not post a difference worth less than a paisa", async () => {
    const res = await (
      await api()
    )
      .post("/api/fx/realise")
      .set(OWNER.auth)
      .send({
        documentType: "SALES_INVOICE",
        documentId: `fx-doc-${sfx}-c`,
        documentNo: `FXT-${sfx}C`,
        partyLedgerCode: "DEBT-001",
        currencyCode: "USD",
        foreignAmount: 1,
        bookedRate: 83,
        settledRate: 83.000001,
        on: "2032-05-22",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.posted).toBe(false);
  });

  it("splits an import: duty into the cost of the goods, IGST into the credit ledger", async () => {
    const purchBefore = await ledgerBalance("PURCH-001");
    const igstBefore = await ledgerBalance("IGST-REC-001");
    const customsBefore = await ledgerBalance("CUSTOMS-PAY-001");

    const res = await (
      await api()
    )
      .post("/api/fx/bills-of-entry")
      .set(OWNER.auth)
      .send({
        beNumber: `BE${sfx}1`,
        beDate: "2032-06-05",
        portCode: "INMAA1",
        currencyCode: "USD",
        exchangeRate: 83,
        foreignValue: 10000,
        assessableValue: 830000,
        basicDuty: 83000,
        socialWelfareSurcharge: 8300,
        igst: 165834,
        otherCharges: 20000,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const be = res.body.data as { landedCost: string; igst: string };
    // What the goods cost: assessable value plus the duty, surcharge and charges — and NOT the
    // IGST, which is creditable.
    expect(Number(be.landedCost)).toBe(941300);

    expect(Math.round((await ledgerBalance("PURCH-001")) - purchBefore)).toBe(111300);
    expect(Math.round((await ledgerBalance("IGST-REC-001")) - igstBefore)).toBe(165834);
    expect(Math.round(customsBefore - (await ledgerBalance("CUSTOMS-PAY-001")))).toBe(277134);

    // The same bill of entry twice is refused.
    const twice = await (
      await api()
    )
      .post("/api/fx/bills-of-entry")
      .set(OWNER.auth)
      .send({
        beNumber: `BE${sfx}1`,
        beDate: "2032-06-05",
        exchangeRate: 83,
        foreignValue: 10000,
      });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("DUPLICATE_BOE");
  });

  it("apportions landed cost by value and keeps the rounding", () => {
    expect(
      landedCostOf({
        assessableValue: 1000,
        basicDuty: 100,
        socialWelfareSurcharge: 10,
        otherCharges: 40,
      })
    ).toBe(1150);

    const shares = apportion(1000, [
      { id: "a", value: 333 },
      { id: "b", value: 333 },
      { id: "c", value: 334 },
    ]);
    // Nothing is lost to rounding: the shares add back to what was apportioned.
    expect(shares.reduce((s, x) => s + x.share, 0)).toBe(1000);
    // ...and the odd paisa goes on the largest line rather than the first.
    expect(shares.find((s) => s.id === "c")!.share).toBeGreaterThanOrEqual(
      shares.find((s) => s.id === "a")!.share
    );

    // A bill of entry against nothing apportions nothing rather than dividing by zero.
    expect(apportion(1000, [])).toEqual([]);
  });

  it("restates an open foreign balance and reverses it on day one of the next period", async () => {
    const prisma = await getPrisma();
    const customer = await createCustomer();
    // A dollar invoice booked at 83, still open, and the rupee at 85 by the period end.
    await createSalesInvoice({
      customerId: customer.id,
      invoiceNo: `FXINV-${sfx}`,
      invoiceDate: new Date("2032-08-10T00:00:00Z"),
      grandTotal: 830000,
      subTotal: 830000,
      currencyCode: "USD",
      exchangeRate: 83,
      foreignTotal: 10000,
    });
    await asDemoTenant(() =>
      prisma.exchangeRate.upsert({
        where: {
          companyId_currencyCode_rateDate: {
            companyId: customer.companyId,
            currencyCode: "USD",
            rateDate: new Date("2032-08-31T00:00:00Z"),
          },
        },
        create: {
          companyId: customer.companyId,
          currencyCode: "USD",
          rateDate: new Date("2032-08-31T00:00:00Z"),
          rate: 85,
          source: "MANUAL",
        },
        update: { rate: 85 },
      })
    );

    const preview = await (await api()).get("/api/fx/revaluations/preview/2032-08").set(OWNER.auth);
    expect(preview.status).toBe(200);
    const line = (preview.body.data.lines as { documentNo: string; difference: number }[]).find(
      (l) => l.documentNo === `FXINV-${sfx}`
    );
    // 10,000 dollars, two rupees better: a 20,000 rupee unrealised gain.
    expect(line, JSON.stringify(preview.body.data).slice(0, 300)).toBeDefined();
    expect(line!.difference).toBe(20000);

    const res = await (await api()).post("/api/fx/revaluations/2032-08").set(OWNER.auth).send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const run = res.body.data as {
      status: string;
      voucherId: number;
      reversalVoucherId: number;
      netAmount: string;
    };
    expect(run.status).toBe("POSTED");

    const posted = await asDemoTenant(() =>
      prisma.voucher.findUniqueOrThrow({ where: { id: run.voucherId }, include: { items: true } })
    );
    const reversal = await asDemoTenant(() =>
      prisma.voucher.findUniqueOrThrow({
        where: { id: run.reversalVoucherId },
        include: { items: true },
      })
    );
    // The entry lands on the last day of the period and comes straight back off on the first day
    // of the next one. Without the reversal, the month the invoice is settled counts the same
    // movement a second time.
    expect(posted.date.toISOString().slice(0, 10)).toBe("2032-08-31");
    expect(reversal.date.toISOString().slice(0, 10)).toBe("2032-09-01");
    const netOf = (v: typeof posted) =>
      v.items.reduce((s, i) => s + Number(i.debitAmount) - Number(i.creditAmount), 0);
    expect(Math.round(netOf(posted))).toBe(0);
    expect(Math.round(netOf(reversal))).toBe(0);
    // ...and the two are mirror images: what was debited is credited.
    const debitedIn = (v: typeof posted) =>
      v.items.filter((i) => Number(i.debitAmount) > 0).map((i) => i.debitLedgerId);
    const creditedIn = (v: typeof posted) =>
      v.items.filter((i) => Number(i.creditAmount) > 0).map((i) => i.creditLedgerId);
    expect(debitedIn(posted).sort()).toEqual(creditedIn(reversal).sort());
    expect(creditedIn(posted).sort()).toEqual(debitedIn(reversal).sort());

    // Revaluing the same period again is refused rather than posting a second pair.
    const twice = await (await api()).post("/api/fx/revaluations/2032-08").set(OWNER.auth).send({});
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("ALREADY_REVALUED");
  });

  it("refuses a restatement when nothing is open in a foreign currency", async () => {
    // A period before any document in the test database exists, so the answer does not depend on
    // what another suite happens to have left lying about.
    const res = await (await api()).post("/api/fx/revaluations/2010-01").set(OWNER.auth).send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(400);
    expect(res.body.code).toBe("NOTHING_OPEN");
  });

  it("refuses a user without the permission and hides a foreign tenant's bills of entry", async () => {
    const client = await api();
    const production = await authed("demo.production");
    expect((await client.get("/api/fx/bills-of-entry").set(production.auth)).status).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "FX Tenant B", companyCode: `FXB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.billOfEntry.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.billOfEntry.count())).toBeGreaterThan(0);
  });
});
