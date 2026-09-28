import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createCustomer,
  createEmployee,
  createRawMaterial,
  createSalesInvoice,
} from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Job / project costing (TN-09): a truck body job with its stage plan, material, labour and
 * subcontract costs, advances and stage invoices; margin vs quote; cancel instead of delete;
 * validation, permissions and tenancy (foreign customer / raw material / invoice ids refused).
 */
const sfx = Date.now().toString(36).slice(-5);
const D = (n: number) => new Prisma.Decimal(n);

let OWNER: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };
let CUSTOMER_ID: string;
let RM_ID: string;
let RM_CODE: string;
let EMP_ID: string;
let INVOICE_ID: string;
let ISSUE_ID: string;
let JOB_ID: string;
let FOREIGN: { companyId: string; customerId: string; rmId: string; invoiceId: string };

const base = () => ({
  jobNo: `JOB-${sfx}`,
  customerId: CUSTOMER_ID,
  title: "Tipper body on Tata 2518 chassis",
  quotedAmount: 450000,
  quoteDate: "2026-09-01",
  targetDate: "2026-10-15",
  chassisNo: `MAT${sfx}`,
  chassisMake: "Tata Signa 2518",
  chassisReceivedOn: "2026-09-05",
  conditionNotes: "Left mirror cracked on arrival",
});

const url = (p = "") => `/api/project-jobs${p}`;

describe("job / project costing (TN-09)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    PRODUCTION = await authed("demo.production");
    ACCOUNTS = await authed("demo.accounts");
    CUSTOMER_ID = (await createCustomer()).id;
    const rm = await createRawMaterial({ rate: D(72.5), baseUom: "KG" });
    RM_ID = rm.id;
    RM_CODE = rm.rawMaterialId;
    EMP_ID = (await createEmployee()).id.toString();
    INVOICE_ID = (await createSalesInvoice({ customerId: CUSTOMER_ID })).id;
    const prisma = await getPrisma();
    const issue = await asDemoTenant(() =>
      prisma.rawMaterialTransaction.create({
        data: {
          storeId: "ST-RM",
          rawMaterialId: RM_CODE,
          txnType: "MATERIAL_ISSUE",
          qty: D(-40),
          remarks: "MS sheet for tipper body",
        },
      })
    );
    ISSUE_ID = issue.rmTxnId.toString();

    // A second tenant with its own customer, raw material and invoice.
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "Job Tenant B", companyCode: `JTB-${sfx}` } })
    );
    FOREIGN = await runAsTenant(other.id, async () => {
      const c = await prisma.customer.create({
        data: {
          companyId: other.id,
          customerCode: `FC${sfx}`,
          firmName: "Foreign Transport",
          displayName: "Foreign Transport",
          creditLimit: D(0),
          mobile: ["9000000001"],
          createdBy: "test",
        },
      });
      const r = await prisma.rawMaterial.create({
        data: { rawMaterialId: `FRM${sfx}`, materialName: "Foreign steel", baseUom: "KG" },
      });
      const inv = await prisma.salesInvoice.create({
        data: {
          companyId: other.id,
          customerId: c.id,
          invoiceNo: `FINV-${sfx}`,
          invoiceDate: new Date(),
          subTotal: D(100),
          taxTotal: D(0),
          grandTotal: D(100),
          status: "UNPAID",
          payments: [],
        },
      });
      return { companyId: other.id, customerId: c.id, rmId: r.id, invoiceId: inv.id };
    });
  });

  it("lists the stage plans", async () => {
    const res = await (await api()).get(url("/stage-plans")).set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { key: string }) => p.key)).toEqual([
      "BODY_BUILDING",
      "FABRICATION",
      "NONE",
    ]);
  });

  it("creates a job with the body-building stage plan and the chassis in custody", async () => {
    const res = await (await api()).post(url()).set(PRODUCTION.auth).send(base());
    expect(res.status).toBe(201);
    JOB_ID = res.body.data.id;
    expect(res.body.data).toMatchObject({
      jobNo: `JOB-${sfx}`,
      status: "QUOTED",
      chassisNo: `MAT${sfx}`,
      chassisReceivedOn: "2026-09-05",
      quotedAmount: 450000,
      currentStage: "Chassis inward",
    });
    expect(res.body.data.stages.map((s: { name: string }) => s.name)).toEqual([
      "Chassis inward",
      "Fabrication",
      "Paneling",
      "Painting",
      "Electrical",
      "Finishing",
      "Delivery",
    ]);
    expect(res.body.data.summary).toMatchObject({ costToDate: 0, margin: 450000, marginPct: 100 });
  });

  it("refuses a duplicate job number", async () => {
    const dup = await (await api()).post(url()).set(OWNER.auth).send(base());
    expect(dup.status).toBe(409);
  });

  it("books material from a stock issue, labour as hours x rate, and subcontract", async () => {
    const client = await api();
    const mat = await client
      .post(url(`/${JOB_ID}/costs`))
      .set(OWNER.auth)
      .send({
        type: "MATERIAL",
        costDate: "2026-09-08",
        description: "MS sheet 3 mm",
        stockIssueId: ISSUE_ID,
      });
    expect(mat.status).toBe(201);
    const m = mat.body.data.costs[0];
    // Qty from the issue, rate and unit from the raw material master.
    expect(m).toMatchObject({
      qty: 40,
      rate: 72.5,
      amount: 2900,
      uom: "KG",
      rawMaterialId: RM_ID,
      stockIssueId: ISSUE_ID,
      status: "DRAFT",
    });

    const again = await client
      .post(url(`/${JOB_ID}/costs`))
      .set(OWNER.auth)
      .send({
        type: "MATERIAL",
        costDate: "2026-09-08",
        description: "same issue twice",
        stockIssueId: ISSUE_ID,
      });
    expect(again.status).toBe(409);

    const lab = await client
      .post(url(`/${JOB_ID}/costs`))
      .set(OWNER.auth)
      .send({
        type: "LABOUR",
        costDate: "2026-09-09",
        description: "Welder",
        qty: 7.5,
        rate: 180,
        employeeId: EMP_ID,
      });
    expect(lab.status).toBe(201);
    expect(lab.body.data.costs[1]).toMatchObject({ amount: 1350, uom: "HRS", employeeId: EMP_ID });

    const sub = await client
      .post(url(`/${JOB_ID}/costs`))
      .set(OWNER.auth)
      .send({
        type: "SUBCONTRACT",
        costDate: "2026-09-12",
        description: "Hydraulic kit fitting",
        rate: 38000,
        vendorName: "Sri Murugan Hydraulics",
        post: true,
      });
    expect(sub.status).toBe(201);
    const s = sub.body.data.summary;
    expect(s.costByType).toEqual({
      MATERIAL: 2900,
      LABOUR: 1350,
      SUBCONTRACT: 38000,
      OVERHEAD: 0,
    });
    expect(s.costToDate).toBe(42250);
    expect(s.draftCost).toBe(4250);
    expect(s.margin).toBe(407750);
  });

  it("removes only a draft cost line; posted lines are locked", async () => {
    const client = await api();
    const job = (await client.get(url(`/${JOB_ID}`)).set(OWNER.auth)).body.data;
    const posted = job.costs.find((c: { status: string }) => c.status === "POSTED");
    const lockedDel = await client.delete(url(`/${JOB_ID}/costs/${posted.id}`)).set(OWNER.auth);
    expect(lockedDel.status).toBe(409);

    const extra = await client
      .post(url(`/${JOB_ID}/costs`))
      .set(OWNER.auth)
      .send({
        type: "OVERHEAD",
        costDate: "2026-09-12",
        description: "Typo line",
        rate: 999,
      });
    const typo = extra.body.data.costs.find(
      (c: { description: string }) => c.description === "Typo line"
    );
    const del = await client.delete(url(`/${JOB_ID}/costs/${typo.id}`)).set(OWNER.auth);
    expect(del.status).toBe(200);
    expect(del.body.data.costs).toHaveLength(3);

    const post = await client
      .post(url(`/${JOB_ID}/costs/post`))
      .set(OWNER.auth)
      .send({});
    expect(post.status).toBe(200);
    expect(post.body.data.costs.every((c: { status: string }) => c.status === "POSTED")).toBe(true);
    expect(post.body.data.summary.draftCost).toBe(0);
  });

  it("moves stages, starts the job, reorders and computes % complete", async () => {
    const client = await api();
    const job = (await client.get(url(`/${JOB_ID}`)).set(OWNER.auth)).body.data;
    const [inward, fab] = job.stages;
    const done = await client
      .patch(url(`/${JOB_ID}/stages/${inward.id}`))
      .set(OWNER.auth)
      .send({ status: "DONE", actualEnd: "2026-09-05" });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("IN_PROGRESS");
    expect(done.body.data.stages[0]).toMatchObject({
      status: "DONE",
      actualStart: "2026-09-05",
      actualEnd: "2026-09-05",
    });
    expect(done.body.data.summary.percentComplete).toBe(14.3);

    const wip = await client
      .patch(url(`/${JOB_ID}/stages/${fab.id}`))
      .set(OWNER.auth)
      .send({ status: "IN_PROGRESS", actualStart: "2026-09-06", weight: 3 });
    expect(wip.body.data.currentStage).toBe("Fabrication");
    // DONE 1 + IN_PROGRESS 3/2 over a total weight of 9.
    expect(wip.body.data.summary.percentComplete).toBe(27.8);

    const added = await client
      .post(url(`/${JOB_ID}/stages`))
      .set(OWNER.auth)
      .send({ name: "RTO passing", plannedStart: "2026-10-10", plannedEnd: "2026-10-12" });
    expect(added.status).toBe(201);
    const ids: string[] = added.body.data.stages.map((s: { id: string }) => s.id);
    const rto = ids.at(-1)!;
    const wanted = [...ids.slice(0, -2), rto, ids.at(-2)!];
    const reordered = await client
      .put(url(`/${JOB_ID}/stages/order`))
      .set(OWNER.auth)
      .send({ stageIds: wanted });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.stages.map((s: { name: string }) => s.name).slice(-2)).toEqual([
      "RTO passing",
      "Delivery",
    ]);
    expect(reordered.body.data.stages.map((s: { seq: number }) => s.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("records an advance, a stage invoice that adjusts it, and the advance balance", async () => {
    const client = await api();
    const job = (await client.get(url(`/${JOB_ID}`)).set(OWNER.auth)).body.data;
    const adv = await client
      .post(url(`/${JOB_ID}/billings`))
      .set(OWNER.auth)
      .send({ kind: "ADVANCE", billDate: "2026-09-02", amount: 100000, reference: "NEFT 1123" });
    expect(adv.status).toBe(201);

    const tooMuch = await client
      .post(url(`/${JOB_ID}/billings`))
      .set(OWNER.auth)
      .send({
        kind: "STAGE_INVOICE",
        billDate: "2026-09-20",
        amount: 200000,
        advanceAdjusted: 150000,
      });
    expect(tooMuch.status).toBe(400);

    const inv = await client
      .post(url(`/${JOB_ID}/billings`))
      .set(OWNER.auth)
      .send({
        kind: "STAGE_INVOICE",
        billDate: "2026-09-20",
        amount: 200000,
        advanceAdjusted: 60000,
        stageId: job.stages[1].id,
        salesInvoiceId: INVOICE_ID,
      });
    expect(inv.status).toBe(201);
    const s = (await client.get(url(`/${JOB_ID}/summary`)).set(OWNER.auth)).body.data;
    expect(s).toMatchObject({
      advancesReceived: 100000,
      billed: 200000,
      advanceAdjusted: 60000,
      advanceBalance: 40000,
      toBill: 250000,
      billedVsCost: 157750,
    });

    const list = await client.get(url(`?q=${sfx}`)).set(OWNER.auth);
    expect(list.status).toBe(200);
    const row = list.body.data.find((r: { id: string }) => r.id === JOB_ID);
    expect(row.summary.marginBand).toBe("HEALTHY");
    expect(row.customerName).toBeTruthy();
  });

  it("refuses to delete a job with costs; it is cancelled instead and then locked", async () => {
    const client = await api();
    const del = await client.delete(url(`/${JOB_ID}`)).set(OWNER.auth);
    expect(del.status).toBe(409);
    const cancel = await client
      .patch(url(`/${JOB_ID}`))
      .set(OWNER.auth)
      .send({ status: "CANCELLED" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("CANCELLED");
    // Cost lines survive the cancellation.
    expect(cancel.body.data.costs).toHaveLength(3);
    const reopen = await client
      .patch(url(`/${JOB_ID}`))
      .set(OWNER.auth)
      .send({ status: "IN_PROGRESS" });
    expect(reopen.status).toBe(409);
    const cost = await client
      .post(url(`/${JOB_ID}/costs`))
      .set(OWNER.auth)
      .send({ type: "OVERHEAD", costDate: "2026-09-30", description: "late", rate: 10 });
    expect(cost.status).toBe(409);
    const edit = await client
      .patch(url(`/${JOB_ID}`))
      .set(OWNER.auth)
      .send({ title: "x" });
    expect(edit.status).toBe(409);
  });

  it("hard-deletes a job entered by mistake while it has no cost or billing", async () => {
    const client = await api();
    const res = await client
      .post(url())
      .set(OWNER.auth)
      .send({ ...base(), jobNo: `OOPS-${sfx}`, stagePlan: "FABRICATION" });
    expect(res.status).toBe(201);
    expect(res.body.data.stages[0].name).toBe("Drawing approval");
    const del = await client.delete(url(`/${res.body.data.id}`)).set(OWNER.auth);
    expect(del.status).toBe(200);
    expect((await client.get(url(`/${res.body.data.id}`)).set(OWNER.auth)).status).toBe(404);
  });

  it("rejects every invalid create", async () => {
    const client = await api();
    const bad = async (patch: Record<string, unknown>) =>
      client
        .post(url())
        .set(OWNER.auth)
        .send({ ...base(), jobNo: `BAD-${sfx}`, ...patch });
    expect((await bad({ jobNo: "" })).status).toBe(400);
    expect((await bad({ title: "" })).status).toBe(400);
    expect((await bad({ quotedAmount: -1 })).status).toBe(400);
    expect((await bad({ quotedAmount: "abc" })).status).toBe(400);
    expect((await bad({ quoteDate: "01/09/2026" })).status).toBe(400);
    expect((await bad({ targetDate: "2026-08-01" })).status).toBe(400); // before the quote
    expect((await bad({ stagePlan: "SPACESHIP" })).status).toBe(400);
    expect((await bad({ customerId: "not-a-uuid" })).status).toBe(400);
    expect((await bad({ chassisNo: "X".repeat(41) })).status).toBe(400);
    expect((await bad({ customerId: randomUUID() })).status).toBe(404);
    const foreign = await bad({ customerId: FOREIGN.customerId });
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toMatch(/prisma|stack|at .*\.ts/i);
  });

  it("rejects every invalid update, stage, cost and billing", async () => {
    const client = await api();
    const res = await client
      .post(url())
      .set(OWNER.auth)
      .send({ ...base(), jobNo: `V-${sfx}` });
    const id = res.body.data.id;
    const stageId = res.body.data.stages[0].id;
    const patch = (body: object) =>
      client
        .patch(url(`/${id}`))
        .set(OWNER.auth)
        .send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ quotedAmount: -5 })).status).toBe(400);
    expect((await patch({ targetDate: "2026-01-01" })).status).toBe(400);
    expect((await patch({ status: "LOST" })).status).toBe(400);
    expect((await patch({ status: "DELIVERED" })).status).toBe(200);
    expect((await patch({ status: "QUOTED" })).status).toBe(409); // delivered is final

    const res2 = await client
      .post(url())
      .set(OWNER.auth)
      .send({ ...base(), jobNo: `W-${sfx}` });
    const j = res2.body.data.id;
    const st = res2.body.data.stages[0].id;
    const stage = (body: object) =>
      client
        .patch(url(`/${j}/stages/${st}`))
        .set(OWNER.auth)
        .send(body);
    expect((await stage({ status: "DONE" })).status).toBe(400); // no actual end
    expect((await stage({})).status).toBe(400);
    expect((await stage({ status: "HALF" })).status).toBe(400);
    expect((await stage({ plannedStart: "2026-09-10", plannedEnd: "2026-09-01" })).status).toBe(
      400
    );
    expect(
      (await stage({ status: "DONE", actualStart: "2026-09-10", actualEnd: "2026-09-01" })).status
    ).toBe(400);
    expect(
      (
        await client
          .patch(url(`/${j}/stages/${stageId}`))
          .set(OWNER.auth)
          .send({ name: "x" })
      ).status
    ).toBe(404); // a stage of another job
    expect(
      (
        await client
          .post(url(`/${j}/stages`))
          .set(OWNER.auth)
          .send({ name: "" })
      ).status
    ).toBe(400);
    expect(
      (
        await client
          .post(url(`/${j}/stages`))
          .set(OWNER.auth)
          .send({ name: "x", plannedStart: "2026-09-10", plannedEnd: "2026-09-01" })
      ).status
    ).toBe(400);
    expect(
      (
        await client
          .put(url(`/${j}/stages/order`))
          .set(OWNER.auth)
          .send({ stageIds: [st] })
      ).status
    ).toBe(400);
    expect(
      (
        await client
          .put(url(`/${j}/stages/order`))
          .set(OWNER.auth)
          .send({ stageIds: [] })
      ).status
    ).toBe(400);

    const cost = (body: object) =>
      client
        .post(url(`/${j}/costs`))
        .set(OWNER.auth)
        .send({ costDate: "2026-09-10", description: "x", ...body });
    expect((await cost({ type: "FOOD", rate: 1 })).status).toBe(400);
    expect((await cost({ type: "OVERHEAD" })).status).toBe(400); // no rate
    expect((await cost({ type: "OVERHEAD", rate: -1 })).status).toBe(400);
    expect((await cost({ type: "OVERHEAD", rate: 1, qty: 0 })).status).toBe(400);
    expect((await cost({ type: "LABOUR", rate: 100 })).status).toBe(400); // no hours
    expect((await cost({ type: "LABOUR", qty: 1, rate: 1, rawMaterialId: RM_ID })).status).toBe(
      400
    );
    expect((await cost({ type: "MATERIAL", rate: 1, employeeId: EMP_ID })).status).toBe(400);
    expect((await cost({ type: "OVERHEAD", rate: 1, description: "" })).status).toBe(400);
    expect((await cost({ type: "OVERHEAD", rate: 1, costDate: "yesterday" })).status).toBe(400);
    expect((await cost({ type: "MATERIAL", stockIssueId: "abc" })).status).toBe(400);
    expect((await cost({ type: "MATERIAL", rawMaterialId: randomUUID() })).status).toBe(404);
    expect((await cost({ type: "MATERIAL", rawMaterialId: FOREIGN.rmId })).status).toBe(404);
    expect((await cost({ type: "MATERIAL", rate: 1, stockIssueId: 999999999 })).status).toBe(404);
    expect((await cost({ type: "LABOUR", qty: 1, rate: 1, employeeId: 999999999 })).status).toBe(
      404
    );
    expect((await client.delete(url(`/${j}/costs/${randomUUID()}`)).set(OWNER.auth)).status).toBe(
      404
    );

    const bill = (body: object) =>
      client
        .post(url(`/${j}/billings`))
        .set(OWNER.auth)
        .send({ billDate: "2026-09-10", amount: 1000, ...body });
    expect((await bill({ kind: "GIFT" })).status).toBe(400);
    expect((await bill({ kind: "ADVANCE", amount: 0 })).status).toBe(400);
    expect((await bill({ kind: "ADVANCE", advanceAdjusted: 10 })).status).toBe(400);
    expect((await bill({ kind: "FINAL", advanceAdjusted: 2000 })).status).toBe(400);
    expect((await bill({ kind: "FINAL", advanceAdjusted: 10 })).status).toBe(400); // no advance yet
    expect((await bill({ kind: "FINAL", billDate: "10-09-2026" })).status).toBe(400);
    expect((await bill({ kind: "STAGE_INVOICE", stageId: stageId })).status).toBe(404);
    expect((await bill({ kind: "FINAL", salesInvoiceId: randomUUID() })).status).toBe(404);
    const foreignInv = await bill({ kind: "FINAL", salesInvoiceId: FOREIGN.invoiceId });
    expect(foreignInv.status).toBe(404);
    const otherCustomerInv = await createSalesInvoice({ customerId: (await createCustomer()).id });
    expect((await bill({ kind: "FINAL", salesInvoiceId: otherCustomerInv.id })).status).toBe(400);

    expect((await client.get(url("/not-a-uuid")).set(OWNER.auth)).status).toBe(400);
    expect((await client.get(url(`/${randomUUID()}`)).set(OWNER.auth)).status).toBe(404);
  });

  it("refuses a role without project-jobs permissions", async () => {
    const client = await api();
    expect((await client.get(url()).set(ACCOUNTS.auth)).status).toBe(403);
    expect((await client.post(url()).set(ACCOUNTS.auth).send(base())).status).toBe(403);
    expect((await client.delete(url(`/${JOB_ID}`)).set(ACCOUNTS.auth)).status).toBe(403);
  });

  it("a foreign company sees none of these jobs", async () => {
    const prisma = await getPrisma();
    const other = FOREIGN.companyId;
    expect(await runAsTenant(other, () => prisma.projectJob.count())).toBe(0);
    expect(await runAsTenant(other, () => prisma.projectJobStage.count())).toBe(0);
    expect(await runAsTenant(other, () => prisma.projectJobCost.count())).toBe(0);
    expect(await runAsTenant(other, () => prisma.projectJobBilling.count())).toBe(0);
    expect(
      await runAsTenant(other, () => prisma.projectJob.findFirst({ where: { id: JOB_ID } }))
    ).toBeNull();
    expect(await asDemoTenant(() => prisma.projectJob.count())).toBeGreaterThan(0);
  });
});
