import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct, createRawMaterial } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Multi-step process routes (TN-06): a knit route (knitting and dyeing at job workers, compacting
 * and stitching in-house, KG → PCS at stitching) run by one lot end to end with the dyeing step
 * carried by a real job-work challan and its return challan; every validation; permissions; and
 * tenancy (a foreign job worker, challan, product or route is refused, a foreign company sees none).
 */
const sfx = Date.now().toString(36).slice(-5);
const D = (n: number) => new Prisma.Decimal(n);

type Auth = { auth: Record<string, string> };
let OWNER: Auth;
let STORES: Auth;
let ACCOUNTS: Auth;
let KNITTER: string;
let DYER: string;
let OTHER_WORKER: string;
let RM_CODE: string;
let PRODUCT_A: string;
let PRODUCT_B: string;
let ROUTE_ID: string;
let LOT_ID: string;
let OUT_CHALLAN: { id: string; itemId: string };
let RETURN_CHALLAN: string;
let FOREIGN: {
  companyId: string;
  workerId: string;
  challanId: string;
  productId: string;
  routeId: string;
};

const routes = (p = "") => `/api/process-routes${p}`;
const lots = (p = "") => `/api/process-lots${p}`;

const knitSteps = () => [
  {
    name: "Knitting",
    mode: "JOB_WORK",
    uomIn: "kg",
    uomOut: "KG",
    lossNormPct: 2,
    defaultJobWorkerId: KNITTER,
  },
  { name: "DYEING", mode: "JOB_WORK", uomIn: "KG", uomOut: "KG", lossNormPct: 8 },
  { name: "COMPACTING", mode: "IN_HOUSE", uomIn: "KG", uomOut: "KG", lossNormPct: 1 },
  {
    name: "STITCHING",
    mode: "IN_HOUSE",
    uomIn: "KG",
    uomOut: "PCS",
    conversionFactor: 4,
    lossNormPct: 3,
  },
];

const worker = async (name: string) => {
  const prisma = await getPrisma();
  return (
    await asDemoTenant(() =>
      prisma.jobWorker.create({
        data: { code: `W${Math.random().toString(36).slice(2, 8)}`, name, processType: name },
      })
    )
  ).id;
};

/** A challan straight in the table, for the rejection cases. */
const rawChallan = async (over: Partial<Prisma.DeliveryChallanUncheckedCreateInput> = {}) => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.deliveryChallan.create({
      data: {
        challanNo: `TN6-${Math.random().toString(36).slice(2, 9)}`,
        challanDate: new Date("2026-09-05T00:00:00Z"),
        kind: "JOB_WORK_OUT",
        jobWorkerId: DYER,
        items: {
          create: [
            {
              itemType: "RAW_MATERIAL",
              description: "Grey fabric",
              uom: "KG",
              quantitySent: D(50),
            },
          ],
        },
        ...over,
      },
    })
  );
};

const move = async (lotId: string, body: Record<string, unknown>, who: Auth = OWNER) =>
  (await api())
    .post(lots(`/${lotId}/movements`))
    .set(who.auth)
    .send(body);

describe("process routes and the lot board (TN-06)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    STORES = await authed("demo.stores");
    ACCOUNTS = await authed("demo.accounts");
    KNITTER = await worker("Sri Balaji Knitting");
    DYER = await worker("Tiruppur Dyeing Works");
    OTHER_WORKER = await worker("Kongu Printers");
    RM_CODE = (await createRawMaterial({ baseUom: "KG" })).rawMaterialId;
    PRODUCT_A = (await createProduct()).id.toString();
    PRODUCT_B = (await createProduct()).id.toString();

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "Route Tenant B", companyCode: `RTB-${sfx}` } })
    );
    FOREIGN = await runAsTenant(other.id, async () => {
      const w = await prisma.jobWorker.create({ data: { code: `FW${sfx}`, name: "Foreign dyer" } });
      const c = await prisma.deliveryChallan.create({
        data: {
          challanNo: `FDC-${sfx}`,
          challanDate: new Date("2026-09-05T00:00:00Z"),
          kind: "JOB_WORK_OUT",
          jobWorkerId: w.id,
        },
      });
      const p = await prisma.product.create({
        data: { productCode: `FP${sfx}`, productName: "Foreign tee" },
      });
      const r = await prisma.processRoute.create({
        data: { routeCode: `FR-${sfx}`, name: "Foreign route" },
      });
      return {
        companyId: other.id,
        workerId: w.id,
        challanId: c.id,
        productId: p.id.toString(),
        routeId: r.id,
      };
    });
  });

  it("offers job workers, products, step names and the two cluster templates", async () => {
    const res = await (await api()).get(routes("/options")).set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.templates.map((t: { key: string }) => t.key)).toEqual([
      "TIRUPPUR_KNITWEAR",
      "COIMBATORE_CASTING",
    ]);
    expect(res.body.data.stepNames).toContain("DYEING");
    expect(res.body.data.gainTolerancePct).toBe(2);
    const ids = res.body.data.jobWorkers.map((w: { id: string }) => w.id);
    expect(ids).toContain(DYER);
    expect(ids).not.toContain(FOREIGN.workerId);
  });

  it("creates a four-step knit route with ordered steps and upper-cased names and units", async () => {
    const res = await (
      await api()
    )
      .post(routes())
      .set(OWNER.auth)
      .send({ routeCode: `KNIT-${sfx}`, name: "Knit tee route", steps: knitSteps() });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    ROUTE_ID = res.body.data.id;
    expect(res.body.data).toMatchObject({ active: true, lotCount: 0, locked: false });
    expect(res.body.data.steps.map((s: { seq: number; name: string }) => [s.seq, s.name])).toEqual([
      [1, "KNITTING"],
      [2, "DYEING"],
      [3, "COMPACTING"],
      [4, "STITCHING"],
    ]);
    expect(res.body.data.steps[0]).toMatchObject({
      uomIn: "KG",
      defaultJobWorker: { id: KNITTER },
    });
    expect(res.body.data.steps[3]).toMatchObject({
      uomOut: "PCS",
      conversionFactor: 4,
      lossNormPct: 3,
    });
  });

  it("refuses every bad route", async () => {
    const client = await api();
    const bad = (patch: Record<string, unknown>) =>
      client
        .post(routes())
        .set(OWNER.auth)
        .send({ routeCode: `BAD-${sfx}`, name: "Bad", steps: knitSteps(), ...patch });
    const stepPatch = (i: number, p: Record<string, unknown>) => {
      const s = knitSteps();
      s[i] = { ...s[i], ...p } as (typeof s)[number];
      return { steps: s };
    };
    expect((await bad({ routeCode: `KNIT-${sfx}` })).status).toBe(409);
    expect((await bad({ routeCode: "" })).status).toBe(400);
    expect((await bad({ name: "" })).status).toBe(400);
    expect((await bad({ steps: [] })).status).toBe(400);
    expect((await bad(stepPatch(0, { mode: "OUTSOURCED" }))).status).toBe(400);
    expect((await bad(stepPatch(0, { name: "" }))).status).toBe(400);
    expect((await bad(stepPatch(0, { lossNormPct: 100 }))).status).toBe(400);
    expect((await bad(stepPatch(0, { lossNormPct: -1 }))).status).toBe(400);
    expect((await bad(stepPatch(3, { conversionFactor: 0 }))).status).toBe(400);
    const chain = await bad(stepPatch(2, { uomIn: "MTR", uomOut: "MTR" }));
    expect(chain.status).toBe(400);
    expect(chain.body.message).toMatch(/units must chain/);
    const inHouse = await bad(stepPatch(2, { defaultJobWorkerId: DYER }));
    expect(inHouse.status).toBe(400);
    expect(inHouse.body.message).toMatch(/in-house/);
    expect((await bad(stepPatch(1, { conversionFactor: 2 }))).status).toBe(400);
    expect((await bad(stepPatch(1, { defaultJobWorkerId: "nope" }))).status).toBe(400);
    expect((await bad(stepPatch(1, { defaultJobWorkerId: randomUUID() }))).status).toBe(404);
    const foreignW = await bad(stepPatch(1, { defaultJobWorkerId: FOREIGN.workerId }));
    expect(foreignW.status).toBe(404);
    expect(JSON.stringify(foreignW.body)).not.toMatch(/prisma|stack|at .*\.ts/i);
    expect((await bad({ productId: FOREIGN.productId })).status).toBe(404);
    expect((await bad({ productId: "abc" })).status).toBe(400);
    const prisma = await getPrisma();
    const idle = await asDemoTenant(() =>
      prisma.jobWorker.create({ data: { code: `IW${sfx}`, name: "Closed unit", isActive: false } })
    );
    expect((await bad(stepPatch(1, { defaultJobWorkerId: idle.id }))).status).toBe(400);
  });

  it("creates a lot of 1000 KG on the route; the input unit is the first step's", async () => {
    const res = await (
      await api()
    )
      .post(lots())
      .set(STORES.auth)
      .send({ lotNo: `LOT-${sfx}`, routeId: ROUTE_ID, inputQty: 1000, startDate: "2026-09-01" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    LOT_ID = res.body.data.id;
    expect(res.body.data).toMatchObject({ status: "OPEN", inputUom: "KG", currentStepSeq: 1 });
    expect(res.body.data.locations).toEqual([
      expect.objectContaining({ kind: "IN_HAND", stepName: "KNITTING", qty: 1000, uom: "KG" }),
    ]);
  });

  it("refuses every bad lot", async () => {
    const client = await api();
    const bad = (patch: Record<string, unknown>) =>
      client
        .post(lots())
        .set(OWNER.auth)
        .send({
          lotNo: `BADLOT-${sfx}`,
          routeId: ROUTE_ID,
          inputQty: 10,
          startDate: "2026-09-01",
          ...patch,
        });
    expect((await bad({ lotNo: `LOT-${sfx}` })).status).toBe(409);
    expect((await bad({ lotNo: "" })).status).toBe(400);
    expect((await bad({ inputQty: 0 })).status).toBe(400);
    expect((await bad({ inputQty: "ten" })).status).toBe(400);
    expect((await bad({ startDate: "01/09/2026" })).status).toBe(400);
    expect((await bad({ routeId: "x" })).status).toBe(400);
    const uom = await bad({ inputUom: "PCS" });
    expect(uom.status).toBe(400);
    expect(uom.body.message).toMatch(/in KG/);
    expect((await bad({ routeId: randomUUID() })).status).toBe(404);
    expect((await bad({ routeId: FOREIGN.routeId })).status).toBe(404);
    expect((await bad({ productId: FOREIGN.productId })).status).toBe(404);

    // A route for product A takes no lot of product B; an inactive route takes no lot at all.
    const r = await client
      .post(routes())
      .set(OWNER.auth)
      .send({
        routeCode: `PA-${sfx}`,
        name: "Product A route",
        productId: PRODUCT_A,
        steps: knitSteps().slice(2),
      });
    expect(r.status).toBe(201);
    expect((await bad({ routeId: r.body.data.id, productId: PRODUCT_B })).status).toBe(400);
    const off = await client
      .patch(routes(`/${r.body.data.id}`))
      .set(OWNER.auth)
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.active).toBe(false);
    expect((await bad({ routeId: r.body.data.id })).status).toBe(409);
    // Never used, so it can still be deleted.
    expect((await client.delete(routes(`/${r.body.data.id}`)).set(OWNER.auth)).status).toBe(200);
  });

  it("sends the lot to the knitter (default job worker) and refuses what breaks the flow", async () => {
    const early = await move(LOT_ID, {
      stepSeq: 2,
      direction: "OUT",
      qty: 10,
      movementDate: "2026-09-02",
      jobWorkerId: DYER,
    });
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/steps run in order/);
    expect(
      (await move(LOT_ID, { stepSeq: 1, direction: "IN", qty: 10, movementDate: "2026-09-02" }))
        .status
    ).toBe(400);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 1,
          direction: "OUT",
          qty: 1000.5,
          movementDate: "2026-09-01",
        })
      ).status
    ).toBe(400);
    expect(
      (await move(LOT_ID, { stepSeq: 1, direction: "OUT", qty: 10, movementDate: "2026-08-31" }))
        .status
    ).toBe(400);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 1,
          direction: "OUT",
          qty: 10,
          uom: "PCS",
          movementDate: "2026-09-01",
        })
      ).status
    ).toBe(400);
    expect(
      (await move(LOT_ID, { stepSeq: 9, direction: "OUT", qty: 10, movementDate: "2026-09-01" }))
        .status
    ).toBe(400);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 1,
          direction: "SIDEWAYS",
          qty: 10,
          movementDate: "2026-09-01",
        })
      ).status
    ).toBe(400);
    expect(
      (await move(LOT_ID, { stepSeq: 1, direction: "OUT", qty: -5, movementDate: "2026-09-01" }))
        .status
    ).toBe(400);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 1,
          direction: "OUT",
          qty: 10,
          movementDate: "2026-09-01",
          jobWorkerId: FOREIGN.workerId,
        })
      ).status
    ).toBe(404);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 1,
          direction: "OUT",
          qty: 10,
          movementDate: "2026-09-01",
          jobWorkerId: randomUUID(),
        })
      ).status
    ).toBe(404);

    const res = await move(
      LOT_ID,
      { stepSeq: 1, direction: "OUT", qty: 1000, movementDate: "2026-09-01" },
      STORES
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.movements[0]).toMatchObject({ uom: "KG", jobWorker: { id: KNITTER } });
    expect(res.body.data.locations).toEqual([
      expect.objectContaining({
        kind: "JOB_WORKER",
        jobWorkerId: KNITTER,
        jobWorkerName: "Sri Balaji Knitting",
        qty: 1000,
      }),
    ]);

    const over = await move(LOT_ID, {
      stepSeq: 1,
      direction: "IN",
      qty: 1020.5,
      movementDate: "2026-09-04",
    });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/more than was sent/);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 1,
          direction: "IN",
          qty: 10,
          movementDate: "2026-09-04",
          jobWorkerId: DYER,
        })
      ).status
    ).toBe(400);
    const back = await move(LOT_ID, {
      stepSeq: 1,
      direction: "IN",
      qty: 985,
      movementDate: "2026-09-04",
      closesStep: true,
    });
    expect(back.status).toBe(201);
    expect(back.body.data.steps[0]).toMatchObject({ state: "DONE", lossPct: 1.5, overNorm: false });
    expect(back.body.data.currentStepSeq).toBe(2);
    expect(
      (await move(LOT_ID, { stepSeq: 1, direction: "IN", qty: 1, movementDate: "2026-09-04" }))
        .status
    ).toBe(409);
  });

  it("carries dyeing on a job-work challan and its return challan, leaving the challan flow intact", async () => {
    const client = await api();
    const out = await client
      .post("/api/job-work/challans")
      .set(OWNER.auth)
      .send({
        kind: "JOB_WORK_OUT",
        challanDate: "2026-09-05",
        jobWorkerId: DYER,
        purpose: "Dyeing",
        items: [
          {
            itemType: "RAW_MATERIAL",
            rawMaterialId: RM_CODE,
            description: "Grey fabric",
            uom: "KG",
            quantity: 985,
            rate: 100,
          },
        ],
      });
    expect(out.status, JSON.stringify(out.body).slice(0, 300)).toBe(201);
    OUT_CHALLAN = { id: out.body.data.id, itemId: out.body.data.items[0].id };

    // Challan rules: in-house step, wrong kind, foreign, cancelled, other worker, wrong date.
    const inHouse = await move(LOT_ID, {
      stepSeq: 3,
      direction: "OUT",
      qty: 1,
      movementDate: "2026-09-05",
      challanId: OUT_CHALLAN.id,
    });
    expect(inHouse.status).toBe(400);
    const retKind = await rawChallan({ kind: "JOB_WORK_RETURN" });
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 2,
          direction: "OUT",
          qty: 1,
          movementDate: "2026-09-05",
          challanId: retKind.id,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 2,
          direction: "OUT",
          qty: 1,
          movementDate: "2026-09-05",
          challanId: FOREIGN.challanId,
        })
      ).status
    ).toBe(404);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 2,
          direction: "OUT",
          qty: 1,
          movementDate: "2026-09-05",
          challanId: randomUUID(),
        })
      ).status
    ).toBe(404);
    const cancelled = await rawChallan({ status: "CANCELLED" });
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 2,
          direction: "OUT",
          qty: 1,
          movementDate: "2026-09-05",
          challanId: cancelled.id,
        })
      ).status
    ).toBe(409);
    const otherWorker = await rawChallan({ jobWorkerId: OTHER_WORKER });
    const ow = await move(LOT_ID, {
      stepSeq: 2,
      direction: "OUT",
      qty: 1,
      movementDate: "2026-09-05",
      challanId: otherWorker.id,
      jobWorkerId: DYER,
    });
    expect(ow.status).toBe(400);
    expect(ow.body.message).toMatch(/different job worker/);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 2,
          direction: "OUT",
          qty: 1,
          movementDate: "2026-09-06",
          challanId: OUT_CHALLAN.id,
        })
      ).status
    ).toBe(400);
    const small = await rawChallan();
    const tooMuch = await move(LOT_ID, {
      stepSeq: 2,
      direction: "OUT",
      qty: 60,
      movementDate: "2026-09-05",
      challanId: small.id,
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message).toMatch(/carries 50 KG/);
    const early = await move(LOT_ID, {
      stepSeq: 2,
      direction: "OUT",
      qty: 1,
      movementDate: "2026-09-03",
      jobWorkerId: DYER,
    });
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/before it came back/);

    // The job worker comes from the challan.
    const sent = await move(LOT_ID, {
      stepSeq: 2,
      direction: "OUT",
      qty: 985,
      movementDate: "2026-09-05",
      challanId: OUT_CHALLAN.id,
    });
    expect(sent.status, JSON.stringify(sent.body).slice(0, 300)).toBe(201);
    const m = sent.body.data.movements.at(-1);
    expect(m).toMatchObject({
      jobWorker: { id: DYER },
      challan: { id: OUT_CHALLAN.id, kind: "JOB_WORK_OUT" },
    });

    const board = await client.get(lots("/board")).set(OWNER.auth);
    expect(board.status).toBe(200);
    const atDyer = board.body.data.summary.atJobWorkers.find(
      (w: { jobWorkerId: string }) => w.jobWorkerId === DYER
    );
    expect(atDyer).toMatchObject({
      name: "Tiruppur Dyeing Works",
      lots: 1,
      qty: [{ uom: "KG", qty: 985 }],
    });
    expect(board.body.data.lots.map((l: { id: string }) => l.id)).toContain(LOT_ID);

    // The P2-08 return challan posts onto its parent exactly as before; the lot links to it.
    const ret = await client
      .post("/api/job-work/challans")
      .set(OWNER.auth)
      .send({
        kind: "JOB_WORK_RETURN",
        challanDate: "2026-09-10",
        jobWorkerId: DYER,
        parentChallanId: OUT_CHALLAN.id,
        items: [
          {
            itemType: "RAW_MATERIAL",
            rawMaterialId: RM_CODE,
            uom: "KG",
            quantity: 896.35,
            parentItemId: OUT_CHALLAN.itemId,
            scrap: 88.65,
          },
        ],
      });
    expect(ret.status, JSON.stringify(ret.body).slice(0, 300)).toBe(201);
    RETURN_CHALLAN = ret.body.data.id;
    const parent = await client.get(`/api/job-work/challans/${OUT_CHALLAN.id}`).set(OWNER.auth);
    expect(Number(parent.body.data.items[0].quantityReturned)).toBe(896.35);
    expect(parent.body.data.status).toBe("CLOSED");

    const back = await move(LOT_ID, {
      stepSeq: 2,
      direction: "IN",
      qty: 896.35,
      movementDate: "2026-09-10",
      challanId: RETURN_CHALLAN,
      closesStep: true,
    });
    expect(back.status, JSON.stringify(back.body).slice(0, 300)).toBe(201);
    expect(back.body.data.steps[1]).toMatchObject({ state: "DONE", lossPct: 9, overNorm: true });
    expect(back.body.data.overNormSteps).toBe(1);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 2,
          direction: "OUT",
          qty: 1,
          movementDate: "2026-09-10",
          challanId: OUT_CHALLAN.id,
        })
      ).status
    ).toBe(409);
  });

  it("runs compacting and stitching in-house, converts KG to PCS, then closes the lot", async () => {
    const client = await api();
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 3,
          direction: "OUT",
          qty: 1,
          movementDate: "2026-09-11",
          jobWorkerId: DYER,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 3,
          direction: "OUT",
          qty: 896.35,
          movementDate: "2026-09-11",
        })
      ).status
    ).toBe(201);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 3,
          direction: "IN",
          qty: 887.386,
          movementDate: "2026-09-12",
          closesStep: true,
        })
      ).status
    ).toBe(201);
    expect(
      (
        await move(LOT_ID, {
          stepSeq: 4,
          direction: "OUT",
          qty: 887.386,
          movementDate: "2026-09-13",
        })
      ).status
    ).toBe(201);

    const notYet = await client.post(lots(`/${LOT_ID}/close`)).set(OWNER.auth);
    expect(notYet.status).toBe(409);
    expect(notYet.body.message).toMatch(/STITCHING\) is still in process/);

    expect(
      (await move(LOT_ID, { stepSeq: 4, direction: "IN", qty: 3700, movementDate: "2026-09-20" }))
        .status
    ).toBe(400);
    const done = await move(LOT_ID, {
      stepSeq: 4,
      direction: "IN",
      qty: 3443,
      uom: "pcs",
      movementDate: "2026-09-20",
      closesStep: true,
    });
    expect(done.status).toBe(201);
    expect(done.body.data.steps[3]).toMatchObject({
      uomOut: "PCS",
      expectedOut: 3549.544,
      received: 3443,
      lossPct: 3,
      overNorm: false,
    });
    expect(done.body.data).toMatchObject({
      finalOutput: 3443,
      finalUom: "PCS",
      cumulativeYieldPct: 86.08,
      currentStepSeq: 5,
    });

    const closed = await client.post(lots(`/${LOT_ID}/close`)).set(OWNER.auth);
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("COMPLETED");
    expect((await client.post(lots(`/${LOT_ID}/close`)).set(OWNER.auth)).status).toBe(409);
    expect(
      (await move(LOT_ID, { stepSeq: 4, direction: "IN", qty: 1, movementDate: "2026-09-21" }))
        .status
    ).toBe(409);

    const list = await client.get(lots("?status=COMPLETED")).set(OWNER.auth);
    expect(list.body.data.map((l: { id: string }) => l.id)).toContain(LOT_ID);
    const detail = await client.get(lots(`/${LOT_ID}`)).set(OWNER.auth);
    expect(detail.body.data.movements).toHaveLength(8);
    expect(detail.body.data.movements.filter((m: { challan: unknown }) => m.challan)).toHaveLength(
      2
    );
  });

  it("fixes a used route: no step rewrite, no delete (deactivate instead)", async () => {
    const client = await api();
    const steps = await client
      .put(routes(`/${ROUTE_ID}/steps`))
      .set(OWNER.auth)
      .send({ steps: knitSteps() });
    expect(steps.status).toBe(409);
    const del = await client.delete(routes(`/${ROUTE_ID}`)).set(OWNER.auth);
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/deactivate/);
    const got = await client.get(routes(`/${ROUTE_ID}`)).set(OWNER.auth);
    expect(got.body.data).toMatchObject({ lotCount: 1, locked: true });
    expect(
      (
        await client
          .patch(routes(`/${ROUTE_ID}`))
          .set(OWNER.auth)
          .send({})
      ).status
    ).toBe(400);
  });

  it("rewrites the steps of an unused route, and refuses a bad rewrite", async () => {
    const client = await api();
    const r = await client
      .post(routes())
      .set(OWNER.auth)
      .send({ routeCode: `CAST-${sfx}`, name: "Casting route", steps: knitSteps().slice(2) });
    const id = r.body.data.id;
    const ok = await client
      .put(routes(`/${id}/steps`))
      .set(OWNER.auth)
      .send({
        steps: [
          {
            name: "CASTING",
            mode: "JOB_WORK",
            uomIn: "KG",
            uomOut: "PCS",
            conversionFactor: 0.4,
            defaultJobWorkerId: OTHER_WORKER,
          },
          { name: "MACHINING", mode: "JOB_WORK", uomIn: "PCS", uomOut: "PCS", lossNormPct: 2 },
        ],
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data.steps.map((s: { name: string }) => s.name)).toEqual([
      "CASTING",
      "MACHINING",
    ]);
    const broken = await client
      .put(routes(`/${id}/steps`))
      .set(OWNER.auth)
      .send({
        steps: [
          { name: "A", mode: "JOB_WORK", uomIn: "KG", uomOut: "PCS" },
          { name: "B", mode: "IN_HOUSE", uomIn: "KG", uomOut: "KG" },
        ],
      });
    expect(broken.status).toBe(400);
    expect(
      (
        await client
          .put(routes(`/${id}/steps`))
          .set(OWNER.auth)
          .send({ steps: [] })
      ).status
    ).toBe(400);
  });

  it("takes back only the latest movement, and cancels a lot with a reason", async () => {
    const client = await api();
    const lot = await client
      .post(lots())
      .set(OWNER.auth)
      .send({ lotNo: `LOT2-${sfx}`, routeId: ROUTE_ID, inputQty: 200, startDate: "2026-09-15" });
    const id = lot.body.data.id;
    await move(id, { stepSeq: 1, direction: "OUT", qty: 100, movementDate: "2026-09-15" });
    const second = await move(id, {
      stepSeq: 1,
      direction: "OUT",
      qty: 50,
      movementDate: "2026-09-16",
      jobWorkerId: OTHER_WORKER,
    });
    const [first, latest] = second.body.data.movements;
    expect(first.undoable).toBe(false);
    expect(latest.undoable).toBe(true);
    // Two knitters hold it now, so a return must say which.
    const which = await move(id, {
      stepSeq: 1,
      direction: "IN",
      qty: 10,
      movementDate: "2026-09-17",
    });
    expect(which.status).toBe(400);
    expect(which.body.message).toMatch(/which job worker/);
    expect((await client.delete(lots(`/${id}/movements/${first.id}`)).set(OWNER.auth)).status).toBe(
      409
    );
    expect(
      (await client.delete(lots(`/${id}/movements/${randomUUID()}`)).set(OWNER.auth)).status
    ).toBe(404);
    const undo = await client.delete(lots(`/${id}/movements/${latest.id}`)).set(OWNER.auth);
    expect(undo.status).toBe(200);
    expect(undo.body.data.movements).toHaveLength(1);

    expect(
      (
        await client
          .post(lots(`/${id}/cancel`))
          .set(OWNER.auth)
          .send({ reason: "x" })
      ).status
    ).toBe(400);
    const cancel = await client
      .post(lots(`/${id}/cancel`))
      .set(OWNER.auth)
      .send({ reason: "Buyer cancelled the order" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data).toMatchObject({
      status: "CANCELLED",
      cancelReason: "Buyer cancelled the order",
      locations: [],
    });
    expect(
      (await move(id, { stepSeq: 1, direction: "IN", qty: 10, movementDate: "2026-09-17" })).status
    ).toBe(409);
    expect(
      (
        await client
          .post(lots(`/${id}/cancel`))
          .set(OWNER.auth)
          .send({ reason: "again" })
      ).status
    ).toBe(409);
    expect((await client.get(lots(`/${randomUUID()}`)).set(OWNER.auth)).status).toBe(404);
    expect((await client.get(lots("/not-a-uuid")).set(OWNER.auth)).status).toBe(400);
  });

  it("lists challans for the picker without the job-work permission, only this tenant's", async () => {
    const res = await (
      await api()
    )
      .get(lots(`/challan-options?jobWorkerId=${DYER}`))
      .set(STORES.auth);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(OUT_CHALLAN.id);
    expect(ids).toContain(RETURN_CHALLAN);
    expect(ids).not.toContain(FOREIGN.challanId);
  });

  it("refuses roles without process-routes permissions", async () => {
    const client = await api();
    expect((await client.get(routes()).set(ACCOUNTS.auth)).status).toBe(403);
    expect((await client.get(lots("/board")).set(ACCOUNTS.auth)).status).toBe(403);
    expect((await client.post(lots()).set(ACCOUNTS.auth).send({})).status).toBe(403);
    expect(
      (
        await move(
          LOT_ID,
          { stepSeq: 1, direction: "OUT", qty: 1, movementDate: "2026-09-01" },
          ACCOUNTS
        )
      ).status
    ).toBe(403);
    // Stores records movements but deletes nothing.
    expect((await client.delete(routes(`/${ROUTE_ID}`)).set(STORES.auth)).status).toBe(403);
    expect(
      (await client.delete(lots(`/${LOT_ID}/movements/${randomUUID()}`)).set(STORES.auth)).status
    ).toBe(403);
  });

  it("a foreign company sees none of these routes, lots or movements", async () => {
    const prisma = await getPrisma();
    const other = FOREIGN.companyId;
    expect(await runAsTenant(other, () => prisma.processRoute.count())).toBe(1); // its own
    expect(await runAsTenant(other, () => prisma.processRouteStep.count())).toBe(0);
    expect(await runAsTenant(other, () => prisma.lotRouteProgress.count())).toBe(0);
    expect(await runAsTenant(other, () => prisma.lotStepMovement.count())).toBe(0);
    expect(
      await runAsTenant(other, () => prisma.lotRouteProgress.findFirst({ where: { id: LOT_ID } }))
    ).toBeNull();
    expect(await asDemoTenant(() => prisma.lotStepMovement.count())).toBeGreaterThan(0);
    const list = await (await api()).get(routes()).set(OWNER.auth);
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(FOREIGN.routeId);
    expect((await (await api()).get(routes(`/${FOREIGN.routeId}`)).set(OWNER.auth)).status).toBe(
      404
    );
  });
});
