import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import {
  addDays,
  addMonthKey,
  asDate,
  iso,
  monthEnd,
  monthKeyOf,
} from "../../src/modules/subsidy-schemes/subsidy.calc";

/**
 * Subsidies and scheme claims (TN-10): scheme CRUD with kind-specific figures, forward-only
 * scheme and claim status, the LTPT month grid, reminders, summary, CSV, validation,
 * permissions and tenancy.
 */
const BASE = "/api/subsidy-schemes";
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const today = asDate(new Date());
const day = (n: number) => iso(addDays(today, n));
const thisMonth = monthKeyOf(today);
const ltptStart = addMonthKey(thisMonth, -5);
const mEnd = (k: string) => iso(monthEnd(k));

let OWNER: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };
let AUDITOR: { auth: Record<string, string> };
const ids: Record<string, string> = {};
const claims: Record<string, string> = {};

const capital = {
  schemeCode: `cap-${sfx}`,
  kind: "CAPITAL_SUBSIDY",
  name: "TN capital subsidy on new plant",
  authority: "DIC",
  sanctionOrderNo: "DIC/CS/2026/114",
  sanctionDate: day(-60),
  sanctionedAmount: 1_000_000,
  status: "SANCTIONED",
  details: { eligiblePlantMachinery: 4_000_000, ratePct: 25, cap: 15_000_000 },
};

const ltpt = {
  schemeCode: `LTPT-${sfx}`,
  kind: "POWER_SUBSIDY_LTPT",
  name: "LTPT power tariff subsidy",
  authority: "TANGEDCO / DIC",
  sanctionOrderNo: "LTPT/2026/9",
  sanctionDate: day(-200),
  status: "ACTIVE",
  details: { startMonth: ltptStart, months: 36, ratePct: 20, monthlyBaseTariff: 50_000 },
};

const interest = {
  schemeCode: `INT-${sfx}`,
  kind: "INTEREST_SUBVENTION",
  name: "Back-ended interest subvention",
  authority: "TIIC",
  sanctionOrderNo: "TIIC/IS/77",
  sanctionDate: day(-400),
  validFrom: day(-365),
  status: "ACTIVE",
  details: {
    loanAccountRef: "TIIC-LN-0042",
    lender: "TIIC",
    sanctionedLoan: 1_000_000,
    subventionPct: 3,
  },
};

describe("Subsidies and scheme claims (TN-10)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    ACCOUNTS = await authed("demo.accounts");
    PRODUCTION = await authed("demo.production");
    AUDITOR = await authed("demo.auditor");
  });

  it("serves suggested defaults with a note to verify them", async () => {
    const res = await (await api()).get(`${BASE}/summary`).set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.defaults.CAPITAL_SUBSIDY).toMatchObject({ ratePct: 25 });
    expect(res.body.data.defaults.POWER_SUBSIDY_LTPT).toMatchObject({ ratePct: 20, months: 36 });
    expect(res.body.data.verifyNote).toMatch(/verify.*G\.O\./i);
  });

  it("rejects every invalid scheme", async () => {
    const client = await api();
    const post = (body: Record<string, unknown>) => client.post(BASE).set(ACCOUNTS.auth).send(body);
    const bad = async (body: Record<string, unknown>, msg: RegExp) => {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.message).toMatch(msg);
    };
    const cap = (details: Record<string, unknown>) => ({
      ...capital,
      schemeCode: `X-${sfx}`,
      details: { ...capital.details, ...details },
    });
    const lt = (details: Record<string, unknown>) => ({
      ...ltpt,
      schemeCode: `X-${sfx}`,
      details: { ...ltpt.details, ...details },
    });
    const it_ = (details: Record<string, unknown>) => ({
      ...interest,
      schemeCode: `X-${sfx}`,
      details: { ...interest.details, ...details },
    });
    await bad({ ...capital, schemeCode: "" }, /scheme code/i);
    await bad({ ...capital, schemeCode: "CAP 1!" }, /letters, digits/i);
    await bad({ ...capital, kind: "LOTTERY" }, /kind of scheme/i);
    await bad({ ...capital, name: "" }, /name/i);
    await bad({ ...capital, sanctionedAmount: 0 }, /sanctioned amount/i);
    await bad({ ...capital, sanctionedAmount: "lots" }, /number/i);
    await bad({ ...capital, validFrom: day(-10), validTo: day(-20) }, /end before/i);
    await bad({ ...capital, sanctionDate: "27-09-2026" }, /2026-09-27/);
    await bad({ ...capital, surprise: 1 }, /unrecognized|surprise/i);
    await bad({ ...capital, schemeCode: `X-${sfx}`, details: undefined }, /needs its figures/i);
    await bad(cap({ eligiblePlantMachinery: 0 }), /plant and machinery/i);
    await bad(cap({ ratePct: 0 }), /rate must be more than zero/i);
    await bad(cap({ ratePct: 150 }), /at most 100/i);
    await bad(cap({ ratePct: 80, extraPct: 30 }), /exceed 100/i);
    await bad(cap({ cap: -5 }), /cap/i);
    await bad(cap({ bonus: 1 }), /unrecognized|bonus/i);
    await bad(lt({ startMonth: "2026-13" }), /2026-04/);
    await bad(lt({ months: 0 }), /at least one month/i);
    await bad(lt({ months: 12.5 }), /whole number/i);
    await bad(lt({ monthlyBaseTariff: 0 }), /base tariff/i);
    await bad(lt({ claimWindowDays: 0 }), /claim window/i);
    await bad(
      lt({ tariffByMonth: { [addMonthKey(ltptStart, 40)]: 1000 } }),
      /outside the subsidy months/i
    );
    await bad(it_({ loanAccountRef: "" }), /loan account/i);
    await bad(it_({ sanctionedLoan: 0 }), /sanctioned loan/i);
    await bad(it_({ subventionPct: 20 }), /too high/i);
    await bad(
      it_({
        balances: [
          { from: day(-30), principal: 900_000 },
          { from: day(-30), principal: 800_000 },
        ],
      }),
      /share a date/i
    );
    await bad(
      { ...capital, schemeCode: `X-${sfx}`, kind: "PLI", details: { ratePct: 5 } },
      /no extra fields/i
    );
    await bad(
      { ...capital, schemeCode: `X-${sfx}`, sanctionOrderNo: undefined },
      /sanction order number and date/i
    );
    await bad({ ...capital, schemeCode: `X-${sfx}`, sanctionDate: day(5) }, /future/i);
  });

  it("adds schemes of each kind with their figures", async () => {
    const client = await api();
    const c = await client.post(BASE).set(ACCOUNTS.auth).send(capital);
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({
      schemeCode: `CAP-${sfx}`,
      status: "SANCTIONED",
      sanctionedAmount: 1_000_000,
      expected: 1_000_000,
      calc: { type: "CAPITAL", entitlement: 1_000_000, capped: false },
      nextStatuses: ["ACTIVE", "CLOSED"],
    });
    ids.capital = c.body.data.id;

    const l = await client.post(BASE).set(ACCOUNTS.auth).send(ltpt);
    expect(l.status).toBe(201);
    expect(l.body.data.calc.type).toBe("LTPT");
    expect(l.body.data.calc.months).toHaveLength(36);
    expect(l.body.data.calc.totals).toMatchObject({ dueMonths: 5, due: 50_000 });
    expect(l.body.data.expected).toBe(360_000);
    ids.ltpt = l.body.data.id;

    const i = await client.post(BASE).set(ACCOUNTS.auth).send(interest);
    expect(i.status).toBe(201);
    expect(i.body.data.calc).toMatchObject({ type: "INTEREST", fullYearAtSanction: 30_000 });
    ids.interest = i.body.data.id;

    const p = await client
      .post(BASE)
      .set(OWNER.auth)
      .send({
        schemeCode: `PLI-${sfx}`,
        kind: "PLI",
        name: "PLI for auto components",
        authority: "Ministry of Heavy Industries",
      });
    expect(p.status).toBe(201);
    expect(p.body.data).toMatchObject({ status: "APPLIED", details: null, calc: null });
    ids.pli = p.body.data.id;

    const dup = await client
      .post(BASE)
      .set(ACCOUNTS.auth)
      .send({ ...capital, name: "Again" });
    expect(dup.status).toBe(409);

    const list = await client.get(BASE).set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining(Object.values(ids))
    );
    const filtered = await client.get(`${BASE}?kind=PLI`).set(OWNER.auth);
    expect(filtered.body.data.every((s: { kind: string }) => s.kind === "PLI")).toBe(true);
  });

  it("suggests what a claim should come to", async () => {
    const client = await api();
    const r = await client
      .get(
        `${BASE}/${ids.ltpt}/entitlement?from=${ltptStart}-01&to=${mEnd(addMonthKey(ltptStart, 1))}`
      )
      .set(ACCOUNTS.auth);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ amount: 20_000 });
    expect(r.body.data.months).toHaveLength(2);
    const c = await client
      .get(`${BASE}/${ids.capital}/entitlement?from=${day(-30)}&to=${day(-1)}`)
      .set(ACCOUNTS.auth);
    expect(c.body.data.amount).toBe(1_000_000);
    const bad = await client
      .get(`${BASE}/${ids.ltpt}/entitlement?from=${day(-1)}&to=${day(-30)}`)
      .set(ACCOUNTS.auth);
    expect(bad.status).toBe(400);
  });

  it("rejects every invalid claim", async () => {
    const client = await api();
    const post = (id: string, body: Record<string, unknown>) =>
      client.post(`${BASE}/${id}/claims`).set(ACCOUNTS.auth).send(body);
    const ok = { periodFrom: day(-90), periodTo: day(-1), amountClaimed: 100_000 };
    const expectErr = async (
      id: string,
      body: Record<string, unknown>,
      code: number,
      msg: RegExp
    ) => {
      const res = await post(id, body);
      expect(res.status, JSON.stringify(body)).toBe(code);
      expect(res.body.message).toMatch(msg);
    };
    await expectErr(ids.pli, ok, 409, /sanctioned or active/i);
    await expectErr(ids.capital, { ...ok, periodTo: day(-100) }, 400, /end before/i);
    await expectErr(ids.capital, { ...ok, amountClaimed: 0 }, 400, /more than zero/i);
    await expectErr(ids.capital, { ...ok, amountClaimed: -5 }, 400, /more than zero/i);
    await expectErr(ids.capital, { ...ok, periodFrom: "yesterday" }, 400, /2026-09-27/);
    await expectErr(ids.capital, { ...ok, periodFrom: day(3), periodTo: day(10) }, 400, /future/i);
    await expectErr(ids.capital, { ...ok, extra: true }, 400, /unrecognized|extra/i);
    await expectErr(ids.capital, { ...ok, amountClaimed: 1_000_001 }, 400, /sanctioned amount/i);
    await expectErr(
      ids.interest,
      { ...ok, periodFrom: day(-400), periodTo: day(-300) },
      400,
      /validity/i
    );
    await expectErr(
      ids.ltpt,
      { ...ok, periodFrom: day(-900), periodTo: day(-800) },
      400,
      /none of the subsidy months/i
    );
    expect((await post(randomUUID(), ok)).status).toBe(404);
    expect((await post("not-a-uuid", ok)).status).toBe(400);
  });

  it("files LTPT claims month by month and marks the grid", async () => {
    const client = await api();
    const m2 = addMonthKey(ltptStart, 1);
    const c = await client
      .post(`${BASE}/${ids.ltpt}/claims`)
      .set(ACCOUNTS.auth)
      .send({ periodFrom: `${ltptStart}-01`, periodTo: mEnd(m2), amountClaimed: 20_000 });
    expect(c.status).toBe(201);
    const claim = c.body.data.claims[0];
    expect(claim).toMatchObject({
      status: "DRAFT",
      amountClaimed: 20_000,
      nextStatuses: ["FILED"],
    });
    expect(claim.claimNo).toMatch(/^SUB\//);
    claims.ltpt = claim.id;
    expect(c.body.data.calc.months.slice(0, 3).map((m: { state: string }) => m.state)).toEqual([
      "CLAIMED",
      "CLAIMED",
      "DUE",
    ]);

    const overlap = await client
      .post(`${BASE}/${ids.ltpt}/claims`)
      .set(ACCOUNTS.auth)
      .send({
        periodFrom: mEnd(m2),
        periodTo: mEnd(addMonthKey(ltptStart, 2)),
        amountClaimed: 10_000,
      });
    expect(overlap.status).toBe(409);
    expect(overlap.body.message).toMatch(/already covers/i);

    const dupNo = await client
      .post(`${BASE}/${ids.capital}/claims`)
      .set(ACCOUNTS.auth)
      .send({ claimNo: claim.claimNo, periodFrom: day(-30), periodTo: day(-1), amountClaimed: 5 });
    expect(dupNo.status).toBe(409);
  });

  it("moves a claim forward only, with the particulars each step needs", async () => {
    const client = await api();
    const url = `${BASE}/${ids.ltpt}/claims/${claims.ltpt}/status`;
    const patch = (body: Record<string, unknown>) =>
      client.patch(url).set(ACCOUNTS.auth).send(body);
    expect((await patch({ status: "APPROVED" })).status).toBe(409);
    expect(
      (await patch({ status: "DISBURSED", disbursedAmount: 1, disbursedOn: day(-1) })).status
    ).toBe(409);
    expect((await patch({ status: "FILED" })).status).toBe(400);
    expect((await patch({ status: "FILED", filedOn: day(2) })).status).toBe(400);
    expect((await patch({ status: "LOST" })).status).toBe(400);
    const filed = await patch({ status: "FILED", filedOn: day(-20), referenceNo: "DIC/ACK/88" });
    expect(filed.status).toBe(200);
    const fc = filed.body.data.claims.find((c: { id: string }) => c.id === claims.ltpt);
    expect(fc).toMatchObject({
      status: "FILED",
      filedOn: day(-20),
      referenceNo: "DIC/ACK/88",
      daysPending: 20,
    });

    const edit = await client
      .patch(`${BASE}/${ids.ltpt}/claims/${claims.ltpt}`)
      .set(ACCOUNTS.auth)
      .send({ amountClaimed: 25_000 });
    expect(edit.status).toBe(409);

    expect((await patch({ status: "DRAFT" })).status).toBe(409);
    expect((await patch({ status: "DISBURSED" })).status).toBe(400);
    expect(
      (await patch({ status: "DISBURSED", disbursedAmount: 25_000, disbursedOn: day(-1) })).status
    ).toBe(400);
    expect(
      (await patch({ status: "DISBURSED", disbursedAmount: 20_000, disbursedOn: day(-30) })).status
    ).toBe(400);
    expect((await patch({ status: "APPROVED", approvedAmount: 30_000 })).status).toBe(400);
    expect((await patch({ status: "REJECTED" })).status).toBe(400);
    const approved = await patch({
      status: "APPROVED",
      approvedOn: day(-10),
      approvedAmount: 20_000,
    });
    expect(approved.status).toBe(200);
    const paid = await patch({
      status: "DISBURSED",
      disbursedAmount: 19_500,
      disbursedOn: day(-2),
      bankRef: "NEFT-UTR-7781",
    });
    expect(paid.status).toBe(200);
    const s = paid.body.data;
    expect(s.claims[0]).toMatchObject({
      status: "DISBURSED",
      disbursedAmount: 19_500,
      bankRef: "NEFT-UTR-7781",
      nextStatuses: [],
    });
    expect(s.totals).toMatchObject({
      claimed: 20_000,
      disbursed: 19_500,
      pending: 0,
      shortfall: 500,
    });
    expect(s.calc.months.slice(0, 2).map((m: { state: string }) => m.state)).toEqual([
      "RECEIVED",
      "RECEIVED",
    ]);
    expect((await patch({ status: "REJECTED", rejectionReason: "late" })).status).toBe(409);
  });

  it("edits a draft claim and rejects a filed one with a reason", async () => {
    const client = await api();
    const c = await client
      .post(`${BASE}/${ids.capital}/claims`)
      .set(ACCOUNTS.auth)
      .send({
        claimNo: `cs-${sfx}-1`,
        periodFrom: day(-60),
        periodTo: day(-30),
        amountClaimed: 600_000,
      });
    expect(c.status).toBe(201);
    const claim = c.body.data.claims.find((x: { claimNo: string }) => x.claimNo === `CS-${sfx}-1`);
    claims.capital = claim.id;
    const edit = await client
      .patch(`${BASE}/${ids.capital}/claims/${claim.id}`)
      .set(ACCOUNTS.auth)
      .send({ amountClaimed: 700_000, notes: "Includes the CNC line" });
    expect(edit.status).toBe(200);
    expect(edit.body.data.claims[0]).toMatchObject({
      amountClaimed: 700_000,
      notes: "Includes the CNC line",
    });
    expect(
      (await client.patch(`${BASE}/${ids.capital}/claims/${claim.id}`).set(ACCOUNTS.auth).send({}))
        .status
    ).toBe(400);
    const over = await client
      .post(`${BASE}/${ids.capital}/claims`)
      .set(ACCOUNTS.auth)
      .send({ periodFrom: day(-20), periodTo: day(-1), amountClaimed: 400_000 });
    expect(over.status).toBe(400);
    const url = `${BASE}/${ids.capital}/claims/${claim.id}/status`;
    expect(
      (
        await client
          .patch(url)
          .set(ACCOUNTS.auth)
          .send({ status: "FILED", filedOn: day(-5) })
      ).status
    ).toBe(200);
    const rej = await client
      .patch(url)
      .set(ACCOUNTS.auth)
      .send({ status: "REJECTED", rejectionReason: "Machinery invoices not attested" });
    expect(rej.status).toBe(200);
    expect(rej.body.data.claims[0]).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Machinery invoices not attested",
    });
    // A rejected claim no longer counts against the sanction.
    const again = await client
      .post(`${BASE}/${ids.capital}/claims`)
      .set(ACCOUNTS.auth)
      .send({ periodFrom: day(-20), periodTo: day(-1), amountClaimed: 1_000_000 });
    expect(again.status).toBe(201);
  });

  it("reminds about unclaimed LTPT months and claims unpaid after 90 days", async () => {
    const client = await api();
    const c = await client
      .post(`${BASE}/${ids.interest}/claims`)
      .set(ACCOUNTS.auth)
      .send({ periodFrom: day(-300), periodTo: day(-120), amountClaimed: 14_794.52 });
    expect(c.status).toBe(201);
    claims.interest = c.body.data.claims[0].id;
    await client
      .patch(`${BASE}/${ids.interest}/claims/${claims.interest}/status`)
      .set(ACCOUNTS.auth)
      .send({ status: "FILED", filedOn: day(-100) });
    const r = await client.get(`${BASE}/reminders`).set(ACCOUNTS.auth);
    expect(r.status).toBe(200);
    const mine = r.body.data.items.filter((i: { schemeCode: string }) =>
      i.schemeCode.endsWith(sfx)
    );
    const due = mine.find((i: { type: string }) => i.type === "LTPT_DUE");
    expect(due).toMatchObject({ schemeId: ids.ltpt, amount: 30_000 });
    expect(due.months).toEqual([2, 3, 4].map((n) => addMonthKey(ltptStart, n)));
    const pending = mine.find((i: { type: string }) => i.type === "PENDING_DISBURSEMENT");
    expect(pending).toMatchObject({ schemeId: ids.interest, days: 100, amount: 14_794.52 });
    expect((await client.get(`${BASE}/reminders?asOf=soon`).set(ACCOUNTS.auth)).status).toBe(400);
  });

  it("moves a scheme forward only and never deletes one with claims", async () => {
    const client = await api();
    const status = (id: string, body: Record<string, unknown>) =>
      client.patch(`${BASE}/${id}/status`).set(ACCOUNTS.auth).send(body);
    expect((await status(ids.pli, { status: "ACTIVE" })).status).toBe(409);
    expect((await status(ids.pli, { status: "SANCTIONED" })).status).toBe(400);
    expect((await status(ids.pli, { status: "BOGUS" })).status).toBe(400);
    const s = await status(ids.pli, {
      status: "SANCTIONED",
      sanctionOrderNo: "MHI/PLI/31",
      sanctionDate: day(-3),
      sanctionedAmount: 250_000,
    });
    expect(s.status).toBe(200);
    expect(s.body.data).toMatchObject({ status: "SANCTIONED", sanctionedAmount: 250_000 });
    expect((await status(ids.pli, { status: "APPLIED" })).status).toBe(409);

    const del = await client.delete(`${BASE}/${ids.ltpt}`).set(ACCOUNTS.auth);
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/close it/i);
    const kind = await client
      .patch(`${BASE}/${ids.ltpt}`)
      .set(ACCOUNTS.auth)
      .send({ kind: "CAPITAL_SUBSIDY", details: capital.details });
    expect(kind.status).toBe(409);
    const edit = await client
      .patch(`${BASE}/${ids.ltpt}`)
      .set(ACCOUNTS.auth)
      .send({
        details: { ...ltpt.details, claimWindowDays: 45 },
        eligibilityNotes: "HT/LT service no. 0123",
      });
    expect(edit.status).toBe(200);
    expect(edit.body.data.details.claimWindowDays).toBe(45);
    expect(
      (
        await client
          .patch(`${BASE}/${ids.ltpt}`)
          .set(ACCOUNTS.auth)
          .send({ details: { ...ltpt.details, ratePct: 0 } })
      ).status
    ).toBe(400);
    expect((await client.patch(`${BASE}/${ids.ltpt}`).set(ACCOUNTS.auth).send({})).status).toBe(
      400
    );
    expect(
      (
        await client
          .patch(`${BASE}/${ids.ltpt}`)
          .set(ACCOUNTS.auth)
          .send({ schemeCode: `CAP-${sfx}` })
      ).status
    ).toBe(409);

    expect((await status(ids.ltpt, { status: "CLOSED" })).status).toBe(200);
    expect(
      (await client.patch(`${BASE}/${ids.ltpt}`).set(ACCOUNTS.auth).send({ name: "Renamed" }))
        .status
    ).toBe(409);
    const late = await client
      .post(`${BASE}/${ids.ltpt}/claims`)
      .set(ACCOUNTS.auth)
      .send({ periodFrom: day(-60), periodTo: day(-31), amountClaimed: 10_000 });
    expect(late.status).toBe(409);

    const spare = await client
      .post(BASE)
      .set(ACCOUNTS.auth)
      .send({
        schemeCode: `TMP-${sfx}`,
        kind: "STATE_OTHER",
        name: "Entered by mistake",
      });
    expect(spare.status).toBe(201);
    expect((await client.delete(`${BASE}/${spare.body.data.id}`).set(ACCOUNTS.auth)).status).toBe(
      200
    );
    expect((await client.get(`${BASE}/${spare.body.data.id}`).set(ACCOUNTS.auth)).status).toBe(404);
  });

  it("totals sanctioned, claimed, received and pending", async () => {
    const res = await (await api()).get(`${BASE}/summary`).set(OWNER.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    // Demo tenant may hold other suites' rows; ours alone give at least these figures.
    expect(d.sanctioned).toBeGreaterThanOrEqual(1_250_000);
    expect(d.received).toBeGreaterThanOrEqual(19_500);
    expect(d.pending).toBeGreaterThanOrEqual(14_794.52);
    expect(d.drafted).toBeGreaterThanOrEqual(1_000_000);
    expect(d.reminderCount).toBeGreaterThanOrEqual(1);
  });

  it("exports the register as CSV", async () => {
    const res = await (await api()).get(`${BASE}/export.csv`).set(ACCOUNTS.auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toMatch(/^Scheme code,Name,Kind/);
    expect(res.text).toContain(`CAP-${sfx}`);
  });

  it("refuses roles without the permission", async () => {
    const client = await api();
    expect((await client.get(BASE).set(PRODUCTION.auth)).status).toBe(403);
    expect((await client.get(`${BASE}/summary`).set(PRODUCTION.auth)).status).toBe(403);
    expect((await client.post(BASE).set(PRODUCTION.auth).send(capital)).status).toBe(403);
    expect((await client.get(`${BASE}/${ids.capital}`).set(AUDITOR.auth)).status).toBe(200);
    expect((await client.post(BASE).set(AUDITOR.auth).send(capital)).status).toBe(403);
    expect(
      (await client.patch(`${BASE}/${ids.pli}/status`).set(AUDITOR.auth).send({ status: "ACTIVE" }))
        .status
    ).toBe(403);
    expect((await client.get(`${BASE}/export.csv`).set(AUDITOR.auth)).status).toBe(403);
    expect(
      (
        await client
          .post(`${BASE}/${ids.capital}/claims`)
          .set(AUDITOR.auth)
          .send({ periodFrom: day(-5), periodTo: day(-1), amountClaimed: 1 })
      ).status
    ).toBe(403);
  });

  it("a foreign company sees none of these schemes or claims", async () => {
    const prisma = await getPrisma();
    const demoId = (await demoCompany()).id;
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Subsidy Tenant B", companyCode: `SUB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.subsidyScheme.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.subsidyClaim.count())).toBe(0);
    expect(
      await runAsTenant(other.id, () =>
        prisma.subsidyScheme.findFirst({ where: { id: ids.capital } })
      )
    ).toBeNull();
    expect(
      await runAsTenant(other.id, () =>
        prisma.subsidyClaim.findFirst({ where: { companyId: demoId } })
      )
    ).toBeNull();
    expect(await asDemoTenant(() => prisma.subsidyScheme.count())).toBeGreaterThan(0);
  });
});
