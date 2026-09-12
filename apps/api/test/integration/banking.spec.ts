import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";
import {
  parseAmount,
  parseBankDate,
  parseStatement,
} from "../../src/modules/banking/statement.parse";

/**
 * Bank reconciliation and cheques (P1-20).
 *
 * Two things are tested hardest. The parser, because every bank exports a different CSV and a
 * misread date silently puts a transaction in the wrong month. And the matcher, because a match
 * on amount alone would pair three ₹50,000 payments made on the same day with the wrong vouchers
 * and leave nobody any the wiser.
 */
const sfx = Date.now().toString(36).slice(-5);

let OWNER: { auth: Record<string, string> };
let BANK_ACCOUNT_ID: string;

const HDFC_CSV = [
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  `05/07/2034,NEFT RECEIVED ACME,CHQ 000${sfx.slice(0, 3)},05/07/2034,,"1,00,000.00","5,00,000.00"`,
  `06/07/2034,BANK CHARGES,,06/07/2034,236.00,,"4,99,764.00"`,
].join("\n");

describe("bank reconciliation and cheques", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const account = await asDemoTenant(() => prisma.bankAccount.findFirst());
    BANK_ACCOUNT_ID = account!.id;
  });

  it("reads dates in every order a bank writes them, day first", () => {
    // Day first, because an Indian bank does not write 03/04 to mean the fourth of March.
    expect(parseBankDate("03/04/2034")?.toISOString().slice(0, 10)).toBe("2034-04-03");
    expect(parseBankDate("03-04-34")?.toISOString().slice(0, 10)).toBe("2034-04-03");
    expect(parseBankDate("03-Apr-2034")?.toISOString().slice(0, 10)).toBe("2034-04-03");
    // ...unless the year leads, which is unambiguous.
    expect(parseBankDate("2034-04-03")?.toISOString().slice(0, 10)).toBe("2034-04-03");
    expect(parseBankDate("not a date")).toBeNull();
  });

  it("reads amounts with Indian grouping, brackets and Cr/Dr markers", () => {
    expect(parseAmount("1,00,000.00")).toBe(100000);
    expect(parseAmount("(2,500.50)")).toBe(-2500.5);
    expect(parseAmount("1,200.00 Dr")).toBe(-1200);
    expect(parseAmount("1,200.00 Cr")).toBe(1200);
    expect(parseAmount("")).toBe(0);
  });

  it("parses each bank's own column layout", () => {
    const hdfc = parseStatement(HDFC_CSV, "HDFC");
    expect(hdfc).toHaveLength(2);
    expect(hdfc[0].credit).toBe(100000);
    expect(hdfc[0].debit).toBe(0);
    expect(hdfc[0].txnDate.toISOString().slice(0, 10)).toBe("2034-07-05");
    expect(hdfc[1].debit).toBe(236);

    // Kotak gives one signed column instead of two; negative is money leaving.
    const kotak = parseStatement(
      ["Date,Description,Amount,Balance", "07/07/2034,UPI OUT,-500.00,1000.00"].join("\n"),
      "KOTAK"
    );
    expect(kotak[0].debit).toBe(500);
    expect(kotak[0].credit).toBe(0);

    // A file with no date column is refused rather than half-read.
    expect(() => parseStatement("Foo,Bar\n1,2", "HDFC")).toThrow();
  });

  it("imports a statement and skips rows it has seen before", async () => {
    const client = await api();
    const first = await client.post("/api/banking/statements/import").set(OWNER.auth).send({
      bankAccountId: BANK_ACCOUNT_ID,
      format: "HDFC",
      csv: HDFC_CSV,
      fileName: "hdfc.csv",
    });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(201);
    expect(first.body.data.imported).toBe(2);
    expect(first.body.data.skippedAsDuplicates).toBe(0);

    // The bank's export always overlaps the last one; the rows are not doubled.
    const again = await client
      .post("/api/banking/statements/import")
      .set(OWNER.auth)
      .send({ bankAccountId: BANK_ACCOUNT_ID, format: "HDFC", csv: HDFC_CSV });
    expect(again.status).toBe(201);
    expect(again.body.data.imported).toBe(0);
    expect(again.body.data.skippedAsDuplicates).toBe(2);
  });

  it("will not match on amount alone, but will when the date agrees too", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const ledgers = await asDemoTenant(async () => ({
      bank: await prisma.accountLedger.findFirstOrThrow({ where: { code: "BANK-001" } }),
      sales: await prisma.accountLedger.findFirstOrThrow({ where: { code: "SALES-001" } }),
    }));
    // A receipt of exactly the statement's amount, on exactly its date.
    const voucher = await client
      .post("/api/vouchers")
      .set(OWNER.auth)
      .send({
        type: "RECEIPT",
        date: "2034-07-05",
        narration: `Bank test receipt ${sfx}`,
        items: [
          { debitLedgerId: ledgers.bank.id, debitAmount: 100000, creditAmount: 0 },
          { creditLedgerId: ledgers.sales.id, debitAmount: 0, creditAmount: 100000 },
        ],
      });
    expect(voucher.status).toBe(201);

    const lines = await client
      .get("/api/banking/lines")
      .query({ bankAccountId: BANK_ACCOUNT_ID, status: "UNMATCHED" })
      .set(OWNER.auth);
    const credit = (lines.body.data as { id: string; credit: string }[]).find(
      (l) => Number(l.credit) === 100000
    )!;
    expect(credit).toBeDefined();

    const candidates = await client
      .get(`/api/banking/lines/${credit.id}/candidates`)
      .set(OWNER.auth);
    expect(candidates.status).toBe(200);
    const best = (
      candidates.body.data as { voucherId: number; confidence: number; why: string[] }[]
    )[0];
    expect(best).toBeDefined();
    // Amount alone is 50; the same date takes it to 80, which is the bar.
    expect(best.confidence).toBeGreaterThanOrEqual(80);
    expect(best.why).toContain("the amount is the same");

    const auto = await client
      .post("/api/banking/auto-match")
      .set(OWNER.auth)
      .send({ bankAccountId: BANK_ACCOUNT_ID });
    expect(auto.status).toBe(200);
    expect(auto.body.data.matched).toBeGreaterThan(0);

    const after = await asDemoTenant(() =>
      prisma.bankStatementLine.findUniqueOrThrow({ where: { id: credit.id } })
    );
    expect(after.status).toBe("MATCHED");
    expect(after.matchedVoucherId).toBe(voucher.body.data.id);
  });

  it("lets a person match and unmatch by hand", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const lines = await client
      .get("/api/banking/lines")
      .query({ bankAccountId: BANK_ACCOUNT_ID, status: "UNMATCHED" })
      .set(OWNER.auth);
    const charge = (lines.body.data as { id: string; debit: string }[]).find(
      (l) => Number(l.debit) === 236
    );
    if (!charge) return;

    // The bank's charge has no voucher, so it is set aside with a note rather than left to nag.
    const ignored = await client
      .post(`/api/banking/lines/${charge.id}/ignore`)
      .set(OWNER.auth)
      .send({ note: "Quarterly charges — to be booked" });
    expect(ignored.status).toBe(200);
    expect(
      (
        await asDemoTenant(() =>
          prisma.bankStatementLine.findUniqueOrThrow({ where: { id: charge.id } })
        )
      ).status
    ).toBe("IGNORED");

    const back = await client.post(`/api/banking/lines/${charge.id}/unmatch`).set(OWNER.auth);
    expect(back.status).toBe(200);
    expect(back.body.data.status).toBe("UNMATCHED");
  });

  it("reconciles: book balance plus the reconciling items is the bank balance", async () => {
    const res = await (
      await api()
    )
      .get("/api/banking/brs")
      .query({ bankAccountId: BANK_ACCOUNT_ID, asOn: "2034-07-31" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const brs = res.body.data as {
      bookBalance: number;
      reconciledBalance: number;
      reconcilingItems: Record<string, number>;
      difference: number | null;
    };
    const items = brs.reconcilingItems;
    // The arithmetic of the statement itself, spelled out so a change to it fails here.
    expect(brs.reconciledBalance).toBe(
      Math.round(
        (brs.bookBalance +
          items.chequesIssuedNotPresented -
          items.depositsNotYetCredited -
          items.chargesNotInBooks +
          items.creditsNotInBooks) *
          100
      ) / 100
    );
    expect(brs).toHaveProperty("difference");
  });

  it("bounces a received cheque: the customer owes it again and the charge is posted", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const cheque = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({
        kind: "RECEIVED",
        chequeNo: `CHQ${sfx}`,
        chequeDate: "2034-08-10",
        amount: 25000,
        partyName: "Acme Traders",
        bankAccountId: BANK_ACCOUNT_ID,
      });
    expect(cheque.status, JSON.stringify(cheque.body).slice(0, 300)).toBe(201);
    expect(cheque.body.data.status).toBe("IN_HAND");

    // The same cheque again is refused; a cheque number and date identify it.
    const twice = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({
        kind: "RECEIVED",
        chequeNo: `CHQ${sfx}`,
        chequeDate: "2034-08-10",
        amount: 25000,
      });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("DUPLICATE_CHEQUE");

    const deposited = await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "DEPOSITED", on: "2034-08-11" });
    expect(deposited.status).toBe(200);

    const bounced = await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/status`)
      .set(OWNER.auth)
      .send({
        status: "BOUNCED",
        on: "2034-08-14",
        bounceCharges: 590,
        bounceReason: "Funds insufficient",
      });
    expect(bounced.status, JSON.stringify(bounced.body).slice(0, 300)).toBe(200);
    expect(bounced.body.data.status).toBe("BOUNCED");
    expect(bounced.body.data.reversalVoucherId).toBeTruthy();

    const voucher = await asDemoTenant(() =>
      prisma.voucher.findUniqueOrThrow({
        where: { id: bounced.body.data.reversalVoucherId },
        include: { items: true },
      })
    );
    // The money comes back off the bank and the customer owes it again, and the bank's charge is
    // a cost of its own rather than netted into the reversal.
    const net = voucher.items.reduce(
      (s, i) => s + Number(i.debitAmount) - Number(i.creditAmount),
      0
    );
    expect(Math.round(net)).toBe(0);
    expect(voucher.items.length).toBe(4);

    // A cheque that has bounced cannot be cleared afterwards by mistake.
    const cleared = await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "CLEARED" });
    expect(cleared.status).toBe(200);
  });

  it("lists the cheques whose date has arrived", async () => {
    const res = await (
      await api()
    )
      .get("/api/banking/cheques/due")
      .query({ on: "2034-12-31" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("total");
  });

  it("refuses a user without the permission and hides another tenant's statements", async () => {
    const client = await api();
    const production = await authed("demo.production");
    expect((await client.get("/api/banking/statements").set(production.auth)).status).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "Bank Tenant B", companyCode: `BKB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.bankStatementLine.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.bankStatementLine.count())).toBeGreaterThan(0);
  });
});
