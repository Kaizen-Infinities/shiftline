import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * OEM delivery schedules and schedule adherence (TN-02). Schedule month 2037-03, later than any
 * other suite's dates, and every `asOf` is passed explicitly so the results do not depend on the
 * clock.
 */
const sfx = Date.now().toString(36).slice(-5);
const BASE = "/api/delivery-schedules";

let OWNER: { auth: Record<string, string> };
let STORES: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };
let CUSTOMER_ID: string;
let SCHEDULE_ID: string;

const header = (over: Record<string, unknown> = {}) => ({
  scheduleNo: `SCH-${sfx}`,
  customerId: CUSTOMER_ID,
  customerPoNo: "SA-4500012345",
  periodMonth: "2037-03",
  receivedOn: "2037-02-25",
  lines: [
    { customerPartNo: "BRKT-101", dueDate: "2037-03-05", scheduledQty: 100 },
    { customerPartNo: "BRKT-102", dueDate: "2037-03-10", scheduledQty: 200 },
    { customerPartNo: "BRKT-103", dueDate: "2037-03-12", scheduledQty: 50 },
    { customerPartNo: "BRKT-104", dueDate: "2037-03-28", scheduledQty: 80, firmness: "TENTATIVE" },
  ],
  ...over,
});

describe("delivery schedules (TN-02)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    STORES = await authed("demo.stores");
    PRODUCTION = await authed("demo.production");
    const customer = await createCustomer({ firmName: `OEM Test ${sfx}` });
    CUSTOMER_ID = customer.id;
  });

  it("creates a schedule with lines, books dispatches and computes adherence and OTIF", async () => {
    const client = await api();
    const created = await client.post(BASE).set(OWNER.auth).send(header());
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    SCHEDULE_ID = created.body.data.id;
    const lines = created.body.data.lines as { id: string; customerPartNo: string }[];
    expect(lines).toHaveLength(4);
    const byPart = Object.fromEntries(lines.map((l) => [l.customerPartNo, l.id]));

    // 101: on time in full → MET. 102: all of it, part late → LATE. 103: nothing → SHORT.
    const book = (lineId: string, dispatchDate: string, qty: number) =>
      client
        .post(`${BASE}/lines/${lineId}/dispatches`)
        .set(STORES.auth)
        .send({ dispatchDate, qty, asnNo: `ASN-${qty}` });
    expect((await book(byPart["BRKT-101"], "2037-03-04", 100)).status).toBe(201);
    expect((await book(byPart["BRKT-102"], "2037-03-09", 150)).status).toBe(201);
    expect((await book(byPart["BRKT-102"], "2037-03-14", 50)).status).toBe(201);

    const detail = await client.get(`${BASE}/${SCHEDULE_ID}`).set(OWNER.auth);
    expect(detail.status).toBe(200);
    const status = Object.fromEntries(
      (detail.body.data.lines as { customerPartNo: string; metrics: { status: string } }[]).map(
        (l) => [l.customerPartNo, l.metrics.status]
      )
    );
    expect(status["BRKT-101"]).toBe("MET");
    expect(status["BRKT-102"]).toBe("LATE");

    const report = await client
      .get(`${BASE}/adherence`)
      .query({ from: "2037-03", to: "2037-03", customerId: CUSTOMER_ID, asOf: "2037-03-31" })
      .set(OWNER.auth);
    expect(report.status).toBe(200);
    expect(report.body.data).toHaveLength(1);
    const row = report.body.data[0];
    // FIRM only: (100 + 150 + 0) / (100 + 200 + 50) = 71.4%; MET 1 of 3 due → 33.3%.
    expect(row.scheduled).toBe(350);
    expect(row.adherencePct).toBe(71.4);
    expect(row.otifPct).toBe(33.3);
    expect(row.short).toBe(50);
    expect(row.late).toBe(50);

    const list = await client.get(BASE).query({ customerId: CUSTOMER_ID }).set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((s: { id: string }) => s.id)).toContain(SCHEDULE_ID);
  });

  it("lists open FIRM lines due within N days with their remaining quantity", async () => {
    const res = await (
      await api()
    )
      .get(`${BASE}/due`)
      .query({ days: 7, asOf: "2037-03-08" })
      .set(STORES.auth);
    expect(res.status).toBe(200);
    const mine = (
      res.body.data as { customerPartNo: string; remainingQty: number; customerId: string }[]
    ).filter((r) => r.customerId === CUSTOMER_ID);
    const parts = mine.map((r) => r.customerPartNo).sort();
    // 101 and 102 are fully dispatched (102 partly late); 104 is TENTATIVE; 103 is still owed.
    expect(parts).toEqual(["BRKT-103"]);
    expect(mine.find((r) => r.customerPartNo === "BRKT-103")!.remainingQty).toBe(50);
  });

  it("adds lines in bulk, edits a line and refuses to delete a line with dispatches", async () => {
    const client = await api();
    const added = await client
      .post(`${BASE}/${SCHEDULE_ID}/lines`)
      .set(OWNER.auth)
      .send({ lines: [{ customerPartNo: "BRKT-105", dueDate: "2037-04-02", scheduledQty: 10 }] });
    expect(added.status).toBe(201);
    const lines = added.body.data.lines as {
      id: string;
      customerPartNo: string;
      dispatches: unknown[];
    }[];
    const newLine = lines.find((l) => l.customerPartNo === "BRKT-105")!;
    const patched = await client
      .patch(`${BASE}/lines/${newLine.id}`)
      .set(OWNER.auth)
      .send({ scheduledQty: 12 });
    expect(patched.status).toBe(200);
    expect((await client.delete(`${BASE}/lines/${newLine.id}`).set(OWNER.auth)).status).toBe(200);

    const withDispatch = lines.find((l) => l.customerPartNo === "BRKT-101")!;
    const refused = await client.delete(`${BASE}/lines/${withDispatch.id}`).set(OWNER.auth);
    expect(refused.status).toBe(409);
  });

  it("revises the header and refuses a duplicate schedule number and revision", async () => {
    const client = await api();
    const dup = await client
      .post(BASE)
      .set(OWNER.auth)
      .send(header({ lines: [] }));
    expect(dup.status).toBe(409);
    const revised = await client
      .patch(`${BASE}/${SCHEDULE_ID}`)
      .set(OWNER.auth)
      .send({ customerPoNo: "SA-4500099999" });
    expect(revised.status).toBe(200);
    expect(revised.body.data.customerPoNo).toBe("SA-4500099999");
  });

  it("rejects each invalid input with a 400", async () => {
    const client = await api();
    const bad = async (body: Record<string, unknown>) =>
      (await client.post(BASE).set(OWNER.auth).send(body)).status;
    const line = (over: Record<string, unknown>) =>
      header({
        scheduleNo: `BAD-${sfx}`,
        lines: [{ customerPartNo: "P-1", dueDate: "2037-03-10", scheduledQty: 5, ...over }],
      });
    expect(await bad(line({ scheduledQty: 0 }))).toBe(400);
    expect(await bad(line({ scheduledQty: -3 }))).toBe(400);
    expect(await bad(line({ customerPartNo: "" }))).toBe(400);
    expect(await bad(line({ customerPartNo: "X".repeat(41) }))).toBe(400);
    expect(await bad(line({ dueDate: "2037-05-20" }))).toBe(400); // beyond month + 45 days
    expect(await bad(line({ dueDate: "10/03/2037" }))).toBe(400);
    expect(await bad(header({ periodMonth: "2037-13" }))).toBe(400);
    expect(await bad(header({ customerId: "not-a-uuid" }))).toBe(400);
    expect(await bad(header({ scheduleNo: "" }))).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      customerPartNo: `P-${i}`,
      dueDate: "2037-03-10",
      scheduledQty: 1,
    }));
    expect(await bad(header({ scheduleNo: `BIG-${sfx}`, lines: tooMany }))).toBe(400);

    const detail = await client.get(`${BASE}/${SCHEDULE_ID}`).set(OWNER.auth);
    const lineId = detail.body.data.lines[0].id as string;
    const zeroDispatch = await client
      .post(`${BASE}/lines/${lineId}/dispatches`)
      .set(OWNER.auth)
      .send({ dispatchDate: "2037-03-10", qty: 0 });
    expect(zeroDispatch.status).toBe(400);
    const badAdherence = await client
      .get(`${BASE}/adherence`)
      .query({ from: "2037-04", to: "2037-03" })
      .set(OWNER.auth);
    expect(badAdherence.status).toBe(400);
    // No raw error text: a validation failure never echoes a stack or SQL.
    const res = await client
      .post(BASE)
      .set(OWNER.auth)
      .send(line({ scheduledQty: 0 }));
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|stack|at \w+ \(/i);
  });

  it("refuses a role without delivery-schedules permissions", async () => {
    const client = await api();
    expect((await client.get(BASE).set(PRODUCTION.auth)).status).toBe(403);
    expect((await client.post(BASE).set(PRODUCTION.auth).send(header())).status).toBe(403);
    expect((await client.get(`${BASE}/adherence`).set(PRODUCTION.auth)).status).toBe(403);
  });

  it("a foreign company sees none of these schedules and cannot link to its customer", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Schedule Tenant B", companyCode: `DSB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.customerSchedule.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.customerScheduleLine.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.customerScheduleDispatch.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.customerSchedule.count())).toBeGreaterThan(0);

    const foreignCustomer = await runAsTenant(other.id, () =>
      prisma.customer.create({
        data: {
          companyId: other.id,
          createdBy: "test",
          customerCode: `FX${sfx}`,
          firmName: "Foreign OEM",
        },
      })
    );
    const res = await (
      await api()
    )
      .post(BASE)
      .set(OWNER.auth)
      .send(header({ scheduleNo: `FOREIGN-${sfx}`, customerId: foreignCustomer.id }));
    expect(res.status).toBe(404);
    const lookup = await (await api()).get(`${BASE}/${SCHEDULE_ID}`).set(OWNER.auth);
    expect(lookup.status).toBe(200);
  });
});
