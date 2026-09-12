import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createSupplier, demoCompany } from "../factories";

/**
 * TDS and TCS (P1-15).
 *
 * The arithmetic is trivial; the rules around it are not. A section only bites once the year's
 * payments cross a threshold, 194Q then taxes only the part *above* it, a missing PAN means 20%
 * under 206AA, and a non-filer means double under 206AB. Each of those is a way to take the
 * wrong amount of somebody else's money, so each has a test.
 */
const sfx = Date.now().toString(36);
const n = (v: unknown) => Number(v);
const FY = "2026-27";

/** A supplier with a PAN of the right kind. */
const payee = async (over: Record<string, unknown> = {}) =>
  createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY", ...over });

const deduct = async (
  body: Record<string, unknown>,
  auth: Record<string, string>,
  expected = 201
) => {
  const res = await (
    await api()
  )
    .post("/api/tds/deductions")
    .set(auth)
    .send({
      docType: "EXPENSE",
      docId: `doc-${Math.random().toString(36).slice(2, 10)}`,
      docNo: `BILL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      deductionDate: "2026-06-10",
      ...body,
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(expected);
  return res.body.data;
};

describe("TDS and TCS", () => {
  it("seeds the sections with both the familiar code and where the 2025 Act puts it", async () => {
    const owner = await authed("demo.owner");
    const res = await (await api()).get("/api/tds/sections").set(owner.auth);
    expect(res.status).toBe(200);
    const c = res.body.data.find((s: { code: string }) => s.code === "194C");
    expect(c).toMatchObject({ actCode: "393 Table item 2", isTcs: false });
    // A contractor who is an individual is deducted at 1%, a company at 2%.
    expect(n(c.rateCompany)).toBe(2);
    expect(n(c.rateIndividual)).toBe(1);
    const tcs = res.body.data.find((s: { code: string }) => s.code === "206C(1)");
    expect(tcs).toMatchObject({ isTcs: true, actCode: "394 Table item 1" });
  });

  it("holds off until the threshold is crossed, then deducts", async () => {
    const accountant = await authed("demo.accounts");
    const supplier = await payee();

    // 194C: nothing on a single bill below 30,000 while the year is under 1,00,000.
    const small = await deduct(
      { sectionCode: "194C", supplierId: supplier.id, amount: 20000 },
      accountant.auth
    );
    expect(n(small.tdsAmount)).toBe(0);
    expect(small.decision.belowThreshold).toBe(true);

    // A single bill of 30,000 crosses the single-payment threshold on its own.
    const big = await deduct(
      { sectionCode: "194C", supplierId: supplier.id, amount: 30000 },
      accountant.auth
    );
    expect(n(big.rate)).toBe(2);
    expect(n(big.tdsAmount)).toBe(600);
  });

  it("taxes only the part above the threshold under 194Q", async () => {
    const accountant = await authed("demo.accounts");
    const supplier = await payee();
    // The annual threshold is 50 lakh. A 60-lakh purchase is taxed on 10 lakh, not 60.
    const row = await deduct(
      { sectionCode: "194Q", supplierId: supplier.id, amount: 6000000 },
      accountant.auth
    );
    expect(n(row.taxableAmount)).toBe(1000000);
    expect(n(row.rate)).toBe(0.1);
    expect(n(row.tdsAmount)).toBe(1000);

    // The next bill is fully above the threshold, so all of it is taxed.
    const next = await deduct(
      { sectionCode: "194Q", supplierId: supplier.id, amount: 500000 },
      accountant.auth
    );
    expect(n(next.taxableAmount)).toBe(500000);
    expect(n(next.tdsAmount)).toBe(500);
  });

  it("takes 20% with no PAN and double the rate from a non-filer", async () => {
    const accountant = await authed("demo.accounts");
    const noPan = await payee({ pan: null });
    const row = await deduct(
      { sectionCode: "194J", supplierId: noPan.id, amount: 100000 },
      accountant.auth
    );
    expect(n(row.rate)).toBe(20);
    expect(row.rateReason).toContain("206AA");
    expect(n(row.tdsAmount)).toBe(20000);

    // 206AB: twice the rate, or 5%, whichever is higher. 194J at 10% becomes 20%.
    const nonFiler = await payee({ higherRate206AB: true });
    const higher = await deduct(
      { sectionCode: "194J", supplierId: nonFiler.id, amount: 100000 },
      accountant.auth
    );
    expect(n(higher.rate)).toBe(20);
    expect(higher.rateReason).toContain("206AB");

    // An individual contractor is 1%, so 206AB lifts it to the 5% floor rather than to 2%.
    const smallNonFiler = await payee({
      deducteeType: "INDIVIDUAL_HUF",
      higherRate206AB: true,
      pan: "AAAPT1234H",
    });
    const floored = await deduct(
      { sectionCode: "194C", supplierId: smallNonFiler.id, amount: 200000 },
      accountant.auth
    );
    expect(n(floored.rate)).toBe(5);
  });

  it("pays a challan, refuses to mix quarters, and reconciles the return", async () => {
    const accountant = await authed("demo.accounts");
    const owner = await authed("demo.owner");
    const client = await api();
    const supplier = await payee();

    const q1 = await deduct(
      {
        sectionCode: "194J",
        supplierId: supplier.id,
        amount: 200000,
        deductionDate: "2026-05-05",
        docNo: `Q1-${sfx}`,
      },
      accountant.auth
    );
    expect(q1.quarter).toBe("Q1"); // April to June
    expect(q1.fyCode).toBe(FY);
    const q2 = await deduct(
      {
        sectionCode: "194J",
        supplierId: supplier.id,
        amount: 100000,
        deductionDate: "2026-08-05",
        docNo: `Q2-${sfx}`,
      },
      accountant.auth
    );
    expect(q2.quarter).toBe("Q2");

    // A challan is filed per quarter, so it cannot cover both.
    const mixed = await client
      .post("/api/tds/challans")
      .set(accountant.auth)
      .send({
        bsrCode: "0510308",
        challanSerial: "00001",
        challanDate: "2026-06-07",
        periodKey: "2026-05",
        deductionIds: [q1.id, q2.id],
      });
    expect(mixed.status).toBe(400);
    expect(mixed.body.code).toBe("MIXED_QUARTER");

    const challan = await client
      .post("/api/tds/challans")
      .set(accountant.auth)
      .send({
        bsrCode: "0510308",
        challanSerial: "00001",
        challanDate: "2026-06-07",
        periodKey: "2026-05",
        deductionIds: [q1.id],
        interest: 120,
      });
    expect(challan.status, JSON.stringify(challan.body).slice(0, 300)).toBe(201);
    expect(n(challan.body.data.tdsAmount)).toBe(20000);
    expect(n(challan.body.data.totalAmount)).toBe(20120);

    // The same deduction cannot go on a second challan.
    const again = await client
      .post("/api/tds/challans")
      .set(accountant.auth)
      .send({
        bsrCode: "0510308",
        challanSerial: "00002",
        challanDate: "2026-06-08",
        periodKey: "2026-05",
        deductionIds: [q1.id],
      });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_CHALLANED");

    const ret = await client
      .get("/api/tds/returns/26Q")
      .query({ fyCode: FY, quarter: "Q1" })
      .set(accountant.auth);
    expect(ret.status, JSON.stringify(ret.body).slice(0, 300)).toBe(200);
    const line = ret.body.data.lines.find((l: { docNo: string }) => l.docNo === `Q1-${sfx}`);
    expect(line).toMatchObject({ section: "194J", rate: 10, tdsAmount: 20000 });
    expect(line.challan).toMatchObject({ bsrCode: "0510308", serial: "00001" });

    // The file the utility imports is delimited and numbered, not a spreadsheet.
    const file = await client
      .get("/api/tds/returns/26Q/file")
      .query({ fyCode: FY, quarter: "Q1" })
      .set(accountant.auth);
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toContain(`26Q_${FY}_Q1.txt`);
    const lines = file.text.split("\n");
    expect(lines[0]).toMatch(/^1\^FH\^NSDL\^R\^26Q/);
    expect(lines[1]).toMatch(/^2\^BH\^/);
    expect(lines.some((l: string) => l.includes("^CD^"))).toBe(true);
    expect(lines.some((l: string) => l.includes("^DD^") && l.includes("AAACT1234H"))).toBe(true);
    expect(lines[lines.length - 1]).toMatch(/\^FT\^/);

    // Filing goes through the same gate as every other return.
    const early = await client
      .post("/api/tds/returns/26Q/filed")
      .set(accountant.auth)
      .send({ fyCode: FY, quarter: "Q1" });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("FILING_NOT_APPROVED");

    const reg = await client
      .post("/api/tds/returns/26Q/register")
      .set(accountant.auth)
      .send({ fyCode: FY, quarter: "Q1" });
    expect(reg.status, JSON.stringify(reg.body).slice(0, 300)).toBe(200);
    expect(reg.body.data.filing).toMatchObject({ filingType: "TDS_26Q", periodKey: "2026-Q1" });
    const id = reg.body.data.filing.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      200
    );
    const filed = await client
      .post("/api/tds/returns/26Q/filed")
      .set(accountant.auth)
      .send({ fyCode: FY, quarter: "Q1", submissionRef: `ACK${sfx}` });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 300)).toBe(200);

    // A deduction in a filed return cannot be cancelled away.
    const cancel = await client
      .post(`/api/tds/deductions/${q1.id}/cancel`)
      .set(accountant.auth)
      .send({ reason: "Changed my mind" });
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe("RETURN_FILED");
  });

  it("certifies on Form 16A only what actually reached the government", async () => {
    const accountant = await authed("demo.accounts");
    const client = await api();
    const supplier = await payee();
    const paid = await deduct(
      {
        sectionCode: "194H",
        supplierId: supplier.id,
        amount: 100000,
        deductionDate: "2026-11-08",
      },
      accountant.auth
    );
    await deduct(
      {
        sectionCode: "194H",
        supplierId: supplier.id,
        amount: 50000,
        deductionDate: "2026-11-20",
      },
      accountant.auth
    );
    await client
      .post("/api/tds/challans")
      .set(accountant.auth)
      .send({
        bsrCode: "0510308",
        challanSerial: `16A${sfx}`.slice(0, 10),
        challanDate: "2026-12-07",
        periodKey: "2026-11",
        deductionIds: [paid.id],
      });

    const cert = await client
      .get(`/api/tds/form16a/${supplier.id}`)
      .query({ fyCode: FY, quarter: "Q3" })
      .set(accountant.auth);
    expect(cert.status, JSON.stringify(cert.body).slice(0, 300)).toBe(200);
    expect(cert.body.data.lines).toHaveLength(2);
    expect(n(cert.body.data.totals.tdsDeducted)).toBe(7500); // 5% of 1,50,000
    // Only the one on a challan has actually reached the government.
    expect(n(cert.body.data.totals.tdsDeposited)).toBe(5000);
    expect(cert.body.data.unchallaned).toBe(1);
  });

  it("refuses the routes without the permission and a bad BSR code", async () => {
    const supervisor = await authed("demo.production");
    const accountant = await authed("demo.accounts");
    const client = await api();
    expect((await client.get("/api/tds/sections").set(supervisor.auth)).status).toBe(403);
    const bad = await client
      .post("/api/tds/challans")
      .set(accountant.auth)
      .send({
        bsrCode: "123",
        challanSerial: "1",
        challanDate: "2026-06-07",
        periodKey: "2026-05",
        deductionIds: ["00000000-0000-0000-0000-000000000000"],
      });
    expect(bad.status).toBe(400);
  });

  it("keeps a deduction out of another tenant's books", async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    // The demo tenant's deductions all carry its own companyId; nothing else can be true,
    // because RLS is what answers the query.
    const rows = await asDemoTenant(() => prisma.tdsDeduction.findMany({ take: 50 }));
    expect(rows.every((r) => r.companyId === company.id)).toBe(true);
  });
});
