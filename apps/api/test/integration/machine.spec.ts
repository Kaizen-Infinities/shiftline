import { describe, expect, it, beforeAll } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Machine master (characterisation, Phase 2-T #4 — docs/handoff/2026-09-13-commission-phase-2-
 * transition.md). This locks down today's behaviour of `apps/api/src/modules/machine/` so that
 * Phase 2 (P2-02, P2-04, P2-12) has a red test the moment it changes one of these paths:
 *
 *  - `machineStatus` is a single mutable column with no history: an update just overwrites it,
 *    with no timestamp of the transition and no guard on which status can follow which. P2-02
 *    replaces this with a timeline; the tests below assert the current bare-overwrite behaviour.
 *  - `operatorId` is a loose `String`, not a foreign key to any employee/user table — whatever
 *    string is sent is stored and returned verbatim. P2-12 will need to parse it later.
 *  - The module looks machines up with `byCode("machineId", ...)` (never `where: { machineId }`
 *    alone for a unique selector), matching the `@@unique([companyId, machineId])` convention.
 */
const sfx = Date.now().toString(36).slice(-5);
const CODE = `MC-${sfx}`;

let OWNER: { auth: Record<string, string> };

describe("machine master", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("creates a machine and returns the full row shape", async () => {
    const res = await (
      await api()
    )
      .post("/api/machines")
      .set(OWNER.auth)
      .send({
        machineId: CODE,
        machineName: `Test Injection Moulder ${sfx}`,
        technologyType: "INJECTION_MOULDING",
        machineType: "PRODUCTION",
        manufacturer: "Acme",
        modelNumber: "ACM-100",
        cycleTime: 30,
        // Not a foreign key today: any string is accepted and stored as-is (P2-12 will parse it).
        operatorId: "OP-42",
        description: "Characterisation test machine",
        targetTemperature: 210.5,
        targetLoadPercent: 80,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);

    const machine = res.body.data;
    expect(machine.machineId).toBe(CODE);
    expect(machine.machineName).toBe(`Test Injection Moulder ${sfx}`);
    expect(machine.technologyType).toBe("INJECTION_MOULDING");
    expect(machine.machineType).toBe("PRODUCTION");
    expect(machine.manufacturer).toBe("Acme");
    expect(machine.modelNumber).toBe("ACM-100");
    expect(Number(machine.cycleTime)).toBe(30);
    expect(machine.operatorId).toBe("OP-42");
    // machineStatus defaults to IDLE when the caller omits it.
    expect(machine.machineStatus).toBe("IDLE");
    expect(machine.isActive).toBe(true);
    expect(Number(machine.targetTemperature)).toBe(210.5);
    expect(Number(machine.targetLoadPercent)).toBe(80);
    expect(machine.id).toBeTruthy();
    expect(machine.companyId).toBeTruthy();
  });

  it("lists machines, scoped by search across machineId and machineName", async () => {
    const res = await (await api()).get("/api/machines").query({ search: CODE }).set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    // The envelope is { machines, total, page, totalPages } — not the { data, pageSize } shape
    // some other list endpoints use.
    expect(res.body.data.machines).toHaveLength(1);
    expect(res.body.data.machines[0].machineId).toBe(CODE);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.totalPages).toBe(1);
  });

  it("finds a machine by its business code, not its uuid", async () => {
    const res = await (await api()).get(`/api/machines/${CODE}`).set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.machineId).toBe(CODE);
  });

  it("updates machineStatus as a bare column overwrite, with no history and no transition guard", async () => {
    const first = await (
      await api()
    )
      .put(`/api/machines/${CODE}`)
      .set(OWNER.auth)
      .send({ machineStatus: "RUNNING", machineName: `${CODE} renamed` });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);
    expect(first.body.data.machineStatus).toBe("RUNNING");
    expect(first.body.data.machineName).toBe(`${CODE} renamed`);

    // Oddity, called out for P2-02: nothing stops an odd jump straight from RUNNING to BREAKDOWN,
    // and nothing records that the transition happened or what the previous status was.
    const second = await (
      await api()
    )
      .put(`/api/machines/${CODE}`)
      .set(OWNER.auth)
      .send({ machineStatus: "BREAKDOWN" });
    expect(second.status).toBe(200);
    expect(second.body.data.machineStatus).toBe("BREAKDOWN");

    const row = await asDemoTenant(async () => {
      const prisma = await getPrisma();
      return prisma.machine.findFirst({ where: { machineId: CODE } });
    });
    // The current status is all that is stored — there is no separate history table to check.
    expect(row?.machineStatus).toBe("BREAKDOWN");
  });

  it("retires a machine by flipping isActive — a plain column, not a separate retire endpoint", async () => {
    const res = await (
      await api()
    )
      .put(`/api/machines/${CODE}`)
      .set(OWNER.auth)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    // A "retired" machine is still returned by plain findAll/findById — isActive is not filtered
    // out anywhere in this module.
    const list = await (await api()).get("/api/machines").query({ search: CODE }).set(OWNER.auth);
    expect(list.body.data.machines.some((m: { machineId: string }) => m.machineId === CODE)).toBe(
      true
    );

    const found = await (await api()).get(`/api/machines/${CODE}`).set(OWNER.auth);
    expect(found.status).toBe(200);
    expect(found.body.data.isActive).toBe(false);
  });

  it("silently drops machineId sent in an update body instead of rejecting or applying it", async () => {
    // The update schema omits machineId from its body shape, and the zod object strips unknown
    // keys by default, so this is neither a validation error nor a rename — just a no-op field.
    const res = await (
      await api()
    )
      .put(`/api/machines/${CODE}`)
      .set(OWNER.auth)
      .send({ machineId: `SHOULD-NOT-APPLY-${sfx}`, description: "renamed via update" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.machineId).toBe(CODE);
    expect(res.body.data.description).toBe("renamed via update");
  });

  it("rejects a duplicate machine code within the same tenant", async () => {
    const res = await (await api()).post("/api/machines").set(OWNER.auth).send({
      machineId: CODE,
      machineName: "Duplicate of the first machine",
      technologyType: "EXTRUSION",
      machineType: "PRODUCTION",
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain(CODE);
  });

  it("rejects bad create input: missing machineName and an unknown technologyType", async () => {
    const res = await (
      await api()
    )
      .post("/api/machines")
      .set(OWNER.auth)
      .send({
        machineId: `BAD-${sfx}`,
        technologyType: "NOT_A_REAL_TYPE",
        machineType: "PRODUCTION",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
    const paths = (res.body.errors as { path: string }[]).map((e) => e.path);
    expect(paths).toContain("body.machineName");
    expect(paths).toContain("body.technologyType");
  });

  it("turns a Decimal(5,2) overflow on targetTemperature into a 400, not a 500", async () => {
    const res = await (
      await api()
    )
      .post("/api/machines")
      .set(OWNER.auth)
      .send({
        machineId: `TOOBIG-${sfx}`,
        machineName: "Too Hot",
        technologyType: "GRANULATION",
        machineType: "UTILITY",
        // Decimal(5,2) tops out at 999.99 — this is the module's own catch, not the generic
        // Prisma-error middleware, so the message is the specific one it wrote.
        targetTemperature: 10000,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(400);
    expect(res.body.message).toBe(
      "Target temperature value is too large. Maximum allowed is 999.99°C"
    );
  });

  it("404s updating a machine id that does not exist", async () => {
    const res = await (
      await api()
    )
      .put(`/api/machines/NOPE-${sfx}`)
      .set(OWNER.auth)
      .send({ machineName: "does not matter" });
    expect(res.status).toBe(404);
  });

  it("deletes a machine with no linked records outright — a hard delete, since it is unreferenced", async () => {
    const code2 = `DEL-${sfx}`;
    const create = await (await api()).post("/api/machines").set(OWNER.auth).send({
      machineId: code2,
      machineName: "Deletable machine",
      technologyType: "MIXING",
      machineType: "UTILITY",
    });
    expect(create.status).toBe(201);

    const del = await (await api()).delete(`/api/machines/${code2}`).set(OWNER.auth);
    expect(del.status).toBe(200);
    // The controller's ApiResponse carries no data on delete, so the key is absent, not null.
    expect(del.body.data).toBeUndefined();

    const after = await (await api()).get(`/api/machines/${code2}`).set(OWNER.auth);
    expect(after.status).toBe(404);
  });

  it("computes the next machine id from the last-created row's trailing digits", async () => {
    const before = await (await api()).get("/api/machines/next-id").set(OWNER.auth);
    expect(before.status).toBe(200);
    const nextId = before.body.data.nextId as string;

    // Use the suggested id itself so the increment is verifiable regardless of what other
    // characterisation suites in this run have already seeded into the shared demo tenant.
    const created = await (
      await api()
    )
      .post("/api/machines")
      .set(OWNER.auth)
      .send({
        machineId: nextId,
        machineName: `Next id probe ${sfx}`,
        technologyType: "RECYCLING",
        machineType: "UTILITY",
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);

    const after = await (await api()).get("/api/machines/next-id").set(OWNER.auth);
    const match = nextId.match(/\d+/);
    expect(match).not.toBeNull();
    const numberStr = match![0];
    const idx = nextId.indexOf(numberStr);
    const expectedNext =
      nextId.slice(0, idx) +
      String(parseInt(numberStr, 10) + 1).padStart(numberStr.length, "0") +
      nextId.slice(idx + numberStr.length);
    expect(after.body.data.nextId).toBe(expectedNext);
  });

  it("allows the same machine code to be reused in a different tenant", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Machine Tenant B", companyCode: `MCB-${sfx}` },
      })
    );

    // Uniqueness is per companyId via @@unique([companyId, machineId]), not global, so the exact
    // same business code the demo tenant already owns is free to use here.
    const created = await runAsTenant(other.id, () =>
      prisma.machine.create({
        data: { machineId: CODE, machineName: "Other tenant's machine" },
      })
    );
    expect(created.machineId).toBe(CODE);
    expect(
      await runAsTenant(other.id, () => prisma.machine.count({ where: { machineId: CODE } }))
    ).toBe(1);
    expect(
      await asDemoTenant(() => prisma.machine.count({ where: { machineId: CODE } }))
    ).toBeGreaterThanOrEqual(1);
  });

  it("refuses a user without the permission and hides another tenant's machines", async () => {
    const client = await api();
    // ACCOUNTS is not granted any "machines.*" key in ROLE_DEFS (provisioning.service.ts).
    const accounts = await authed("demo.accounts");
    expect((await client.get("/api/machines").set(accounts.auth)).status).toBe(403);

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Machine Tenant C", companyCode: `MCC-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.machine.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.machine.count())).toBeGreaterThan(0);
  });
});
