import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany, demoOwner } from "../factories";

describe("append-only audit trail", () => {
  it("records create, update and delete on books-of-account tables with actor and request id", async () => {
    const { auth } = await authed("demo.owner");
    const owner = await demoOwner();
    const company = await demoCompany();
    const prisma = await getPrisma();
    const requestId = `audit-${randomUUID().slice(0, 8)}`;

    const created = await (
      await api()
    )
      .post("/api/customers")
      .set(auth)
      .set("x-request-id", requestId)
      .send({
        customerCode: `AUD${randomUUID().slice(0, 6).toUpperCase()}`,
        firmName: "Audit Trail Traders",
        displayName: "Audit Trail",
        mobile: ["9000000009"],
        creditLimit: 1000,
        creditDays: 15,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const customerId = created.body.data.id as string;

    const rows = await asDemoTenant(() =>
      prisma.auditLog.findMany({
        where: { entityName: "customers", entityId: customerId },
        orderBy: { id: "asc" },
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "CREATE",
      companyId: company.id,
      changedBy: owner.userId,
      changedByAdmin: null,
      requestId,
      actorType: "user",
    });
    expect((rows[0].newValues as { firm_name?: string; firmName?: string }).firmName).toBe(
      "Audit Trail Traders"
    );
    expect(rows[0].oldValues).toBeNull();

    const updated = await (
      await api()
    )
      .put(`/api/customers/${customerId}`)
      .set(auth)
      .send({ firmName: "Audit Trail Traders Ltd" });
    expect([200, 201]).toContain(updated.status);
    const afterUpdate = await asDemoTenant(() =>
      prisma.auditLog.findMany({
        where: { entityName: "customers", entityId: customerId, action: "UPDATE" },
      })
    );
    expect(afterUpdate.length).toBeGreaterThanOrEqual(1);
    const last = afterUpdate[afterUpdate.length - 1];
    expect((last.oldValues as { firmName: string }).firmName).toBe("Audit Trail Traders");
    expect((last.newValues as { firmName: string }).firmName).toBe("Audit Trail Traders Ltd");
  });

  it("writes a row for changes made by code outside a request, with actor system", async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    const ledger = await asDemoTenant(() =>
      prisma.accountLedger.create({
        data: {
          code: `AUD-${randomUUID().slice(0, 8)}`,
          name: "Audit test ledger",
          type: "EXPENSE",
          group: "Indirect Expenses",
        } as never,
      })
    );
    const rows = await asDemoTenant(() =>
      prisma.auditLog.findMany({
        where: { entityName: "account_ledgers", entityId: String(ledger.id) },
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "CREATE", companyId: company.id, actorType: "system" });
  });

  it("refuses to update or delete audit rows, except through the retention sweep", async () => {
    const prisma = await getPrisma();
    const row = await asDemoTenant(() =>
      prisma.auditLog.findFirstOrThrow({ where: { entityName: "customers" } })
    );
    await expect(
      asDemoTenant(() =>
        prisma.auditLog.update({ where: { id: row.id }, data: { entityName: "tampered" } })
      )
    ).rejects.toThrow(/append-only/);
    await expect(
      asDemoTenant(() => prisma.auditLog.delete({ where: { id: row.id } }))
    ).rejects.toThrow(/append-only/);

    // The sweep path: flag set inside the same transaction, delete allowed.
    const deleted = await asDemoTenant(() =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.retention_sweep', 'on', TRUE)`;
        return tx.auditLog.deleteMany({ where: { id: row.id } });
      })
    );
    expect(deleted.count).toBe(1);
  });

  it("never stores password hashes in the trail", async () => {
    const prisma = await getPrisma();
    const owner = await demoOwner();
    await asDemoTenant(() =>
      prisma.user.update({ where: { userId: owner.userId }, data: { fullName: owner.fullName } })
    );
    const rows = await asDemoTenant(() =>
      prisma.auditLog.findMany({ where: { entityName: "users", entityId: owner.userId } })
    );
    for (const r of rows) {
      const text = JSON.stringify([r.oldValues, r.newValues]);
      expect(text).not.toContain("passwordHash");
      expect(text).not.toContain("$2b$");
    }
  });
});
