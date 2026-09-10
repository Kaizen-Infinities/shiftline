import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";
import {
  filingApprovalService,
  hashPayload,
} from "../../src/modules/filings/filing-approval.service";

/**
 * Approval gates on filings (P1-04, PC7): draft → pending → approved by someone else → submitted;
 * a change to the payload after approval voids it and the gate refuses; rejections carry a reason.
 */
const period = `2026-${String((((Date.now() / 1000) % 12) | 0) + 1).padStart(2, "0")}`;

describe("filing approval gate", () => {
  it("walks a GSTR-1 period through preparation, approval and submission", async () => {
    const accountant = await authed("demo.accounts");
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    const summary = { b2b: 12, taxable: 480000, tax: 86400 };

    expect((await client.get("/api/filings/registry").set(supervisor.auth)).status).toBe(403);
    const registry = await client.get("/api/filings/registry").set(accountant.auth);
    expect(registry.body.data.some((f: { key: string }) => f.key === "GSTR1")).toBe(true);

    // Wrong period shape for a monthly filing.
    expect(
      (
        await client
          .post("/api/filings/approvals")
          .set(accountant.auth)
          .send({ filingType: "GSTR1", periodKey: "2026-Q1", summary })
      ).status
    ).toBe(400);

    const draft = await client
      .post("/api/filings/approvals")
      .set(accountant.auth)
      .send({ filingType: "GSTR1", periodKey: period, summary, notes: "August sales" });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const id = draft.body.data.id as string;
    expect(draft.body.data).toMatchObject({ status: "DRAFT", payloadHash: hashPayload(summary) });

    // The gate refuses until approved.
    await expect(
      asDemoTenant(() =>
        filingApprovalService.assertSubmittable("GSTR1", period, hashPayload(summary))
      )
    ).rejects.toMatchObject({ code: "FILING_NOT_APPROVED" });

    // Approving needs the permission and cannot be done by the preparer.
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      409
    );
    const sent = await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth);
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe("PENDING");
    // Someone without the approve permission is refused; the preparer cannot approve their own work.
    expect(
      (await client.post(`/api/filings/approvals/${id}/approve`).set(accountant.auth)).status
    ).toBe(403);
    const own = await client
      .post("/api/filings/approvals")
      .set(owner.auth)
      .send({ filingType: "GSTR3B", periodKey: period, summary: { tax: 86400 } });
    expect(own.status).toBe(201);
    expect(
      (await client.post(`/api/filings/approvals/${own.body.data.id}/send`).set(owner.auth)).status
    ).toBe(200);
    const self = await client
      .post(`/api/filings/approvals/${own.body.data.id}/approve`)
      .set(owner.auth);
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("SELF_APPROVAL");
    expect(
      (await client.post(`/api/filings/approvals/${id}/approve`).set(supervisor.auth)).status
    ).toBe(403);

    const approved = await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: "APPROVED" });
    expect(approved.body.data.lockedAt).toBeTruthy();

    // A different payload is refused; the same one passes.
    await expect(
      asDemoTenant(() =>
        filingApprovalService.assertSubmittable(
          "GSTR1",
          period,
          hashPayload({ ...summary, tax: 1 })
        )
      )
    ).rejects.toMatchObject({ code: "FILING_STALE" });
    await expect(
      asDemoTenant(() =>
        filingApprovalService.assertSubmittable("GSTR1", period, hashPayload(summary))
      )
    ).resolves.toMatchObject({ id });

    // Re-registering the draft with changed figures voids the approval.
    const changed = await client
      .post("/api/filings/approvals")
      .set(accountant.auth)
      .send({ filingType: "GSTR1", periodKey: period, summary: { ...summary, b2b: 13 } });
    expect(changed.status).toBe(201);
    expect(changed.body.data).toMatchObject({ status: "DRAFT", approvedBy: null });
    expect(
      changed.body.data.history.some((h: { event: string }) => h.event === "APPROVAL_VOIDED")
    ).toBe(true);
    expect(
      (await client.post(`/api/filings/approvals/${id}/submitted`).set(owner.auth).send({})).status
    ).toBe(409);

    // Re-approve and submit; a submitted period cannot be redrafted.
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      200
    );
    const submitted = await client
      .post(`/api/filings/approvals/${id}/submitted`)
      .set(accountant.auth)
      .send({ submissionRef: "ARN-AA330826000123" });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.data).toMatchObject({
      status: "SUBMITTED",
      submissionRef: "ARN-AA330826000123",
    });
    const redraft = await client
      .post("/api/filings/approvals")
      .set(accountant.auth)
      .send({ filingType: "GSTR1", periodKey: period, summary });
    expect(redraft.status).toBe(409);
    expect(redraft.body.code).toBe("FILING_SUBMITTED");

    // Audited by trigger.
    const prisma = await getPrisma();
    const audit = await asDemoTenant(() =>
      prisma.auditLog.count({ where: { entityName: "filing_approvals", entityId: id } })
    );
    expect(audit).toBeGreaterThanOrEqual(3);
  });

  it("rejects with a reason and lets the preparer resend", async () => {
    const accountant = await authed("demo.accounts");
    const owner = await authed("demo.owner");
    const client = await api();
    const draft = await client
      .post("/api/filings/approvals")
      .set(accountant.auth)
      .send({ filingType: "PF_ECR", periodKey: period, summary: { members: 42, wages: 910000 } });
    expect(draft.status).toBe(201);
    const id = draft.body.data.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect(
      (await client.post(`/api/filings/approvals/${id}/reject`).set(owner.auth).send({})).status
    ).toBe(400);
    const rejected = await client
      .post(`/api/filings/approvals/${id}/reject`)
      .set(owner.auth)
      .send({ reason: "Two new joiners missing" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      status: "REJECTED",
      rejectReason: "Two new joiners missing",
    });
    const resent = await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth);
    expect(resent.status).toBe(200);
    expect(resent.body.data).toMatchObject({ status: "PENDING", rejectReason: null });
    const list = await client
      .get("/api/filings/approvals")
      .query({ status: "PENDING" })
      .set(accountant.auth);
    expect(list.body.data.some((r: { id: string }) => r.id === id)).toBe(true);
  });
});
