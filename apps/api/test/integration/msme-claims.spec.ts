import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The CI test job has no headless browser, so the PDF helper is stubbed: this spec proves the
// claim statement carries the right particulars and streams what the helper returns.
const pdfCalls: string[] = [];
vi.mock("../../src/utils/pdfGenerator", () => ({
  generatePdfFromHtml: async (html: string) => {
    pdfCalls.push(html);
    return Buffer.from(`%PDF-1.4 stub ${"x".repeat(600)}`);
  },
}));

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createSalesInvoice, demoCompany } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { addDays, asDate, computeClaim, iso } from "../../src/modules/msme-claims/msme-claim.calc";

/**
 * MSME delayed-payment claims, receivable side (TN-05): settings, eligibility, claim creation
 * recomputed on the server, forward-only status, recompute, the claim PDF, validation,
 * permissions and tenancy.
 */
const BASE = "/api/msme/receivable-claims";
const sfx = Date.now().toString(36).slice(-5);
const today = asDate(new Date());
const day = (n: number) => iso(addDays(today, n));
const D = (n: number) => new Prisma.Decimal(n);

let OWNER: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };
let BUYER: string;
let OTHER_BUYER: string;
const inv: Record<string, string> = {};
let CLAIM_ID: string;

const invoice = async (
  key: string,
  opts: {
    customerId?: string;
    amount: number;
    daysAgo: number;
    status?: string;
    payments?: { amount: number; paymentDate: string }[];
  }
) => {
  const row = await createSalesInvoice({
    customerId: opts.customerId ?? BUYER,
    invoiceNo: `MC-${sfx}-${key}`,
    invoiceDate: new Date(`${day(-opts.daysAgo)}T00:00:00.000Z`),
    grandTotal: D(opts.amount),
    subTotal: D(opts.amount),
    status: opts.status ?? "UNPAID",
    payments: opts.payments ?? [],
  });
  inv[key] = row.id;
};

describe("MSME receivable claims (TN-05)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    ACCOUNTS = await authed("demo.accounts");
    PRODUCTION = await authed("demo.production");
    // No credit days: nothing agreed in writing, so section 15 gives 15 days.
    BUYER = (await createCustomer({ creditDays: null, firmName: `Big Buyer ${sfx} Ltd` })).id;
    OTHER_BUYER = (await createCustomer()).id;
    await invoice("A", { amount: 100_000, daysAgo: 120 });
    await invoice("B", {
      amount: 50_000,
      daysAgo: 60,
      payments: [{ amount: 20_000, paymentDate: day(-40) }],
    });
    await invoice("C", { amount: 10_000, daysAgo: 5 }); // not yet past 15 days
    await invoice("D", {
      amount: 5_000,
      daysAgo: 100,
      status: "PAID",
      payments: [{ amount: 5_000, paymentDate: day(-50) }],
    });
    await invoice("E", { customerId: OTHER_BUYER, amount: 7_000, daysAgo: 90 });
    await invoice("F", { amount: 9_000, daysAgo: 90, status: "DRAFT" });
    await invoice("G", { amount: 12_000, daysAgo: 200 }); // too old for TReDS
    await invoice("H", { amount: 8_000, daysAgo: 70 });
  });

  it("starts from the default bank rate with a note to verify it", async () => {
    const res = await (await api()).get(`${BASE}/settings`).set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ bankRate: 6.75, annualRate: 20.25, isDefault: true });
    expect(res.body.data.verifyNote).toMatch(/verify/i);
  });

  it("rejects invalid settings", async () => {
    const client = await api();
    const put = (body: Record<string, unknown>) =>
      client.put(`${BASE}/settings`).set(OWNER.auth).send(body);
    expect((await put({})).status).toBe(400);
    expect((await put({ bankRate: 0 })).status).toBe(400);
    expect((await put({ bankRate: -1 })).status).toBe(400);
    expect((await put({ bankRate: 40 })).status).toBe(400);
    expect((await put({ bankRate: "abc" })).status).toBe(400);
    expect((await put({ bankRate: 6.5, udyamNumber: "UDYAM-123" })).status).toBe(400);
    expect((await put({ bankRate: 6.5, enterpriseCategory: "HUGE" })).status).toBe(400);
    expect((await put({ bankRate: 6.5, surprise: true })).status).toBe(400);
  });

  it("saves the bank rate and Udyam number", async () => {
    const res = await (await api()).put(`${BASE}/settings`).set(ACCOUNTS.auth).send({
      bankRate: 6.5,
      bankRateNote: "RBI press release checked 27-09-2026",
      udyamNumber: "udyam-tn-02-0012345",
      enterpriseCategory: "SMALL",
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      bankRate: 6.5,
      annualRate: 19.5,
      isDefault: false,
      udyamNumber: "UDYAM-TN-02-0012345",
      enterpriseCategory: "SMALL",
    });
  });

  it("lists only unpaid invoices past section 15, with interest and TReDS flags", async () => {
    const res = await (await api()).get(`${BASE}/eligible?customerId=${BUYER}`).set(OWNER.auth);
    expect(res.status).toBe(200);
    const byNo = new Map(
      res.body.data.rows.map((r: { invoiceNo: string }) => [r.invoiceNo, r] as const)
    );
    expect([...byNo.keys()].sort()).toEqual(
      ["A", "B", "G", "H"].map((k) => `MC-${sfx}-${k}`).sort()
    );
    const a = byNo.get(`MC-${sfx}-A`) as Record<string, any>;
    const expected = computeClaim({
      amount: 100_000,
      invoiceDate: day(-120),
      agreedDays: null,
      payments: [],
      bankRate: 6.5,
      asOf: today,
    });
    expect(a).toMatchObject({
      limitDays: 15,
      dueDate: day(-105),
      daysLate: 105,
      principalOutstanding: 100_000,
      interest: expected.interest,
      claim: null,
    });
    expect(a.treds.flag).toBe("CHECK");
    expect((byNo.get(`MC-${sfx}-G`) as any).treds.flag).toBe("NO");
    const b = byNo.get(`MC-${sfx}-B`) as Record<string, any>;
    expect(b.paid).toBe(20_000);
    expect(b.principalOutstanding).toBe(30_000);
    expect(res.body.data.annualRate).toBe(19.5);
    expect(res.body.data.buyers).toHaveLength(1);
    expect(res.body.data.totals.invoices).toBe(4);
  });

  it("raises a claim, recomputing every line on the server", async () => {
    const res = await (
      await api()
    )
      .post(BASE)
      .set(OWNER.auth)
      .send({
        customerId: BUYER,
        invoiceIds: [inv.A, inv.B],
        forum: "SAMADHAAN",
        notes: "Repeated reminders ignored",
        // Anything the client computes is ignored.
        interestTotal: 1,
        principalTotal: 1,
      });
    expect(res.status).toBe(201);
    CLAIM_ID = res.body.data.id;
    const claim = res.body.data;
    expect(claim.claimNo).toMatch(/^MSC\//);
    expect(claim.status).toBe("DRAFT");
    expect(claim.nextStatuses).toEqual(["FILED", "WITHDRAWN"]);
    expect(claim.bankRate).toBe(6.5);
    expect(claim.annualRate).toBe(19.5);
    expect(claim.principalTotal).toBe(130_000);
    const expA = computeClaim({
      amount: 100_000,
      invoiceDate: day(-120),
      payments: [],
      bankRate: 6.5,
      asOf: today,
    });
    const expB = computeClaim({
      amount: 50_000,
      invoiceDate: day(-60),
      payments: [{ date: day(-40), amount: 20_000 }],
      bankRate: 6.5,
      asOf: today,
    });
    expect(claim.interestTotal).toBeCloseTo(expA.interest + expB.interest, 2);
    expect(claim.lines).toHaveLength(2);
    expect(claim.lines[0]).toMatchObject({ invoiceNo: `MC-${sfx}-A`, daysLate: 105 });

    // The invoices now show the claim they sit on.
    const elig = await (await api()).get(`${BASE}/eligible?customerId=${BUYER}`).set(OWNER.auth);
    const a = elig.body.data.rows.find((r: { invoiceId: string }) => r.invoiceId === inv.A);
    expect(a.claim).toMatchObject({ id: CLAIM_ID, status: "DRAFT" });

    const list = await (await api()).get(`${BASE}?customerId=${BUYER}`).set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(CLAIM_ID);
    expect(list.body.data[0].lines).toBeUndefined();
  });

  it("rejects every invalid claim", async () => {
    const client = await api();
    const post = (body: Record<string, unknown>) =>
      client
        .post(BASE)
        .set(OWNER.auth)
        .send({ customerId: BUYER, invoiceIds: [inv.H], ...body });
    expect((await post({ invoiceIds: [inv.A] })).status).toBe(409); // already on a claim
    expect((await post({ invoiceIds: [inv.C] })).status).toBe(400); // not yet late
    expect((await post({ invoiceIds: [inv.D] })).status).toBe(400); // paid in full
    expect((await post({ invoiceIds: [inv.E] })).status).toBe(400); // another buyer's
    expect((await post({ invoiceIds: [inv.F] })).status).toBe(400); // draft
    expect((await post({ invoiceIds: [randomUUID()] })).status).toBe(404);
    expect((await post({ invoiceIds: [] })).status).toBe(400);
    expect((await post({ invoiceIds: [inv.H, inv.H] })).status).toBe(400);
    expect((await post({ invoiceIds: ["nope"] })).status).toBe(400);
    expect((await post({ customerId: "not-a-uuid" })).status).toBe(400);
    expect((await post({ customerId: randomUUID() })).status).toBe(404);
    expect((await post({ forum: "HIGH_COURT" })).status).toBe(400);
    expect((await post({ asOf: day(5) })).status).toBe(400); // future
    expect((await post({ asOf: "27/09/2026" })).status).toBe(400);
    expect((await post({ asOf: day(-80) })).status).toBe(400); // before invoice H
    const claimNo = (await client.get(`${BASE}/${CLAIM_ID}`).set(OWNER.auth)).body.data.claimNo;
    const dup = await post({ claimNo });
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.body)).not.toMatch(/prisma|stack|at .*\.ts/i);
  });

  it("moves status forward only, with the particulars each step needs", async () => {
    const client = await api();
    const patch = (body: Record<string, unknown>) =>
      client.patch(`${BASE}/${CLAIM_ID}/status`).set(OWNER.auth).send(body);
    expect((await patch({ status: "HEARING" })).status).toBe(409); // skips filing
    expect((await patch({ status: "SETTLED", settledOn: day(0) })).status).toBe(409);
    expect((await patch({ status: "FILED" })).status).toBe(400); // no date / reference
    expect((await patch({ status: "FILED", filedOn: day(0) })).status).toBe(400);
    expect((await patch({ status: "FILED", filedOn: day(3), referenceNo: "X" })).status).toBe(400);
    expect((await patch({ status: "OPEN" })).status).toBe(400);
    const filed = await patch({ status: "FILED", filedOn: day(0), referenceNo: `SAM-${sfx}` });
    expect(filed.status).toBe(200);
    expect(filed.body.data).toMatchObject({
      status: "FILED",
      filedOn: day(0),
      referenceNo: `SAM-${sfx}`,
    });
    expect((await patch({ status: "DRAFT" })).status).toBe(409); // backwards
    const hearing = await patch({ status: "HEARING", hearingOn: day(20) });
    expect(hearing.status).toBe(200);
    expect(hearing.body.data.hearingOn).toBe(day(20));
    expect((await patch({ status: "FILED", filedOn: day(0), referenceNo: "R" })).status).toBe(409);
  });

  it("recomputes to a new date and refuses bad dates", async () => {
    const client = await api();
    const post = (asOf: string) =>
      client.post(`${BASE}/${CLAIM_ID}/recompute`).set(OWNER.auth).send({ asOf });
    const earlier = await post(day(-30));
    expect(earlier.status).toBe(200);
    expect(earlier.body.data.asOfDate).toBe(day(-30));
    const expA = computeClaim({
      amount: 100_000,
      invoiceDate: day(-120),
      payments: [],
      bankRate: 6.5,
      asOf: day(-30),
    });
    expect(earlier.body.data.lines[0].interest).toBe(expA.interest);
    expect(earlier.body.data.lines[0].daysLate).toBe(75);
    // B's receipt on day -40 is before -30, so B's principal is 30000 here too.
    expect(earlier.body.data.principalTotal).toBe(130_000);
    expect((await post(day(-70))).status).toBe(400); // before invoice B
    expect((await post(day(2))).status).toBe(400); // future
    expect(
      (await client.post(`${BASE}/${CLAIM_ID}/recompute`).set(OWNER.auth).send({})).status
    ).toBe(400);
    expect((await post(day(0))).status).toBe(200);
  });

  it("renders the claim statement PDF in the Samadhaan layout", async () => {
    const res = await (await api()).get(`${BASE}/${CLAIM_ID}/pdf`).set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("MSME-claim-MSC_");
    const html = pdfCalls.at(-1) ?? "";
    expect(html).toContain("UDYAM-TN-02-0012345");
    expect(html).toContain(`Big Buyer ${sfx} Ltd`);
    expect(html).toContain(`MC-${sfx}-A`);
    expect(html).toContain(`SAM-${sfx}`);
    expect(html).toMatch(/monthly rests/);
    expect(html).toContain("19.5%");
  });

  it("settles, then refuses to move or recompute", async () => {
    const client = await api();
    const patch = (body: Record<string, unknown>) =>
      client.patch(`${BASE}/${CLAIM_ID}/status`).set(OWNER.auth).send(body);
    expect((await patch({ status: "SETTLED" })).status).toBe(400); // needs a date
    expect((await patch({ status: "SETTLED", settledOn: day(0), settledAmount: -1 })).status).toBe(
      400
    );
    const settled = await patch({ status: "SETTLED", settledOn: day(0), settledAmount: 125_000 });
    expect(settled.status).toBe(200);
    expect(settled.body.data).toMatchObject({ status: "SETTLED", settledAmount: 125_000 });
    expect(settled.body.data.nextStatuses).toEqual([]);
    expect((await patch({ status: "WITHDRAWN" })).status).toBe(409);
    expect(
      (
        await client
          .post(`${BASE}/${CLAIM_ID}/recompute`)
          .set(OWNER.auth)
          .send({ asOf: day(0) })
      ).status
    ).toBe(409);
    expect((await client.delete(`${BASE}/${CLAIM_ID}`).set(OWNER.auth)).status).toBe(404);
  });

  it("a withdrawn claim frees its invoices for a new one", async () => {
    const client = await api();
    const c = await client
      .post(BASE)
      .set(ACCOUNTS.auth)
      .send({ customerId: BUYER, invoiceIds: [inv.H], forum: "MSEFC", claimNo: `MANUAL-${sfx}` });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ claimNo: `MANUAL-${sfx}`, forum: "MSEFC" });
    const w = await client
      .patch(`${BASE}/${c.body.data.id}/status`)
      .set(ACCOUNTS.auth)
      .send({ status: "WITHDRAWN" });
    expect(w.status).toBe(200);
    const again = await client
      .post(BASE)
      .set(ACCOUNTS.auth)
      .send({ customerId: BUYER, invoiceIds: [inv.H] });
    expect(again.status).toBe(201);
  });

  it("rejects bad ids and filters", async () => {
    const client = await api();
    expect((await client.get(`${BASE}/not-a-uuid`).set(OWNER.auth)).status).toBe(400);
    expect((await client.get(`${BASE}/${randomUUID()}`).set(OWNER.auth)).status).toBe(404);
    expect((await client.get(`${BASE}?status=LOST`).set(OWNER.auth)).status).toBe(400);
    expect((await client.get(`${BASE}/eligible?customerId=x`).set(OWNER.auth)).status).toBe(400);
    expect(
      (await client.get(`${BASE}/eligible?customerId=${randomUUID()}`).set(OWNER.auth)).status
    ).toBe(404);
    expect((await client.get(`${BASE}/eligible?asOf=yesterday`).set(OWNER.auth)).status).toBe(400);
  });

  it("refuses a role without msme-claims permissions", async () => {
    const client = await api();
    expect((await client.get(BASE).set(PRODUCTION.auth)).status).toBe(403);
    expect((await client.get(`${BASE}/eligible`).set(PRODUCTION.auth)).status).toBe(403);
    expect(
      (
        await client
          .post(BASE)
          .set(PRODUCTION.auth)
          .send({ customerId: BUYER, invoiceIds: [inv.H] })
      ).status
    ).toBe(403);
    expect(
      (await client.put(`${BASE}/settings`).set(PRODUCTION.auth).send({ bankRate: 7 })).status
    ).toBe(403);
    expect((await client.get(`${BASE}/${CLAIM_ID}/pdf`).set(PRODUCTION.auth)).status).toBe(403);
  });

  it("a foreign company sees none of these claims or settings", async () => {
    const prisma = await getPrisma();
    const demoId = (await demoCompany()).id;
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "MSME Tenant B", companyCode: `MSB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.msmeRecoveryClaim.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.msmeRecoveryClaimLine.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.msmeClaimSetting.count())).toBe(0);
    expect(
      await runAsTenant(other.id, () =>
        prisma.msmeRecoveryClaim.findFirst({ where: { id: CLAIM_ID } })
      )
    ).toBeNull();
    expect(
      await runAsTenant(other.id, () =>
        prisma.msmeRecoveryClaim.findFirst({ where: { companyId: demoId } })
      )
    ).toBeNull();
    expect(await asDemoTenant(() => prisma.msmeRecoveryClaim.count())).toBeGreaterThan(0);
  });
});
