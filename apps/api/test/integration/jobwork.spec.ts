import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, demoCompany } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";

/**
 * Job work and delivery challans (P1-14).
 *
 * The clock is what this package is for: credit taken on goods sent out is only safe while they
 * come back within a year (three for capital goods). A line is accounted for when what was sent
 * equals what came back plus what the process consumed plus what was scrapped — so the tests
 * follow a challan through a part return and out the other side.
 */
const sfx = Date.now().toString(36);
const n = (v: unknown) => Number(v);
let HSN_ID: string;

const material = async () => createRawMaterial({ hsnCodeId: HSN_ID });

describe("job work and delivery challans", () => {
  beforeAll(async () => {
    const prisma = await getPrisma();
    HSN_ID = (
      await asDemoTenant(() => prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } }))
    ).id;
  });

  const worker = async (over: Record<string, unknown> = {}) => {
    const owner = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/job-work/workers")
      .set(owner.auth)
      .send({
        name: `Polisher ${Math.random().toString(36).slice(2, 7)}`,
        gstin: "33AABCT1234H1ZT",
        processType: "Polishing",
        ...over,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    return res.body.data;
  };

  const sendOut = async (
    jobWorkerId: string,
    quantity: number,
    over: Record<string, unknown> = {}
  ) => {
    const owner = await authed("demo.owner");
    const rm = await material();
    const res = await (
      await api()
    )
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_OUT",
        challanDate: "2026-04-10",
        jobWorkerId,
        purpose: "Polishing",
        items: [
          {
            itemType: "RAW_MATERIAL",
            rawMaterialId: rm.rawMaterialId,
            description: rm.materialName,
            uom: "KG",
            hsnCode: "3923",
            quantity,
            rate: 100,
            gstRate: 18,
          },
        ],
        ...over,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    return res.body.data;
  };

  it("starts a one-year clock when goods go out for job work", async () => {
    const jw = await worker();
    const challan = await sendOut(jw.id, 100);

    expect(challan.challanNo).toMatch(/^JW\//);
    expect(challan.kind).toBe("JOB_WORK_OUT");
    expect(challan.status).toBe("OPEN");
    // Sent 10 April 2026 at ₹100 a unit: back by 10 April 2027.
    expect(String(challan.returnDueDate).slice(0, 10)).toBe("2027-04-10");
    expect(n(challan.taxable)).toBe(10000);
    // Same state, so the notional tax on the movement splits CGST/SGST.
    expect(n(challan.cgst)).toBe(900);
    expect(n(challan.sgst)).toBe(900);
    expect(n(challan.igst)).toBe(0);
  });

  it("gives capital goods three years instead of one", async () => {
    const jw = await worker();
    const challan = await sendOut(jw.id, 5, { capitalGoods: true });
    expect(String(challan.returnDueDate).slice(0, 10)).toBe("2029-04-10");
    expect(challan.capitalGoods).toBe(true);
  });

  it("closes a line only when return, consumption and scrap account for what was sent", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const jw = await worker();
    const challan = await sendOut(jw.id, 100);
    const itemId = challan.items[0].id as string;

    // 60 back, nothing else: the line is part returned and 40 is still out.
    const part = await client
      .post(`/api/job-work/challans/${challan.id}/receive`)
      .set(owner.auth)
      .send({ lines: [{ itemId, returned: 60 }] });
    expect(part.status, JSON.stringify(part.body).slice(0, 300)).toBe(200);
    expect(part.body.data.status).toBe("PART_RETURNED");

    const mid = (await client.get(`/api/job-work/challans/${challan.id}`).set(owner.auth)).body
      .data;
    expect(n(mid.items[0].balance)).toBe(40);
    expect(n(mid.pendingQuantity)).toBe(40);

    // 30 more back, 8 consumed by the process, 2 scrapped: that accounts for the rest.
    const rest = await client
      .post(`/api/job-work/challans/${challan.id}/receive`)
      .set(owner.auth)
      .send({ lines: [{ itemId, returned: 30, consumed: 8, scrap: 2 }] });
    expect(rest.status).toBe(200);
    expect(rest.body.data.status).toBe("CLOSED");

    const done = (await client.get(`/api/job-work/challans/${challan.id}`).set(owner.auth)).body
      .data;
    expect(n(done.items[0].balance)).toBe(0);
    expect(n(done.items[0].quantityScrap)).toBe(2);
    expect(done.closedAt).toBeTruthy();

    // Nothing more can come back than went out.
    const over = await client
      .post(`/api/job-work/challans/${challan.id}/receive`)
      .set(owner.auth)
      .send({ lines: [{ itemId, returned: 1 }] });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe("OVER_RECEIVED");
  });

  it("warns before the deadline and again once the goods are late, but not twice", async () => {
    const client = await api();
    const owner = await authed("demo.owner");
    const jw = await worker();
    // Sent two years ago and never returned: long past the one-year deadline.
    const late = await sendOut(jw.id, 50, { challanDate: "2024-06-01" });
    expect(String(late.returnDueDate).slice(0, 10)).toBe("2025-06-01");

    const { jobWorkService } = await import("../../src/modules/job-work/job-work.service");
    const company = await demoCompany();
    const first = await runAsTenant(company.id, () => jobWorkService.warnOverdue());
    expect(first.sent).toBeGreaterThan(0);
    // The job runs daily; the same notice must not go out every one of those days.
    const second = await runAsTenant(company.id, () => jobWorkService.warnOverdue());
    expect(second.sent).toBe(0);

    const overdue = await client
      .get("/api/job-work/challans")
      .query({ overdueOnly: "true" })
      .set(owner.auth);
    expect(overdue.status).toBe(200);
    expect(overdue.body.data.some((c: { id: string }) => c.id === late.id)).toBe(true);
    const row = overdue.body.data.find((c: { id: string }) => c.id === late.id);
    expect(row.overdue).toBe(true);
    expect(row.daysToReturn).toBeLessThan(0);
  });

  it("builds the register and ITC-04 for a half-year", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const jw = await worker({ name: `Registered Worker ${sfx}` });
    const unregistered = await worker({
      name: `Unregistered ${sfx}`,
      gstin: null,
      stateCode: "33",
    });
    const out = await sendOut(jw.id, 40, { challanDate: "2026-05-12" });
    await sendOut(unregistered.id, 10, { challanDate: "2026-05-14" });

    // A return challan raised against the out challan is what table 5A reports.
    const rm = await material();
    const back = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_RETURN",
        challanDate: "2026-06-20",
        jobWorkerId: jw.id,
        parentChallanId: out.id,
        items: [
          {
            itemType: "RAW_MATERIAL",
            rawMaterialId: rm.rawMaterialId,
            description: rm.materialName,
            uom: "KG",
            quantity: 40,
            rate: 100,
          },
        ],
      });
    expect(back.status, JSON.stringify(back.body).slice(0, 300)).toBe(201);

    const register = await client
      .get("/api/job-work/register")
      .query({ from: "2026-05-01", to: "2026-05-31" })
      .set(owner.auth);
    expect(register.status).toBe(200);
    const mine = register.body.data.byWorker.find(
      (w: { jobWorker: { id: string } | null }) => w.jobWorker?.id === jw.id
    );
    expect(mine.challans).toBe(1);
    expect(n(mine.value)).toBe(4720); // 4,000 plus the notional 18%

    // April to September 2026 is H1.
    const itc04 = await client
      .get("/api/job-work/itc04")
      .query({ period: "2026-H1" })
      .set(owner.auth);
    expect(itc04.status, JSON.stringify(itc04.body).slice(0, 300)).toBe(200);
    expect(itc04.body.data).toMatchObject({ from: "2026-04-01", to: "2026-10-01" });
    const sentRow = itc04.body.data.table4.find(
      (r: { challanNo: string }) => r.challanNo === out.challanNo
    );
    expect(sentRow).toMatchObject({ quantity: 40, registered: true });
    // The portal asks whether the worker is registered; no GSTIN means they are not.
    expect(
      itc04.body.data.table4.some((r: { registered: boolean }) => r.registered === false)
    ).toBe(true);
    const backRow = itc04.body.data.table5A.find(
      (r: { challanNo: string }) => r.challanNo === back.body.data.challanNo
    );
    expect(backRow).toMatchObject({ originalChallanNo: out.challanNo, quantity: 40 });

    expect(
      (await client.get("/api/job-work/itc04").query({ period: "2026-Q1" }).set(owner.auth)).status
    ).toBe(400);
  });

  it("refuses job work with no job worker, and the routes without the permission", async () => {
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.sales");
    const client = await api();
    const rm = await material();

    const noWorker = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_OUT",
        challanDate: "2026-04-10",
        items: [{ rawMaterialId: rm.rawMaterialId, quantity: 1, uom: "KG" }],
      });
    expect(noWorker.status).toBe(400);
    expect(noWorker.body.code).toBe("JOB_WORKER_REQUIRED");

    // A branch transfer needs no job worker and starts no clock.
    const transfer = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "BRANCH_TRANSFER",
        challanDate: "2026-04-11",
        purpose: "To the second unit",
        items: [{ rawMaterialId: rm.rawMaterialId, quantity: 5, uom: "KG", rate: 50 }],
      });
    expect(transfer.status, JSON.stringify(transfer.body).slice(0, 300)).toBe(201);
    expect(transfer.body.data.challanNo).toMatch(/^DC\//);
    expect(transfer.body.data.returnDueDate).toBeNull();

    // Only a job-work challan takes goods back.
    const wrongKind = await client
      .post(`/api/job-work/challans/${transfer.body.data.id}/receive`)
      .set(owner.auth)
      .send({ lines: [{ itemId: transfer.body.data.items[0].id, returned: 1 }] });
    expect(wrongKind.status).toBe(400);
    expect(wrongKind.body.code).toBe("NOT_JOB_WORK");

    expect((await client.get("/api/job-work/challans").set(supervisor.auth)).status).toBe(403);
  });
});
