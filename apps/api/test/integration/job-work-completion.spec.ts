import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, demoCompany } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Job work completion (P2-08): the one-step return, challan cancellation, ITC-04 tables 5B/5C
 * on the filing gate, and an e-way bill raised from a challan.
 */
const sfx = Date.now().toString(36);
const n = (v: unknown) => Number(v);
let HSN_ID: string;

const material = async () => createRawMaterial({ hsnCodeId: HSN_ID });

describe("job work completion", () => {
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
        name: `Completion Worker ${Math.random().toString(36).slice(2, 7)}`,
        gstin: "33AABCT1234H1ZT",
        processType: "Buffing",
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
        challanDate: "2026-05-01",
        jobWorkerId,
        purpose: "Buffing",
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

  it("posts the returned quantity and scrap on the parent in the same step, and refuses over-receipt", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const jw = await worker();
    const out = await sendOut(jw.id, 100);
    const itemId = out.items[0].id as string;

    const ret1 = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_RETURN",
        challanDate: "2026-06-01",
        jobWorkerId: jw.id,
        parentChallanId: out.id,
        items: [
          {
            description: "Buffed material",
            uom: "KG",
            quantity: 60,
            parentItemId: itemId,
          },
        ],
      });
    expect(ret1.status, JSON.stringify(ret1.body).slice(0, 300)).toBe(201);

    const midParent = (await client.get(`/api/job-work/challans/${out.id}`).set(owner.auth)).body
      .data;
    expect(midParent.status).toBe("PART_RETURNED");
    expect(n(midParent.items[0].quantityReturned)).toBe(60);
    expect(n(midParent.items[0].balance)).toBe(40);

    // 30 more back plus 10 scrapped closes the line (60+30+10 = 100).
    const ret2 = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_RETURN",
        challanDate: "2026-06-10",
        jobWorkerId: jw.id,
        parentChallanId: out.id,
        items: [
          {
            description: "Buffed material",
            uom: "KG",
            quantity: 30,
            scrap: 10,
            parentItemId: itemId,
          },
        ],
      });
    expect(ret2.status, JSON.stringify(ret2.body).slice(0, 300)).toBe(201);
    const closedParent = (await client.get(`/api/job-work/challans/${out.id}`).set(owner.auth)).body
      .data;
    expect(closedParent.status).toBe("CLOSED");
    expect(n(closedParent.items[0].balance)).toBe(0);
    expect(closedParent.closedAt).toBeTruthy();

    // Nothing more can come back than went out, even through the one-step path.
    const over = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_RETURN",
        challanDate: "2026-06-11",
        jobWorkerId: jw.id,
        parentChallanId: out.id,
        items: [{ description: "Buffed material", uom: "KG", quantity: 1, parentItemId: itemId }],
      });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe("OVER_RECEIVED");
  });

  it("cancels a challan with a reason, refuses once a return is recorded, and reverses a cancelled return", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const jw = await worker();

    // Cancellable while nothing has come back.
    const clean = await sendOut(jw.id, 20);
    const noReason = await client
      .post(`/api/job-work/challans/${clean.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "" });
    expect(noReason.status).toBe(400);
    const cancelled = await client
      .post(`/api/job-work/challans/${clean.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Raised by mistake" });
    expect(cancelled.status, JSON.stringify(cancelled.body).slice(0, 300)).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect(cancelled.body.data.cancelReason).toBe("Raised by mistake");

    const again = await client
      .post(`/api/job-work/challans/${clean.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Twice" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_CANCELLED");

    // Once a return is recorded, the parent cannot be cancelled.
    const parent = await sendOut(jw.id, 50);
    const parentItemId = parent.items[0].id as string;
    const ret = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_RETURN",
        challanDate: "2026-06-05",
        jobWorkerId: jw.id,
        parentChallanId: parent.id,
        items: [{ description: "Back", uom: "KG", quantity: 10, parentItemId }],
      });
    expect(ret.status).toBe(201);
    const refused = await client
      .post(`/api/job-work/challans/${parent.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Too late" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("RETURN_RECORDED");

    // Cancelling the return challan itself reverses what it posted to the parent.
    const cancelReturn = await client
      .post(`/api/job-work/challans/${ret.body.data.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Recorded against the wrong challan" });
    expect(cancelReturn.status, JSON.stringify(cancelReturn.body).slice(0, 300)).toBe(200);
    const restatedParent = (await client.get(`/api/job-work/challans/${parent.id}`).set(owner.auth))
      .body.data;
    expect(restatedParent.status).toBe("OPEN");
    expect(n(restatedParent.items[0].quantityReturned)).toBe(0);
    expect(n(restatedParent.items[0].balance)).toBe(50);

    // The parent can be cancelled now that its only return is itself cancelled.
    const nowCancellable = await client
      .post(`/api/job-work/challans/${parent.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Not needed after all" });
    expect(nowCancellable.status, JSON.stringify(nowCancellable.body).slice(0, 300)).toBe(200);

    // Cancelled challans are absent from the register and the overdue clock.
    const lateThenCancelled = await sendOut(jw.id, 5, { challanDate: "2024-01-01" });
    const cancelLate = await client
      .post(`/api/job-work/challans/${lateThenCancelled.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "Not needed" });
    expect(cancelLate.status).toBe(200);
    const { jobWorkService } = await import("../../src/modules/job-work/job-work.service");
    const company = await demoCompany();
    const sweep = await runAsTenant(company.id, () => jobWorkService.warnOverdue());
    // No notice for the cancelled challan even though its due date is long past.
    const overdueList = await client
      .get("/api/job-work/challans")
      .query({ overdueOnly: "true" })
      .set(owner.auth);
    expect(overdueList.body.data.some((c: { id: string }) => c.id === lateThenCancelled.id)).toBe(
      false
    );
    void sweep;

    const register = await client
      .get("/api/job-work/register")
      .query({ jobWorkerId: jw.id })
      .set(owner.auth);
    expect(
      register.body.data.challans.some(
        (c: { id: string }) => c.id === lateThenCancelled.id || c.id === clean.id
      )
    ).toBe(false);
  });

  it("builds ITC-04 tables 4, 5A, 5B and 5C, and registers the half-year on the filing gate", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const client = await api();
    const jwA = await worker({ name: `ITC04 Worker A ${sfx}` });
    const jwB = await worker({ name: `ITC04 Worker B ${sfx}`, gstin: null, stateCode: "33" });

    const out = await sendOut(jwA.id, 40, { challanDate: "2026-05-12" });
    const parentItemId = out.items[0].id as string;

    // Table 5A: a one-step return.
    const back = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_RETURN",
        challanDate: "2026-06-20",
        jobWorkerId: jwA.id,
        parentChallanId: out.id,
        items: [{ description: "Back from A", uom: "KG", quantity: 25, parentItemId }],
      });
    expect(back.status, JSON.stringify(back.body).slice(0, 300)).toBe(201);

    // Table 5C: the remaining 15 supplied directly from the job worker's premises.
    const direct = await client
      .post(`/api/job-work/challans/${out.id}/receive`)
      .set(owner.auth)
      .send({
        lines: [
          {
            itemId: parentItemId,
            directSupply: 15,
            directSupplyInvoiceNo: `DS-${sfx}`,
            directSupplyInvoiceDate: "2026-07-01",
          },
        ],
      });
    expect(direct.status, JSON.stringify(direct.body).slice(0, 300)).toBe(200);
    expect(direct.body.data.status).toBe("CLOSED");

    // Table 5B: goods moved from job worker A to job worker B.
    const rm = await material();
    const transfer = await client
      .post("/api/job-work/challans")
      .set(owner.auth)
      .send({
        kind: "JOB_WORK_OUT",
        challanDate: "2026-06-25",
        jobWorkerId: jwB.id,
        fromJobWorkerId: jwA.id,
        purpose: "On to the next process",
        items: [
          {
            itemType: "RAW_MATERIAL",
            rawMaterialId: rm.rawMaterialId,
            description: "Semi-finished",
            uom: "KG",
            quantity: 25,
            rate: 100,
            gstRate: 18,
          },
        ],
      });
    expect(transfer.status, JSON.stringify(transfer.body).slice(0, 300)).toBe(201);

    const period = "2026-H1";
    const itc04 = await client.get("/api/job-work/itc04").query({ period }).set(owner.auth);
    expect(itc04.status, JSON.stringify(itc04.body).slice(0, 300)).toBe(200);

    const sentRow = itc04.body.data.table4.find(
      (r: { challanNo: string }) => r.challanNo === out.challanNo
    );
    expect(sentRow).toMatchObject({ quantity: 40, registered: true });

    const backRow = itc04.body.data.table5A.find(
      (r: { challanNo: string }) => r.challanNo === back.body.data.challanNo
    );
    expect(backRow).toMatchObject({ originalChallanNo: out.challanNo, quantity: 25 });

    const transferRow = itc04.body.data.table5B.find(
      (r: { challanNo: string }) => r.challanNo === transfer.body.data.challanNo
    );
    expect(transferRow).toMatchObject({
      toJobWorkerGstin: null,
      quantity: 25,
    });
    expect(transferRow.fromJobWorkerGstin).toBe("33AABCT1234H1ZT");

    const directRow = itc04.body.data.table5C.find(
      (r: { challanNo: string }) => r.challanNo === out.challanNo
    );
    expect(directRow).toMatchObject({
      quantity: 15,
      invoiceNo: `DS-${sfx}`,
      invoiceDate: "2026-07-01",
    });

    // The filing gate: register, refuse to file until approved, refuse a stale hash, then file.
    const reg = await client
      .post("/api/job-work/itc04/register")
      .set(accountant.auth)
      .send({ period });
    expect(reg.status, JSON.stringify(reg.body).slice(0, 300)).toBe(200);
    expect(reg.body.data.filing).toMatchObject({
      status: "DRAFT",
      filingType: "ITC04",
      periodKey: period,
    });
    const hash = reg.body.data.payloadHash as string;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(reg.body.data.json).toMatchObject({ version: "GST-ITC04-2.1", fp: period });
    expect(Array.isArray(reg.body.data.json.table5b)).toBe(true);
    expect(Array.isArray(reg.body.data.json.table5c)).toBe(true);

    const early = await client
      .post("/api/job-work/itc04/mark-filed")
      .set(accountant.auth)
      .send({ period });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("FILING_NOT_APPROVED");

    const id = reg.body.data.filing.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      200
    );

    // A change to the underlying documents after approval makes the stored hash stale.
    const extra = await sendOut(jwA.id, 1, { challanDate: "2026-05-15" });
    void extra;
    const staleFile = await client
      .post("/api/job-work/itc04/mark-filed")
      .set(accountant.auth)
      .send({ period });
    expect(staleFile.status).toBe(409);
    expect(staleFile.body.code).toBe("FILING_STALE");

    // Re-register, re-approve, then file.
    const reReg = await client
      .post("/api/job-work/itc04/register")
      .set(accountant.auth)
      .send({ period });
    expect(reReg.body.data.filing.status).toBe("DRAFT");
    const id2 = reReg.body.data.filing.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id2}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect(
      (await client.post(`/api/filings/approvals/${id2}/approve`).set(owner.auth)).status
    ).toBe(200);
    const filed = await client
      .post("/api/job-work/itc04/mark-filed")
      .set(accountant.auth)
      .send({ period, submissionRef: `ARN-${sfx}` });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 300)).toBe(200);
    expect(filed.body.data.filing).toMatchObject({ status: "SUBMITTED" });
  });

  it("raises an e-way bill from a challan", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    await client
      .put("/api/e-invoice/settings")
      .set(owner.auth)
      .send({ provider: "FIXTURE", enabled: true, applicableFrom: "2026-04-01" });
    const jw = await worker();
    const out = await sendOut(jw.id, 10, { challanDate: "2026-07-01" });

    const ewb = await client
      .post(`/api/job-work/challans/${out.id}/eway-bill`)
      .set(owner.auth)
      .send({ distanceKm: 25, vehicleNo: "TN01AB1234" });
    expect(ewb.status, JSON.stringify(ewb.body).slice(0, 300)).toBe(201);
    expect(ewb.body.data).toMatchObject({ docType: "JWC", docNo: out.challanNo, status: "ACTIVE" });
  });

  it("refuses a user without the permission, and hides another tenant's challans", async () => {
    const supervisor = await authed("demo.sales");
    const client = await api();
    const jw = await worker();
    const out = await sendOut(jw.id, 5);

    expect(
      (
        await client
          .post(`/api/job-work/challans/${out.id}/cancel`)
          .set(supervisor.auth)
          .send({ reason: "Not allowed" })
      ).status
    ).toBe(403);

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyName: "Job Work Tenant B",
          companyCode: `JWB-${Date.now().toString(36).slice(-5)}`,
        },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.deliveryChallan.count())).toBe(0);
    expect(
      await runAsTenant(other.id, () =>
        prisma.deliveryChallan.findUnique({ where: { id: out.id } })
      )
    ).toBeNull();
  });
});
