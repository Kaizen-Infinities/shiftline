import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * Tally XML export (P1-06).
 *
 * The file is only useful if Tally actually takes it, and the two ways it silently does the
 * wrong thing are the ones tested hardest: a reserved group re-created under our spelling (which
 * splits the balance sheet), and a debit exported with the wrong sign (which reverses the whole
 * import). The voucher file gets a golden-file assertion on a month nothing else in the suite
 * touches, so a change to the format is a change to the test.
 */
const sfx = Date.now().toString(36).slice(-5);
// June 2028: past every financial year the other suites work in, so the window holds only ours.
const DAY = "2028-06-15";
const WINDOW = { from: "2028-06-01", to: "2028-06-30" };

let OWNER: { auth: Record<string, string> };
let CASH: number;
let SALES: number;

const ledgerByCode = async (code: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() => prisma.accountLedger.findFirstOrThrow({ where: { code } }));
};

const postVoucher = async (
  type: string,
  narration: string,
  lines: [number, number, "dr" | "cr"][]
) => {
  const res = await (
    await api()
  )
    .post("/api/vouchers")
    .set(OWNER.auth)
    .send({
      type,
      date: DAY,
      narration,
      items: lines.map(([ledgerId, amount, side]) =>
        side === "dr"
          ? { debitLedgerId: ledgerId, debitAmount: amount, creditAmount: 0 }
          : { creditLedgerId: ledgerId, debitAmount: 0, creditAmount: amount }
      ),
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data as { id: number; voucherNo: string };
};

const vouchersXml = async (extra: Record<string, string> = {}) => {
  const res = await (
    await api()
  )
    .get("/api/tally/vouchers")
    .query({ ...WINDOW, ...extra })
    .set(OWNER.auth);
  expect(res.status, res.text?.slice(0, 300)).toBe(200);
  return res.text as string;
};

describe("Tally XML export", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    CASH = (await ledgerByCode("CASH-001")).id;
    SALES = (await ledgerByCode("SALES-001")).id;
  });

  it("writes masters Tally will accept: reserved groups left alone, ours created beneath them", async () => {
    const res = await (await api()).get("/api/tally/masters").set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    const xml = res.text as string;

    expect(xml).toContain("<REPORTNAME>All Masters</REPORTNAME>");
    // Tally already has "Sundry Debtors"; creating it again would split the receivables.
    expect(xml).not.toContain('<GROUP NAME="Sundry Debtors"');
    expect(xml).not.toContain('<GROUP NAME="Cash-in-Hand"');
    // ...and our spelling must never be used as a group or as a parent either. (A *ledger*
    // may still be called "Cash in Hand" — that is its own name, not the group's.)
    expect(xml).not.toContain('<GROUP NAME="Cash in Hand"');
    expect(xml).not.toContain("<PARENT>Cash in Hand</PARENT>");
    expect(xml).not.toContain('<GROUP NAME="Direct Income"');
    expect(xml).not.toContain("<PARENT>Direct Income</PARENT>");
    // One of ours, created under the reserved group it belongs beneath.
    expect(xml).toContain('<GROUP NAME="Finance Costs"');
    expect(xml).toMatch(
      /<GROUP NAME="Finance Costs"[\s\S]*?<PARENT>Indirect Expenses<\/PARENT>[\s\S]*?<\/GROUP>/
    );
    // A cash ledger sits under Tally's name for its group, not ours.
    expect(xml).toMatch(/<LEDGER NAME="[^"]*"[^>]*>[\s\S]*?<PARENT>Cash-in-Hand<\/PARENT>/);
    // Debtors and creditors are the ledgers Tally keeps bill by bill.
    expect(xml).toMatch(/<PARENT>Sundry Debtors<\/PARENT><ISBILLWISEON>Yes<\/ISBILLWISEON>/);
    expect(xml).toContain("<UNIT NAME=");
    expect(xml).toContain("<STOCKITEM NAME=");
  });

  it("writes a voucher file in Tally's sign convention, exactly", async () => {
    const cashSale = await postVoucher("RECEIPT", `Tally test cash sale ${sfx}`, [
      [CASH, 1500, "dr"],
      [SALES, 1500, "cr"],
    ]);

    const xml = await vouchersXml();
    expect(xml).toContain("<REPORTNAME>Vouchers</REPORTNAME>");

    const company = await demoCompany();
    const cashName = (await ledgerByCode("CASH-001")).name;
    const salesName = (await ledgerByCode("SALES-001")).name;

    // The golden file: this is the whole voucher, byte for byte.
    expect(xml).toContain(
      `<VOUCHER REMOTEID="${company.id}-${cashSale.id}" VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
        `<DATE>20280615</DATE><EFFECTIVEDATE>20280615</EFFECTIVEDATE>` +
        `<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>${cashSale.voucherNo}</VOUCHERNUMBER>` +
        `<NARRATION>Tally test cash sale ${sfx}</NARRATION>` +
        `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISCANCELLED>No</ISCANCELLED>` +
        `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${cashName}</LEDGERNAME>` +
        // A debit is negative in Tally. This line is the one that reverses an entire import
        // when it is wrong, which is why it is asserted literally.
        `<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1500.00</AMOUNT></ALLLEDGERENTRIES.LIST>` +
        `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${salesName}</LEDGERNAME>` +
        `<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1500.00</AMOUNT></ALLLEDGERENTRIES.LIST>` +
        `</VOUCHER>`
    );
  });

  it("sends a journal that touches the bank as a Payment, because Tally refuses it as a Journal", async () => {
    const bank = (await ledgerByCode("BANK-001")).id;
    const groupId = async (code: string) => {
      const prisma = await getPrisma();
      return (await asDemoTenant(() => prisma.ledgerGroup.findFirstOrThrow({ where: { code } })))
        .id;
    };
    const made = await (
      await api()
    )
      .post("/api/accounts/ledgers")
      .set(OWNER.auth)
      .send({
        code: `TLY-EXP-${sfx}`,
        name: `Tally Test Expense ${sfx}`,
        type: "EXPENSE",
        groupId: await groupId("INDIRECT_EXPENSES"),
      });
    expect(made.status).toBe(201);

    const paid = await postVoucher("JOURNAL", `Tally test bank charge ${sfx}`, [
      [made.body.data.id as number, 250, "dr"],
      [bank, 250, "cr"],
    ]);
    const xml = await vouchersXml();
    expect(xml).toMatch(new RegExp(`<VOUCHER [^>]*-${paid.id}" VCHTYPE="Payment"`));
    expect(xml).toContain(`<VOUCHERNUMBER>${paid.voucherNo}</VOUCHERNUMBER>`);

    // A journal with no cash or bank ledger stays a Journal.
    const journal = await postVoucher("JOURNAL", `Tally test accrual ${sfx}`, [
      [made.body.data.id as number, 90, "dr"],
      [SALES, 90, "cr"],
    ]);
    expect(xml.length).toBeGreaterThan(0);
    expect(await vouchersXml()).toMatch(
      new RegExp(`<VOUCHER [^>]*-${journal.id}" VCHTYPE="Journal"`)
    );
  });

  it("exports a cancelled voucher as cancelled and drops its reversal", async () => {
    const v = await postVoucher("RECEIPT", `Tally test to cancel ${sfx}`, [
      [CASH, 700, "dr"],
      [SALES, 700, "cr"],
    ]);
    const cancelled = await (
      await api()
    )
      .post(`/api/vouchers/${v.id}/cancel`)
      .set(OWNER.auth)
      .send({ reason: "Entered twice" });
    expect(cancelled.status, JSON.stringify(cancelled.body).slice(0, 300)).toBe(200);

    const xml = await vouchersXml();
    // The original comes across cancelled and carries no entries...
    expect(xml).toMatch(
      new RegExp(`<VOUCHER [^>]*-${v.id}"[\\s\\S]*?<ISCANCELLED>Yes</ISCANCELLED></VOUCHER>`)
    );
    // ...and its reversal is not exported, because in Tally the cancellation *is* the reversal.
    const prisma = await getPrisma();
    const reversal = await asDemoTenant(() =>
      prisma.voucher.findFirst({ where: { reversalOfId: v.id } })
    );
    if (reversal) expect(xml).not.toContain(`-${reversal.id}" VCHTYPE=`);
  });

  it("honours the tenant's own name for a ledger, and leaves out what it is told to", async () => {
    const owner = OWNER;
    const client = await api();
    const saved = await client
      .post("/api/tally/mappings")
      .set(owner.auth)
      .send({ kind: "LEDGER", sourceCode: "SALES-001", tallyName: `Sales A/c ${sfx}` });
    expect(saved.status).toBe(200);

    const xml = await vouchersXml();
    expect(xml).toContain(`<LEDGERNAME>Sales A/c ${sfx}</LEDGERNAME>`);

    const hidden = await client
      .post("/api/tally/mappings")
      .set(owner.auth)
      .send({
        kind: "LEDGER",
        sourceCode: "SALES-001",
        tallyName: `Sales A/c ${sfx}`,
        isExported: false,
      });
    expect(hidden.status).toBe(200);
    expect(await vouchersXml()).not.toContain(`<LEDGERNAME>Sales A/c ${sfx}</LEDGERNAME>`);

    // Put it back so the rest of the suite sees the books as they are.
    const rows = await client.get("/api/tally/mappings").set(owner.auth);
    const row = (rows.body.data as { id: string; sourceCode: string }[]).find(
      (r) => r.sourceCode === "SALES-001"
    );
    expect(row).toBeDefined();
    expect((await client.delete(`/api/tally/mappings/${row!.id}`).set(owner.auth)).status).toBe(
      200
    );
  });

  it("records a run, and only a confirmed one moves the incremental watermark", async () => {
    const client = await api();
    const created = await client
      .post("/api/tally/runs")
      .set(OWNER.auth)
      .send({ scope: "VOUCHERS", ...WINDOW });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const run = created.body.data as {
      id: string;
      status: string;
      throughAt: string;
      payloadHash: string;
      counts: { vouchers: number };
    };
    expect(run.status).toBe("DRAFT");
    expect(run.counts.vouchers).toBeGreaterThan(0);

    // A draft has not reached Tally, so an incremental export still starts from the beginning.
    const beforeConfirm = await client
      .get("/api/tally/preview")
      .query({ ...WINDOW, incremental: "true", scope: "VOUCHERS" })
      .set(OWNER.auth);
    expect(beforeConfirm.status).toBe(200);
    expect(beforeConfirm.body.data.sinceAt).toBeNull();

    expect((await client.post(`/api/tally/runs/${run.id}/confirm`).set(OWNER.auth)).status).toBe(
      200
    );
    const afterConfirm = await client
      .get("/api/tally/preview")
      .query({ ...WINDOW, incremental: "true", scope: "VOUCHERS" })
      .set(OWNER.auth);
    expect(afterConfirm.body.data.sinceAt).not.toBeNull();
    // Nothing has changed since, so the incremental file is empty of vouchers.
    expect(afterConfirm.body.data.counts.vouchers).toBe(0);

    // Something new in the same window comes back on the next incremental run.
    await postVoucher("RECEIPT", `Tally test after watermark ${sfx}`, [
      [CASH, 40, "dr"],
      [SALES, 40, "cr"],
    ]);
    const next = await client
      .get("/api/tally/preview")
      .query({ ...WINDOW, incremental: "true", scope: "VOUCHERS" })
      .set(OWNER.auth);
    expect(next.body.data.counts.vouchers).toBe(1);

    // Re-downloading says whether the books moved since the file was made.
    const file = await client.get(`/api/tally/runs/${run.id}/file`).set(OWNER.auth);
    expect(file.status).toBe(200);
    expect(file.headers["x-books-changed-since-run"]).toBe("true");
  });

  it("refuses a backwards period and a discard of something already imported", async () => {
    const client = await api();
    const backwards = await client
      .get("/api/tally/vouchers")
      .query({ from: WINDOW.to, to: WINDOW.from })
      .set(OWNER.auth);
    expect(backwards.status).toBe(400);

    const created = await client
      .post("/api/tally/runs")
      .set(OWNER.auth)
      .send({ scope: "MASTERS", ...WINDOW });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await client.post(`/api/tally/runs/${id}/confirm`).set(OWNER.auth)).status).toBe(200);
    const discard = await client
      .post(`/api/tally/runs/${id}/discard`)
      .set(OWNER.auth)
      .send({ reason: "changed my mind" });
    expect(discard.status).toBe(409);
    expect(discard.body.code).toBe("RUN_ALREADY_CONFIRMED");
  });

  it("refuses a user without the permission, and hides our runs from another tenant", async () => {
    const client = await api();
    const production = await authed("demo.production");
    expect((await client.get("/api/tally/masters").set(production.auth)).status).toBe(403);

    const created = await client
      .post("/api/tally/runs")
      .set(OWNER.auth)
      .send({ scope: "MASTERS", ...WINDOW });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Tally Tenant B", companyCode: `TLYB-${sfx}` },
      })
    );
    // The row is ours; under another company it does not exist at all, and that company's own
    // export history is empty rather than showing ours.
    expect(
      await asDemoTenant(() => prisma.tallyExportRun.findUnique({ where: { id } }))
    ).not.toBeNull();
    expect(
      await runAsTenant(other.id, () => prisma.tallyExportRun.findUnique({ where: { id } }))
    ).toBeNull();
    expect(await runAsTenant(other.id, () => prisma.tallyExportRun.count())).toBe(0);
  });
});
