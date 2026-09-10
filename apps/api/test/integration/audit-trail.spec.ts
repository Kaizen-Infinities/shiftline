import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoOwner } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Audit trail viewer (P1-09d): the trigger-written log is readable per tenant, filtered by
 * entity, record, user, action and date, with a before/after diff; only `audit-reports.*`
 * holders see it and the auditor role reads without writing.
 */
const today = new Date().toISOString().slice(0, 10);

const postContra = async (auth: Record<string, string>, amount: number) => {
  const prisma = await getPrisma();
  const cash = await asDemoTenant(() =>
    prisma.accountLedger.findFirstOrThrow({ where: { code: "CASH-001" } })
  );
  const bank = await asDemoTenant(() =>
    prisma.accountLedger.findFirstOrThrow({ where: { code: "BANK-001" } })
  );
  const res = await (
    await api()
  )
    .post("/api/vouchers")
    .set(auth)
    .send({
      type: "CONTRA",
      date: today,
      narration: "audit trail test",
      items: [
        { debitLedgerId: cash.id, debitAmount: amount, creditAmount: 0 },
        { creditLedgerId: bank.id, debitAmount: 0, creditAmount: amount },
      ],
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: number; voucherNo: string };
};

describe("audit trail", () => {
  it("shows who posted and cancelled a voucher, with the fields that changed", async () => {
    const owner = await authed("demo.owner");
    const ownerUser = await demoOwner();
    const voucher = await postContra(owner.auth, 250);
    const cancelled = await (
      await api()
    )
      .post(`/api/vouchers/${voucher.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "audit trail test" });
    expect(cancelled.status).toBe(200);

    const res = await (
      await api()
    )
      .get("/api/audit-trail")
      .query({ entity: "vouchers", entityId: String(voucher.id) })
      .set(owner.auth);
    expect(res.status).toBe(200);
    const rows = res.body.data.data as {
      action: string;
      entityLabel: string;
      actor: { type: string; id: string | null; name: string };
      requestId: string | null;
      changes: { field: string; from: unknown; to: unknown }[];
      newValues: Record<string, unknown> | null;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.entityLabel === "Voucher")).toBe(true);

    const created = rows.find((r) => r.action === "CREATE");
    expect(created).toBeDefined();
    expect(created!.actor).toMatchObject({ type: "user", id: ownerUser.userId });
    expect(created!.actor.name).toBe(ownerUser.fullName);
    expect(created!.requestId).toBeTruthy();
    expect(created!.newValues?.voucher_no ?? created!.newValues?.voucherNo).toBe(voucher.voucherNo);

    const updated = rows.find((r) => r.action === "UPDATE");
    expect(updated).toBeDefined();
    expect(updated!.changes).toEqual(
      expect.arrayContaining([{ field: "status", from: "POSTED", to: "CANCELLED" }])
    );
    // Newest first.
    expect(rows[0].action).toBe("UPDATE");
  });

  it("filters by user, action and date, paginates, and rejects a malformed date", async () => {
    const owner = await authed("demo.owner");
    const ownerUser = await demoOwner();
    await postContra(owner.auth, 300);
    const client = await api();

    const byUser = await client
      .get("/api/audit-trail")
      .query({ userId: ownerUser.userId, action: "CREATE" })
      .set(owner.auth);
    expect(byUser.status).toBe(200);
    expect(byUser.body.data.total).toBeGreaterThan(0);
    for (const row of byUser.body.data.data) {
      expect(row.action).toBe("CREATE");
      expect(row.actor.id).toBe(ownerUser.userId);
    }

    const paged = await client
      .get("/api/audit-trail")
      .query({ pageSize: 1, page: 1 })
      .set(owner.auth);
    expect(paged.body.data.data).toHaveLength(1);
    expect(paged.body.data.pages).toBeGreaterThan(1);

    const future = await client
      .get("/api/audit-trail")
      .query({ from: "2099-01-01" })
      .set(owner.auth);
    expect(future.body.data.total).toBe(0);
    const past = await client.get("/api/audit-trail").query({ to: "2000-01-01" }).set(owner.auth);
    expect(past.body.data.total).toBe(0);
    const todayOnly = await client
      .get("/api/audit-trail")
      .query({ from: today, to: today, entity: "vouchers" })
      .set(owner.auth);
    expect(todayOnly.body.data.total).toBeGreaterThan(0);

    const bad = await client.get("/api/audit-trail").query({ from: "yesterday" }).set(owner.auth);
    expect(bad.status).toBe(400);

    const filters = await client.get("/api/audit-trail/filters").set(owner.auth);
    expect(filters.status).toBe(200);
    expect(filters.body.data.entities).toEqual(
      expect.arrayContaining([{ table: "vouchers", model: "Voucher", label: "Voucher" }])
    );
    expect(filters.body.data.users.map((u: { username: string }) => u.username)).toContain(
      "demo.auditor"
    );
  });

  it("is visible only to audit-reports holders; the auditor reads everything and writes nothing", async () => {
    const client = await api();
    const stores = await authed("demo.stores");
    expect((await client.get("/api/audit-trail").set(stores.auth)).status).toBe(403);

    const auditor = await authed("demo.auditor");
    expect((await client.get("/api/audit-trail").set(auditor.auth)).status).toBe(200);
    expect((await client.get("/api/accounts/trial-balance").set(auditor.auth)).status).toBe(200);
    const write = await client
      .post("/api/vouchers")
      .set(auditor.auth)
      .send({ type: "JOURNAL", date: today, items: [] });
    expect(write.status).toBe(403);

    const prisma = await getPrisma();
    const role = await asDemoTenant(() =>
      prisma.role.findFirstOrThrow({
        where: { code: "AUDITOR" },
        include: { rolePermissions: { include: { permission: true } } },
      })
    );
    const keys = role.rolePermissions.map((rp) => rp.permission.key);
    expect(keys).toContain("audit-reports.view");
    expect(keys).toContain("accounts.view");
    expect(keys.filter((k) => !k.endsWith(".view") && k !== "audit-reports.export")).toEqual([]);
  });

  it("never shows another tenant's rows", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "Audit Tenant B", companyCode: "AUDTB" } })
    );
    const foreign = await runAsTenant(other.id, () =>
      prisma.ledgerGroup.create({ data: { code: "AUD-B", name: "Foreign group", nature: "ASSET" } })
    );
    const foreignRows = await runAsTenant(other.id, () =>
      prisma.auditLog.count({
        where: { entityName: "ledger_groups", entityId: String(foreign.id) },
      })
    );
    expect(foreignRows).toBe(1);

    const owner = await authed("demo.owner");
    const client = await api();
    const list = await client
      .get("/api/audit-trail")
      .query({ entity: "ledger_groups", pageSize: 200 })
      .set(owner.auth);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(other.id);
    expect(
      list.body.data.data.filter((r: { entityId: string }) => r.entityId === String(foreign.id))
    ).toEqual([]);
    const byId = await client
      .get("/api/audit-trail")
      .query({ entityId: String(foreign.id), entity: "ledger_groups" })
      .set(owner.auth);
    expect(byId.body.data.total).toBe(0);
  });

  it("exports the filtered trail as CSV for audit-reports.export holders", async () => {
    const owner = await authed("demo.owner");
    const voucher = await postContra(owner.auth, 125);
    await (
      await api()
    )
      .post(`/api/vouchers/${voucher.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "csv" });

    const res = await (
      await api()
    )
      .get("/api/audit-trail/export")
      .query({ entity: "vouchers", entityId: String(voucher.id) })
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/audit-trail-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = res.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      "Changed at,Entity,Record,Action,By,Actor type,Impersonated by,Request id,Details"
    );
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(res.text).toContain("status: POSTED → CANCELLED");
    expect(res.text).not.toMatch(/password/i);

    const stores = await authed("demo.stores");
    expect((await (await api()).get("/api/audit-trail/export").set(stores.auth)).status).toBe(403);
  });
});
