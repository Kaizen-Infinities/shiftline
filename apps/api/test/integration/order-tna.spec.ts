import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { addDays, asDate, iso } from "../../src/modules/order-tna/order-tna.calc";

/**
 * Export order time-and-action calendar (TN-03): template generation, the ex-factory
 * reschedule, milestone completion, RAG, alerts, validation, permissions and tenancy.
 */
const sfx = Date.now().toString(36).slice(-5);
const today = asDate(new Date());
const day = (n: number) => iso(addDays(today, n));

let OWNER: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };
let CUSTOMER_ID: string;
let TNA_ID: string;

const base = () => ({
  customerId: CUSTOMER_ID,
  buyerPoNo: `PO-${sfx}`,
  styleRef: "KT-100",
  orderQty: 1200,
  uom: "PCS",
  orderDate: day(-90),
  exFactoryDate: day(30),
  template: "GENERIC",
});

describe("order T&A (TN-03)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    PRODUCTION = await authed("demo.production");
    ACCOUNTS = await authed("demo.accounts");
    CUSTOMER_ID = (await createCustomer()).id;
  });

  it("lists the four templates", async () => {
    const res = await (await api()).get("/api/order-tna/templates").set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { key: string }) => t.key).sort()).toEqual([
      "GARMENT_KNIT",
      "GENERIC",
      "HOME_TEXTILE",
      "LEATHER_FOOTWEAR",
    ]);
  });

  it("creates a plan with milestones counted back from ex-factory", async () => {
    const res = await (
      await api()
    )
      .post("/api/order-tna")
      .set(PRODUCTION.auth)
      .send({ ...base(), tnaNo: `TNA-${sfx}` });
    expect(res.status).toBe(201);
    TNA_ID = res.body.data.id;
    expect(res.body.data.tnaNo).toBe(`TNA-${sfx}`);
    expect(res.body.data.milestones.map((m: { plannedDate: string }) => m.plannedDate)).toEqual([
      day(0),
      day(10),
      day(25),
      day(28),
      day(30),
    ]);
    // "Material in" is due today, so the order is amber.
    expect(res.body.data.rag).toBe("AMBER");
  });

  it("defaults the T&A number to <buyerPoNo>-<styleRef> and refuses a duplicate", async () => {
    const client = await api();
    const res = await client
      .post("/api/order-tna")
      .set(OWNER.auth)
      .send({ ...base(), buyerPoNo: `P2-${sfx}`, exFactoryDate: day(200) });
    expect(res.status).toBe(201);
    expect(res.body.data.tnaNo).toBe(`P2-${sfx}-KT-100`);
    expect(res.body.data.rag).toBe("GREEN");
    const dup = await client
      .post("/api/order-tna")
      .set(OWNER.auth)
      .send({ ...base(), buyerPoNo: `P2-${sfx}`, exFactoryDate: day(200) });
    expect(dup.status).toBe(409);
  });

  it("marks a milestone done with its actual date and reports the delay", async () => {
    const client = await api();
    const plan = (await client.get(`/api/order-tna/${TNA_ID}`).set(OWNER.auth)).body.data;
    const first = plan.milestones[0];
    const noDate = await client
      .patch(`/api/order-tna/${TNA_ID}/milestones/${first.id}`)
      .set(OWNER.auth)
      .send({ status: "DONE" });
    expect(noDate.status).toBe(400);
    const res = await client
      .patch(`/api/order-tna/${TNA_ID}/milestones/${first.id}`)
      .set(OWNER.auth)
      .send({ status: "DONE", actualDate: day(2), owner: "Ravi" });
    expect(res.status).toBe(200);
    const done = res.body.data.milestones[0];
    expect(done.status).toBe("DONE");
    expect(done.delayDays).toBe(2);
    expect(res.body.data.rag).toBe("GREEN");
  });

  it("moves only the open milestones when ex-factory is rescheduled", async () => {
    const res = await (
      await api()
    )
      .patch(`/api/order-tna/${TNA_ID}`)
      .set(OWNER.auth)
      .send({ exFactoryDate: day(37) });
    expect(res.status).toBe(200);
    expect(res.body.data.exFactoryDate).toBe(day(37));
    expect(res.body.data.milestones.map((m: { plannedDate: string }) => m.plannedDate)).toEqual([
      day(0), // DONE: unchanged
      day(17),
      day(32),
      day(35),
      day(37),
    ]);
  });

  it("adds a custom milestone at max seq + 1 and surfaces it in alerts when overdue", async () => {
    const client = await api();
    const res = await client
      .post(`/api/order-tna/${TNA_ID}/milestones`)
      .set(OWNER.auth)
      .send({ name: "Buyer QA visit", plannedDate: day(-2) });
    expect(res.status).toBe(201);
    const added = res.body.data.milestones.at(-1);
    expect(added.seq).toBe(6);
    expect(res.body.data.rag).toBe("RED");
    expect(res.body.data.overdueCount).toBe(1);

    const alerts = await client.get("/api/order-tna/alerts?days=3").set(OWNER.auth);
    expect(alerts.status).toBe(200);
    const mine = alerts.body.data.filter((a: { tnaId: string }) => a.tnaId === TNA_ID);
    expect(mine).toEqual([
      expect.objectContaining({ milestone: "Buyer QA visit", kind: "OVERDUE", daysLate: 2 }),
    ]);

    const list = await client.get(`/api/order-tna?customerId=${CUSTOMER_ID}`).set(OWNER.auth);
    const row = list.body.data.find((r: { id: string }) => r.id === TNA_ID);
    expect(row).toMatchObject({ rag: "RED", overdueCount: 1 });
    expect(row.nextMilestone.name).toBe("Buyer QA visit");
  });

  it("cancelling drops the plan out of alerts (no DELETE exists)", async () => {
    const client = await api();
    const res = await client
      .patch(`/api/order-tna/${TNA_ID}`)
      .set(OWNER.auth)
      .send({ status: "CANCELLED" });
    expect(res.status).toBe(200);
    const alerts = await client.get("/api/order-tna/alerts").set(OWNER.auth);
    expect(alerts.body.data.some((a: { tnaId: string }) => a.tnaId === TNA_ID)).toBe(false);
    const del = await client.delete(`/api/order-tna/${TNA_ID}`).set(OWNER.auth);
    expect(del.status).toBe(404);
  });

  it("rejects every invalid create", async () => {
    const client = await api();
    const bad = async (patch: Record<string, unknown>) =>
      client
        .post("/api/order-tna")
        .set(OWNER.auth)
        .send({ ...base(), buyerPoNo: `BAD-${sfx}`, ...patch });
    expect((await bad({ exFactoryDate: day(-100) })).status).toBe(400); // before order date
    expect((await bad({ orderQty: 0 })).status).toBe(400);
    expect((await bad({ orderQty: -5 })).status).toBe(400);
    expect((await bad({ template: "SPACESHIP" })).status).toBe(400);
    expect((await bad({ buyerPoNo: "" })).status).toBe(400);
    expect((await bad({ styleRef: "" })).status).toBe(400);
    expect((await bad({ orderDate: "25/09/2026" })).status).toBe(400);
    expect((await bad({ customerId: "not-a-uuid" })).status).toBe(400);
    const unknownBuyer = await bad({ customerId: randomUUID() });
    expect(unknownBuyer.status).toBe(404);
    const unknownSo = await bad({ salesOrderId: 2_000_000_000 });
    expect(unknownSo.status).toBe(404);
    // No raw error text leaks out.
    expect(JSON.stringify(unknownSo.body)).not.toMatch(/prisma|stack|at .*\.ts/i);
  });

  it("rejects invalid updates", async () => {
    const client = await api();
    expect(
      (
        await client
          .patch(`/api/order-tna/${TNA_ID}`)
          .set(OWNER.auth)
          .send({ exFactoryDate: day(-200) })
      ).status
    ).toBe(400);
    expect((await client.patch(`/api/order-tna/${TNA_ID}`).set(OWNER.auth).send({})).status).toBe(
      400
    );
    expect(
      (await client.patch(`/api/order-tna/${TNA_ID}`).set(OWNER.auth).send({ orderQty: 0 })).status
    ).toBe(400);
    expect(
      (await client.post(`/api/order-tna/${TNA_ID}/milestones`).set(OWNER.auth).send({ name: "" }))
        .status
    ).toBe(400);
    expect(
      (
        await client
          .patch(`/api/order-tna/${TNA_ID}/milestones/${randomUUID()}`)
          .set(OWNER.auth)
          .send({ owner: "x" })
      ).status
    ).toBe(404);
    expect((await client.get("/api/order-tna/not-a-uuid").set(OWNER.auth)).status).toBe(400);
  });

  it("refuses a role without order-tna permissions", async () => {
    const client = await api();
    expect((await client.get("/api/order-tna").set(ACCOUNTS.auth)).status).toBe(403);
    expect((await client.post("/api/order-tna").set(ACCOUNTS.auth).send(base())).status).toBe(403);
  });

  it("a foreign company sees none of these plans", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "TNA Tenant B", companyCode: `TNB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.orderTna.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.orderTnaMilestone.count())).toBe(0);
    expect(
      await runAsTenant(other.id, () => prisma.orderTna.findFirst({ where: { id: TNA_ID } }))
    ).toBeNull();
    expect(await asDemoTenant(() => prisma.orderTna.count())).toBeGreaterThan(0);
  });
});
