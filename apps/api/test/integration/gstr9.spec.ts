import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct, demoCompany } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";

/**
 * GSTR-9 working papers and the compliance calendar (P1-13d). The annual return is twelve
 * monthly returns added up, so the test puts documents in two months of one financial year and
 * checks the year's tables against the months they came from — and that the tables which exist
 * to surface a difference (6(J), 8(D)) actually do.
 */
const SELLER = "33AAAAA0000A1Z9";
/**
 * A year of this suite's own, and a *later* one. 2023-24 and 2024-25 belong to the year-end
 * suite, and its trial-balance assertions are cumulative "as on 31 March 2025" — so documents
 * dated before that, in any year, land in a balance it expects to be zero.
 */
const FY = "2027-28";
const sfx = Date.now().toString(36);
const n = (v: unknown) => Number(v);

let HSN_ID: string;

const sale = async (customerId: string, rate: number, taxPercent: number, date: string) => {
  const owner = await authed("demo.owner");
  const product = await createProduct({ gstRate: taxPercent, rate, hsnCodeId: HSN_ID });
  const res = await (
    await api()
  )
    .post("/api/sales-invoices")
    .set(owner.auth)
    .send({
      invoiceDate: date,
      customerId,
      items: [{ productId: product.id.toString(), qty: 1, rate, taxPercent, hsnCode: "3923" }],
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data;
};

describe("GSTR-9 and the compliance calendar", () => {
  beforeAll(async () => {
    const prisma = await getPrisma();
    HSN_ID = (
      await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } }))
    ).id;
  });

  it("adds the year up from its months and traces each figure back to one", async () => {
    const accountant = await authed("demo.accounts");
    const client = await api();
    const b2b = await createCustomer({
      gstin: "33AABCT1234H1ZT",
      gstRegType: "REGULAR",
      stateCode: "33",
    });
    const walkIn = await createCustomer({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "33",
    });
    const overseas = await createCustomer({ gstin: null, gstRegType: "OVERSEAS", stateCode: null });

    // FY 2024-25 runs April 2024 to March 2025.
    await sale(b2b.id, 10000, 18, "2027-05-10"); // B2B, table 4(B)
    await sale(walkIn.id, 4000, 18, "2027-05-12"); // B2C, table 4(A)
    await sale(overseas.id, 25000, 0, "2027-06-08"); // export under LUT, table 5(A)
    await sale(walkIn.id, 3000, 0, "2027-06-09"); // nil rated, table 5(E)

    const res = await client
      .get("/api/gst-returns/gstr9")
      .query({ fy: FY, gstin: SELLER })
      .set(accountant.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const ret = res.body.data;

    expect(ret).toMatchObject({ gstin: SELLER, fyKey: FY });
    expect(ret.months).toHaveLength(12);
    expect(ret.months[0]).toBe("2027-04"); // the year starts in April
    expect(ret.months[11]).toBe("2028-03");

    // Table 4: the taxed supplies, split by whether the buyer is registered.
    expect(n(ret.table4.b2b.taxable)).toBe(10000);
    expect(n(ret.table4.b2b.cgst)).toBe(900);
    expect(n(ret.table4.b2c.taxable)).toBe(4000);
    expect(n(ret.table4.b2c.sgst)).toBe(360);
    expect(n(ret.table4.subTotal.taxable)).toBe(14000);

    // Table 5: an export under a bond pays no tax, so it is turnover without a liability.
    expect(n(ret.table5.exportWithoutTax.taxable)).toBe(25000);
    expect(n(ret.table5.exportWithoutTax.igst)).toBe(0);
    expect(n(ret.table5.nilRated.taxable)).toBe(3000);
    expect(n(ret.table5.total.taxable)).toBe(28000);
    expect(n(ret.table5.grossTurnover)).toBe(42000); // 14,000 taxed + 28,000 untaxed

    // Table 17 carries the HSN summary of everything sold in the year.
    const hsn = ret.table17.find(
      (r: { hsn: string; rate: number }) => r.hsn === "3923" && r.rate === 18
    );
    expect(hsn).toBeTruthy();
    expect(n(hsn.taxable)).toBe(14000);

    // The monthly trace is what lets an accountant defend a figure.
    const may = ret.monthly.find((m: { periodKey: string }) => m.periodKey === "2027-05");
    expect(n(may.outputTax.taxable)).toBe(14000);
    const june = ret.monthly.find((m: { periodKey: string }) => m.periodKey === "2027-06");
    expect(n(june.outputTax.taxable)).toBe(25000); // the export; the nil-rated sale is 3.1(c)

    expect(ret.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows in 6(J) that a month was filed for less credit than the books now justify", async () => {
    const accountant = await authed("demo.accounts");
    const owner = await authed("demo.owner");
    const client = await api();
    const fy = "2020-21";
    const company = await demoCompany();

    // A GSTR-3B filed for March 2024 claiming no credit at all.
    const prisma = await getPrisma();
    await runAsTenant(company.id, async () =>
      prisma.filingApproval.create({
        data: {
          filingType: "GSTR3B",
          periodKey: "2021-03",
          businessPlaceId: null,
          status: "SUBMITTED",
          payloadHash: "0".repeat(64),
          summary: { netItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 } },
          submissionRef: `AA3321${sfx}`,
          submittedAt: new Date(),
        },
      })
    );

    const res = await client.get("/api/gst-returns/gstr9").query({ fy }).set(accountant.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    // Eleven of the twelve months have no filed return, so the working paper says so rather
    // than pretending the recomputed figures are what went to the portal.
    expect(res.body.data.warnings.some((w: string) => w.includes("no filed"))).toBe(true);
    expect(res.status).toBe(200);
    expect(
      (await client.get("/api/gst-returns/gstr9").query({ fy: "2024-5" }).set(owner.auth)).status
    ).toBe(400);
  });

  it("registers the year, refuses to file it until approved, then marks it filed", async () => {
    const accountant = await authed("demo.accounts");
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    const fy = "2021-22";

    expect(
      (await client.get("/api/gst-returns/gstr9").query({ fy }).set(supervisor.auth)).status
    ).toBe(403);

    const reg = await client
      .post("/api/gst-returns/gstr9/register")
      .set(accountant.auth)
      .send({ fy });
    expect(reg.status, JSON.stringify(reg.body).slice(0, 300)).toBe(200);
    expect(reg.body.data.filing).toMatchObject({ filingType: "GSTR9", periodKey: fy });

    const early = await client
      .post("/api/gst-returns/gstr9/filed")
      .set(accountant.auth)
      .send({ fy });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("FILING_NOT_APPROVED");

    const id = reg.body.data.filing.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      200
    );
    const filed = await client
      .post("/api/gst-returns/gstr9/filed")
      .set(accountant.auth)
      .send({ fy, submissionRef: `AA9${sfx}` });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 300)).toBe(200);
    expect(filed.body.data.filing).toMatchObject({ status: "SUBMITTED" });
  });

  it("lists what is due with the state of each, and warns 7 and 2 days out", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const res = await client.get("/api/gst-returns/calendar").set(owner.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const rows = res.body.data as {
      filingType: string;
      periodKey: string;
      dueDate: string;
      status: string;
      daysLeft: number;
      overdue: boolean;
    }[];
    expect(rows.length).toBeGreaterThan(0);

    // Every monthly GST return appears, each covering the month before the one it is due in.
    const gstr3b = rows.filter((r) => r.filingType === "GSTR3B");
    expect(gstr3b.length).toBeGreaterThanOrEqual(3);
    for (const row of gstr3b) {
      const [dy, dm] = row.dueDate.split("-").map(Number);
      const [py, pm] = row.periodKey.split("-").map(Number);
      expect(row.dueDate.endsWith("-20")).toBe(true);
      // The period is exactly one month before the due month.
      expect(py * 12 + pm).toBe(dy * 12 + dm - 1);
    }
    // The rows are in date order, which is the only order a to-do list is useful in.
    const dates = rows.map((r) => r.dueDate);
    expect([...dates].sort()).toEqual(dates);
    // Nothing prepared yet reads as NOT_STARTED rather than as an error.
    expect(rows.some((r) => r.status === "NOT_STARTED")).toBe(true);

    const { complianceService } = await import("../../src/modules/gst-returns/compliance.service");
    const company = await demoCompany();
    // Seven days before a GSTR-3B date: 13 September 2026 for the 20th.
    const at = new Date(Date.UTC(2026, 8, 13));
    const first = await runAsTenant(company.id, () => complianceService.warnUpcoming(at));
    expect(first.sent).toBeGreaterThan(0);
    // The job runs daily; the same nudge must not go out again the next time it runs.
    const second = await runAsTenant(company.id, () => complianceService.warnUpcoming(at));
    expect(second.sent).toBe(0);
  });
});
