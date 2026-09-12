import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";

/**
 * Fixed assets (P1-18).
 *
 * The arithmetic is proved in `test/unit/depreciation.spec.ts`; what is proved here is that the
 * register and the books stay in step — a month runs once, posting moves both the asset and the
 * ledgers, and a disposal takes cost *and* accumulated depreciation off rather than a single
 * written-down figure.
 */
const sfx = Date.now().toString(36).slice(-5);
// FY 2031-32: past every other suite's period, so nothing else is in these months or this year.
const PUT_TO_USE = "2031-04-01";
const PERIOD = "2031-04";

let OWNER: { auth: Record<string, string> };

const addAsset = async (over: Record<string, unknown> = {}) => {
  const res = await (
    await api()
  )
    .post("/api/assets")
    .set(OWNER.auth)
    .send({
      code: `FA-${sfx}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      name: `Test Machine ${sfx}`,
      classCode: "PM",
      cost: 120000,
      acquiredOn: PUT_TO_USE,
      capitalisedOn: PUT_TO_USE,
      ...over,
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data as { id: string; code: string; cost: string };
};

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

describe("fixed assets and depreciation", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("seeds the standard classes on first use, with both regimes on each", async () => {
    const res = await (await api()).get("/api/assets/classes").set(OWNER.auth);
    expect(res.status).toBe(200);
    const classes = res.body.data as {
      code: string;
      usefulLifeYears: number;
      method: string;
      itBlockRate: string;
    }[];
    const pm = classes.find((c) => c.code === "PM")!;
    expect(pm).toBeDefined();
    // Schedule II gives plant and machinery fifteen years; the income-tax block is 15%. They are
    // different numbers about different things and both live on the class.
    expect(pm.usefulLifeYears).toBe(15);
    expect(Number(pm.itBlockRate)).toBe(15);
    const comp = classes.find((c) => c.code === "COMP")!;
    expect(comp.method).toBe("WDV");
    expect(Number(comp.itBlockRate)).toBe(40);
  });

  it("puts an asset on the register with the class's life and residual copied onto it", async () => {
    const asset = await addAsset();
    const res = await (await api()).get(`/api/assets/${asset.id}`).set(OWNER.auth);
    expect(res.status).toBe(200);
    const row = res.body.data as {
      usefulLifeMonths: number;
      residualValue: string;
      wdv: number;
      status: string;
    };
    expect(row.usefulLifeMonths).toBe(180);
    // 5% of 120,000: copied at capitalisation so a later edit to the class cannot move it.
    expect(Number(row.residualValue)).toBe(6000);
    expect(row.wdv).toBe(120000);
    expect(row.status).toBe("ACTIVE");
  });

  it("runs a month once: preparing twice returns the same run and charges once", async () => {
    await addAsset();
    const client = await api();

    const first = await client.post(`/api/assets/depreciation/${PERIOD}/prepare`).set(OWNER.auth);
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);
    const run = first.body.data as {
      id: string;
      status: string;
      totalAmount: string;
      assetCount: number;
    };
    expect(run.status).toBe("DRAFT");
    expect(run.assetCount).toBeGreaterThan(0);

    const again = await client.post(`/api/assets/depreciation/${PERIOD}/prepare`).set(OWNER.auth);
    expect(again.status).toBe(200);
    // The same run comes back rather than a second one; the period is unique.
    expect(again.body.data.id).toBe(run.id);
    expect(Number(again.body.data.totalAmount)).toBe(Number(run.totalAmount));
  });

  it("posts the month to the books and moves the accumulated depreciation on each asset", async () => {
    const client = await api();
    const prepared = await client
      .post(`/api/assets/depreciation/${PERIOD}/prepare`)
      .set(OWNER.auth);
    const runId = prepared.body.data.id as string;
    const total = Number(prepared.body.data.totalAmount);

    const depBefore = await ledgerBalance("DEP-001");
    const accumBefore = await ledgerBalance("FA-ACC-001");

    const posted = await client.post(`/api/assets/depreciation/runs/${runId}/post`).set(OWNER.auth);
    expect(posted.status, JSON.stringify(posted.body).slice(0, 300)).toBe(200);
    expect(posted.body.data.status).toBe("POSTED");
    expect(posted.body.data.voucherId).toBeTruthy();

    // Dr depreciation, Cr accumulated depreciation — by the same amount, in the same journal.
    expect(Math.round((await ledgerBalance("DEP-001")) - depBefore)).toBe(Math.round(total));
    expect(Math.round(accumBefore - (await ledgerBalance("FA-ACC-001")))).toBe(Math.round(total));

    // Posting twice is refused rather than charging twice.
    const twice = await client.post(`/api/assets/depreciation/runs/${runId}/post`).set(OWNER.auth);
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("ALREADY_POSTED");
  });

  it("disposes of an asset against written-down value and takes cost and depreciation both off", async () => {
    const asset = await addAsset({ cost: 50000 });
    const prisma = await getPrisma();
    // Pretend a few years of depreciation have been charged.
    await asDemoTenant(() =>
      prisma.fixedAsset.update({
        where: { id: asset.id },
        data: { accumulatedDepreciation: 20000 },
      })
    );

    const accumBefore = await ledgerBalance("FA-ACC-001");
    const assetBefore = await ledgerBalance("FA-001");
    const plBefore = await ledgerBalance("ASSET-PL-001");

    const res = await (
      await api()
    )
      .post(`/api/assets/${asset.id}/dispose`)
      .set(OWNER.auth)
      .send({ disposedOn: "2031-06-30", proceeds: 35000, moneyLedgerCode: "BANK-001" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const out = res.body.data as { wdvAtDisposal: number; result: number; status: string };
    // Written-down value 30,000 sold for 35,000: a profit of 5,000, measured against WDV and not
    // against cost.
    expect(out.wdvAtDisposal).toBe(30000);
    expect(out.result).toBe(5000);
    expect(out.status).toBe("DISPOSED");

    // The cost comes off the asset ledger and the depreciation off the accumulated one; crediting
    // a single net figure would leave both balances wrong for ever after.
    expect(Math.round(assetBefore - (await ledgerBalance("FA-001")))).toBe(50000);
    expect(Math.round((await ledgerBalance("FA-ACC-001")) - accumBefore)).toBe(20000);
    expect(Math.round(plBefore - (await ledgerBalance("ASSET-PL-001")))).toBe(5000);

    // It cannot go twice.
    const twice = await (
      await api()
    )
      .post(`/api/assets/${asset.id}/dispose`)
      .set(OWNER.auth)
      .send({ disposedOn: "2031-06-30", proceeds: 1 });
    expect(twice.status).toBe(409);
  });

  it("moves an asset between business places without touching the books", async () => {
    const asset = await addAsset();
    const prisma = await getPrisma();
    const place = await asDemoTenant(() => prisma.businessPlace.findFirst());
    if (!place) return;

    const res = await (
      await api()
    )
      .post(`/api/assets/${asset.id}/events`)
      .set(OWNER.auth)
      .send({
        kind: "TRANSFER",
        effectiveOn: "2031-05-01",
        toBusinessPlaceId: String(place.id),
        narration: "Moved to the second shed",
      });
    expect(res.status).toBe(201);
    const after = await (await api()).get(`/api/assets/${asset.id}`).set(OWNER.auth);
    expect(after.body.data.businessPlaceId).toBe(String(place.id));
    // A transfer is a movement of a thing, not of money: nothing is posted.
    expect(res.body.data.voucherId ?? null).toBeNull();
  });

  it("reports the Schedule II register and the income-tax blocks, and they do not agree", async () => {
    const client = await api();
    const register = await client.get("/api/assets/register/2031-32").set(OWNER.auth);
    expect(register.status).toBe(200);
    const reg = register.body.data as {
      rows: { classCode: string; additions: number; chargeForYear: number }[];
      totals: { additions: number };
    };
    expect(reg.totals.additions).toBeGreaterThan(0);

    const blocks = await client.get("/api/assets/it-blocks/2031-32").set(OWNER.auth);
    expect(blocks.status).toBe(200);
    const it = blocks.body.data as { total: number; rows: { block: string; rate: number }[] };
    expect(it.rows.length).toBeGreaterThan(0);
    // Different rates, a pool instead of an asset, and a half-rate year: the two numbers are not
    // supposed to be the same, and the report says so.
    expect(blocks.body.data.note).toContain("will not match");
  });

  it("refuses a bad class, a zero cost, use before purchase and a foreign tenant's asset", async () => {
    const client = await api();
    expect(
      (
        await client
          .post("/api/assets")
          .set(OWNER.auth)
          .send({ code: `X-${sfx}`, name: "x", classCode: "NOPE", cost: 1, acquiredOn: PUT_TO_USE })
      ).status
    ).toBe(400);
    expect(
      (
        await client
          .post("/api/assets")
          .set(OWNER.auth)
          .send({ code: `Y-${sfx}`, name: "y", classCode: "PM", cost: 0, acquiredOn: PUT_TO_USE })
      ).status
    ).toBe(400);
    expect(
      (
        await client
          .post("/api/assets")
          .set(OWNER.auth)
          .send({
            code: `Z-${sfx}`,
            name: "z",
            classCode: "PM",
            cost: 100,
            acquiredOn: "2031-06-01",
            capitalisedOn: "2031-04-01",
          })
      ).status
    ).toBe(400);

    const production = await authed("demo.production");
    expect((await client.get("/api/assets").set(production.auth)).status).toBe(403);

    // And another tenant sees none of it.
    const asset = await addAsset();
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Asset Tenant B", companyCode: `FAB-${sfx}` },
      })
    );
    expect(
      await runAsTenant(other.id, () => prisma.fixedAsset.findUnique({ where: { id: asset.id } }))
    ).toBeNull();
  });
});
