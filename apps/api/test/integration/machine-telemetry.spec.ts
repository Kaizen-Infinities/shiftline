import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { AUDITED_MODELS } from "../../src/lib/audited-models";
import { RETENTION_CLASSES } from "../../src/modules/retention/retention.policy";
import { machineTelemetryService } from "../../src/modules/machine-telemetry/machine-telemetry.service";
import { SimulatorAdapter } from "../../src/modules/machine-telemetry/providers/simulator.provider";
import { machineTelemetryPollHandler } from "../../src/jobs/machine-telemetry-poll.job";
import { QUEUES } from "../../src/lib/jobs";

/**
 * Machine telemetry (P2-01, M1): gateways, the signal-map translation, the simulator adapter,
 * ingestion (batching, dedup, cycle roll-up, gateway health) and the read side. Everything here
 * runs on SIMULATOR -- no hardware exists yet (P2-00), and it is the only adapter every
 * acceptance test can run against; OPCUA_EUROMAP77 and MODBUS_MQTT are unpinned stubs that
 * refuse to connect (proved directly below via the gateway-error path), EUROMAP63_FILE's real
 * file-poll mechanism is exercised in isolation only, not through a full ingestion run.
 *
 * The simulator resets to a fresh instance on every `pollGateway()` call (pg-boss jobs are
 * short-lived, not a held-open connection -- P2-00), so its script position is round-tripped
 * through the gateway's own `connectionSettings._cursor`. That mechanism doubles as the cleanest
 * way to prove idempotent redelivery: resetting `_cursor` back to an earlier value and polling
 * again reproduces the exact same raw samples, so a real "batch replay" is being proved, not a
 * mock of one.
 */
const sfx = Date.now().toString(36).slice(-6);
let seq = 0;
let OWNER: { auth: Record<string, string> };

const FULL_SIGNAL_MAP = [
  { vendorTag: "SIM.STATE", canonicalSignal: "STATE" as const },
  { vendorTag: "SIM.CYCLE_COMPLETE", canonicalSignal: "CYCLE_COMPLETE" as const },
  { vendorTag: "SIM.SHOT_COUNT", canonicalSignal: "SHOT_COUNT" as const },
  { vendorTag: "SIM.PART_COUNT", canonicalSignal: "PART_COUNT" as const },
  { vendorTag: "SIM.CYCLE_TIME", canonicalSignal: "CYCLE_TIME" as const },
  { vendorTag: "SIM.BARREL_TEMP", canonicalSignal: "BARREL_TEMP" as const },
  { vendorTag: "SIM.MOULD_TEMP", canonicalSignal: "MOULD_TEMP" as const },
  { vendorTag: "SIM.INJECTION_PRESSURE", canonicalSignal: "INJECTION_PRESSURE" as const },
  { vendorTag: "SIM.ALARM", canonicalSignal: "ALARM" as const },
];

const makeMachine = async () => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.machine.create({
      data: { machineId: `MT-${sfx}-${++seq}`, machineName: "Telemetry Test Press" },
    })
  );
};

const makeGateway = async (
  machineId: string,
  adapterKind: "SIMULATOR" | "OPCUA_EUROMAP77" | "EUROMAP63_FILE" | "MODBUS_MQTT" = "SIMULATOR"
) => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.machineGateway.create({
      data: { code: `GW-${sfx}-${++seq}`, machineId, adapterKind, connectionSettings: {} },
    })
  );
};

const seedFullSignalMap = async (gatewayId: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.machineSignalMap.createMany({
      data: FULL_SIGNAL_MAP.map((r) => ({ gatewayId, ...r })),
    })
  );
};

describe("machine telemetry", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("a seeded simulator run produces a deterministic signal sequence, including the jam and the recovery", async () => {
    const a = new SimulatorAdapter();
    await a.connect({}, {});
    const tick0 = await a.poll();
    expect(tick0).toEqual([
      {
        vendorTag: "SIM.STATE",
        timestamp: new Date("2030-01-01T00:00:00.000Z"),
        textValue: "SETUP",
      },
    ]);
    const tick1 = await a.poll();
    const tick2 = await a.poll();
    const tick3 = await a.poll();
    const tick4 = await a.poll(); // the jam
    const tick5 = await a.poll(); // the recovery

    // Two fresh instances with the same (default) seed reproduce tick 1 exactly, jitter included.
    const b = new SimulatorAdapter();
    await b.connect({}, {});
    await b.poll();
    const tick1b = await b.poll();
    expect(tick1b).toEqual(tick1);

    expect(tick1.find((s) => s.vendorTag === "SIM.STATE")?.textValue).toBe("RUNNING");
    expect(tick1.find((s) => s.vendorTag === "SIM.SHOT_COUNT")?.numericValue).toBe(1);
    expect(tick2.find((s) => s.vendorTag === "SIM.SHOT_COUNT")?.numericValue).toBe(2);
    expect(tick3.find((s) => s.vendorTag === "SIM.SHOT_COUNT")?.numericValue).toBe(3);

    expect(tick4.find((s) => s.vendorTag === "SIM.SHOT_COUNT")?.numericValue).toBe(4);
    expect(tick4.find((s) => s.vendorTag === "SIM.ALARM")?.textValue).toBe("E-204 SCREW_JAM");
    expect(tick4.find((s) => s.vendorTag === "SIM.STATE")?.textValue).toBe("BREAKDOWN");

    expect(tick5.find((s) => s.vendorTag === "SIM.ALARM")?.textValue).toBe("");
    expect(tick5.find((s) => s.vendorTag === "SIM.STATE")?.textValue).toBe("RUNNING");
    expect(tick5.some((s) => s.vendorTag === "SIM.SHOT_COUNT")).toBe(false); // no cycle this tick

    // Every sample in one tick shares that tick's timestamp.
    const ts = new Set(tick1.map((s) => s.timestamp.getTime()));
    expect(ts.size).toBe(1);
  });

  it("the signal map translates a vendor tag to a canonical signal, and an unmapped tag is dropped with a counter, not an exception", async () => {
    const prisma = await getPrisma();
    const machine = await makeMachine();
    const gateway = await makeGateway(machine.machineId);
    // Map only STATE; every other tag the simulator emits stays untranslated.
    await asDemoTenant(() =>
      prisma.machineSignalMap.create({
        data: { gatewayId: gateway.id, vendorTag: "SIM.STATE", canonicalSignal: "STATE" },
      })
    );

    const tick0 = await asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id));
    expect(tick0.samplesWritten).toBe(1); // SETUP
    expect(tick0.droppedUnmapped).toBe(0);

    const tick1 = await asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id));
    expect(tick1.samplesWritten).toBe(1); // STATE=RUNNING
    // completeCycle() emits 7 tags (CYCLE_COMPLETE, SHOT_COUNT, PART_COUNT, CYCLE_TIME + 3 temps),
    // none of them mapped.
    expect(tick1.droppedUnmapped).toBe(7);

    const stateRows = await asDemoTenant(() =>
      prisma.machineSignal.count({ where: { gatewayId: gateway.id, signal: "STATE" } })
    );
    expect(stateRows).toBe(2);
    const otherRows = await asDemoTenant(() =>
      prisma.machineSignal.count({ where: { gatewayId: gateway.id, signal: { not: "STATE" } } })
    );
    expect(otherRows).toBe(0);
  });

  it("a flush writes one batch, cycles roll up with the expected count and durations, and a replayed batch adds no duplicate rows", async () => {
    const prisma = await getPrisma();
    const machine = await makeMachine();
    const gateway = await makeGateway(machine.machineId);
    await seedFullSignalMap(gateway.id);

    let totalSamples = 0;
    let totalCyclesAttempted = 0;
    for (let i = 0; i < 9; i++) {
      const result = await asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id));
      totalSamples += result.samplesWritten;
      totalCyclesAttempted += result.cyclesRolledUp;
    }
    // Ticks 1,2,3,4,6,7 each complete one cycle (tick 4 is the jam, which still completes its
    // cycle before the alarm); 0, 5 and 8 (loop restart) do not.
    expect(totalCyclesAttempted).toBe(6);
    expect(totalSamples).toBe(51);

    const signalCount = await asDemoTenant(() =>
      prisma.machineSignal.count({ where: { gatewayId: gateway.id } })
    );
    expect(signalCount).toBe(51);
    const cycles = await asDemoTenant(() =>
      prisma.machineCycle.findMany({
        where: { gatewayId: gateway.id },
        orderBy: { endedAt: "asc" },
      })
    );
    expect(cycles).toHaveLength(6);
    for (const c of cycles) {
      // CYCLE_SECONDS is 24.5 with +/-0.3 jitter.
      expect(Number(c.actualCycleSeconds)).toBeGreaterThan(24);
      expect(Number(c.actualCycleSeconds)).toBeLessThan(25);
      expect(c.partsProduced).toBe(1);
      expect(c.endedAt.getTime() - c.startedAt.getTime()).toBeCloseTo(
        Number(c.actualCycleSeconds) * 1000,
        -1
      );
    }

    // Replay tick 0 (no cycle) by resetting the cursor: the exact same STATE=SETUP sample comes
    // back and is silently deduplicated, not inserted again.
    await asDemoTenant(() =>
      prisma.machineGateway.update({ where: { id: gateway.id }, data: { connectionSettings: {} } })
    );
    const replayedTick0 = await asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id));
    expect(replayedTick0.samplesWritten).toBe(1); // still "processed" -- see PollResult's own doc
    expect(
      await asDemoTenant(() => prisma.machineSignal.count({ where: { gatewayId: gateway.id } }))
    ).toBe(51); // unchanged: the row already existed

    // Replay tick 1 (a cycle-completing tick) the same way: the cycle roll-up is idempotent too.
    await asDemoTenant(() =>
      prisma.machineGateway.update({
        where: { id: gateway.id },
        data: { connectionSettings: { _cursor: 1 } },
      })
    );
    await asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id));
    expect(
      await asDemoTenant(() => prisma.machineCycle.count({ where: { gatewayId: gateway.id } }))
    ).toBe(6); // unchanged, not 7
  });

  it("the poll job is idempotent when pg-boss re-delivers", async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    const machine = await makeMachine();
    const gateway = await makeGateway(machine.machineId);
    await seedFullSignalMap(gateway.id);

    const job = () => ({
      id: randomUUID(),
      name: QUEUES.MACHINE_TELEMETRY_POLL,
      data: { companyId: company.id, gatewayId: gateway.id },
    });
    const first = await machineTelemetryPollHandler(job() as never);
    expect(first.ok).toBe(true);
    const countAfterFirst = await asDemoTenant(() =>
      prisma.machineSignal.count({ where: { gatewayId: gateway.id } })
    );
    expect(countAfterFirst).toBe(1); // tick0: SETUP only

    // A genuine redelivery is indistinguishable, from the cursor's point of view, from the
    // cursor update never having committed -- reset it to prove the handler is safe either way.
    await asDemoTenant(() =>
      prisma.machineGateway.update({ where: { id: gateway.id }, data: { connectionSettings: {} } })
    );
    const redelivered = await machineTelemetryPollHandler(job() as never);
    expect(redelivered.ok).toBe(true);
    expect(
      await asDemoTenant(() => prisma.machineSignal.count({ where: { gatewayId: gateway.id } }))
    ).toBe(countAfterFirst);
  });

  it("a gateway error sets lastError and notifies once across three failing polls", async () => {
    const prisma = await getPrisma();
    const machine = await makeMachine();
    // MODBUS_MQTT always refuses to connect (unpinned -- P2-00's adapter posture).
    const gateway = await makeGateway(machine.machineId, "MODBUS_MQTT");

    const notifiedBefore = await asDemoTenant(() =>
      prisma.notification.count({ where: { category: "machine-telemetry" } })
    );

    for (let attempt = 1; attempt <= 2; attempt++) {
      await expect(
        asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id))
      ).rejects.toThrow(/unpinned/);
      const row = await asDemoTenant(() =>
        prisma.machineGateway.findUniqueOrThrow({ where: { id: gateway.id } })
      );
      expect(row.consecutiveFailures).toBe(attempt);
      expect(row.lastError).toMatch(/unpinned/);
      expect(row.lastErrorAt).not.toBeNull();
    }
    expect(
      await asDemoTenant(() =>
        prisma.notification.count({ where: { category: "machine-telemetry" } })
      )
    ).toBe(notifiedBefore); // not yet at the threshold

    await expect(
      asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id))
    ).rejects.toThrow(/unpinned/);
    const notifiedAfterThree = await asDemoTenant(() =>
      prisma.notification.count({ where: { category: "machine-telemetry" } })
    );
    // One notification round on the third failure -- one row per recipient holding
    // machine-telemetry.view (demo.owner and demo.production both do), not per poll.
    expect(notifiedAfterThree).toBeGreaterThan(notifiedBefore);

    // A fourth failure does not notify again.
    await expect(
      asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id))
    ).rejects.toThrow(/unpinned/);
    expect(
      await asDemoTenant(() =>
        prisma.notification.count({ where: { category: "machine-telemetry" } })
      )
    ).toBe(notifiedAfterThree);

    // A successful poll (switch to SIMULATOR, same row) clears the error and resets the streak.
    await asDemoTenant(() =>
      prisma.machineGateway.update({
        where: { id: gateway.id },
        data: { adapterKind: "SIMULATOR" },
      })
    );
    await asDemoTenant(() => machineTelemetryService.pollGateway(gateway.id));
    const recovered = await asDemoTenant(() =>
      prisma.machineGateway.findUniqueOrThrow({ where: { id: gateway.id } })
    );
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.lastError).toBeNull();
  });

  it("creates a gateway over HTTP, never returns credentials, and CRUD works", async () => {
    const client = await api();
    const machine = await makeMachine();

    const created = await client
      .post("/api/machine-gateways")
      .set(OWNER.auth)
      .send({
        code: `GW-HTTP-${sfx}`,
        machineId: machine.machineId,
        adapterKind: "SIMULATOR",
        credentials: { apiKey: "super-secret-value" },
        pollIntervalSeconds: 15,
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(created.body.data.hasCredentials).toBe(true);
    expect(JSON.stringify(created.body)).not.toMatch(/super-secret-value/);
    expect(created.body.data.credentialsEncrypted).toBeUndefined();

    const prisma = await getPrisma();
    const dbRow = await asDemoTenant(() =>
      prisma.machineGateway.findUniqueOrThrow({ where: { id: created.body.data.id } })
    );
    expect(dbRow.credentialsEncrypted).not.toBeNull();
    expect(dbRow.credentialsEncrypted).not.toMatch(/super-secret-value/);

    const listed = await client.get("/api/machine-gateways").set(OWNER.auth);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toMatch(/super-secret-value/);

    const updated = await client
      .put(`/api/machine-gateways/${created.body.data.id}`)
      .set(OWNER.auth)
      .send({ isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.isActive).toBe(false);
    expect(updated.body.data.hasCredentials).toBe(true); // untouched by an update that omits it

    const testConn = await client
      .post(`/api/machine-gateways/${created.body.data.id}/test-connection`)
      .set(OWNER.auth)
      .send({});
    expect(testConn.status).toBe(200);
    expect(testConn.body.data.ok).toBe(true);

    const deleted = await client
      .delete(`/api/machine-gateways/${created.body.data.id}`)
      .set(OWNER.auth);
    expect(deleted.status).toBe(200);
    const gone = await client.get(`/api/machine-gateways/${created.body.data.id}`).set(OWNER.auth);
    expect(gone.status).toBe(404);
  });

  it("the signal-map editor round-trips via HTTP, retiring rather than deleting a removed mapping", async () => {
    const client = await api();
    const machine = await makeMachine();
    const gateway = await makeGateway(machine.machineId);

    const canon = await client.get("/api/machine-telemetry/canonical-signals").set(OWNER.auth);
    expect(canon.status).toBe(200);
    expect((canon.body.data as { signal: string }[]).map((s) => s.signal)).toContain(
      "CYCLE_COMPLETE"
    );

    const first = await client
      .put(`/api/machine-gateways/${gateway.id}/signal-map`)
      .set(OWNER.auth)
      .send({ rows: [{ vendorTag: "SIM.STATE", canonicalSignal: "STATE" }] });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);
    expect(first.body.data).toHaveLength(1);

    const replaced = await client
      .put(`/api/machine-gateways/${gateway.id}/signal-map`)
      .set(OWNER.auth)
      .send({ rows: [{ vendorTag: "SIM.CYCLE_COMPLETE", canonicalSignal: "CYCLE_COMPLETE" }] });
    expect(replaced.status).toBe(200);
    const rows = replaced.body.data as { vendorTag: string; isActive: boolean }[];
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
    expect(rows.find((r) => r.vendorTag === "SIM.CYCLE_COMPLETE")?.isActive).toBe(true);
    const retired = rows.find((r) => r.vendorTag === "SIM.STATE");
    expect(retired).toBeTruthy();
    expect(retired!.isActive).toBe(false); // retired, not deleted
  });

  it("MachineSignal is absent from AUDITED_MODELS and present in RETENTION_CLASSES, so a later change cannot quietly add a trigger per sample", () => {
    expect(AUDITED_MODELS).not.toContain("MachineSignal");
    expect(AUDITED_MODELS).toContain("MachineGateway");
    expect(AUDITED_MODELS).toContain("MachineSignalMap");
    expect(AUDITED_MODELS).toContain("MachineCycle");
    expect(RETENTION_CLASSES.MACHINE_TELEMETRY).toBeDefined();
    expect(RETENTION_CLASSES.MACHINE_TELEMETRY.purgeable).toBe(true);
  });

  it("refuses a role without machine-telemetry.view, and grants demo.production access", async () => {
    const client = await api();
    const stores = await authed("demo.stores");
    expect((await client.get("/api/machine-gateways").set(stores.auth)).status).toBe(403);

    const production = await authed("demo.production");
    expect((await client.get("/api/machine-gateways").set(production.auth)).status).toBe(200);
  });

  it("a gateway of tenant B is invisible and un-pollable from tenant A", async () => {
    const prisma = await getPrisma();
    const client = await api();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Telemetry Tenant B", companyCode: `MTB-${sfx}` },
      })
    );
    const otherMachine = await runAsTenant(other.id, () =>
      prisma.machine.create({ data: { machineId: `MT-B-${sfx}`, machineName: "Tenant B Press" } })
    );
    const otherGateway = await runAsTenant(other.id, () =>
      prisma.machineGateway.create({
        data: {
          code: `GW-B-${sfx}`,
          machineId: otherMachine.machineId,
          adapterKind: "SIMULATOR",
          connectionSettings: {},
        },
      })
    );

    const res = await client.get(`/api/machine-gateways/${otherGateway.id}`).set(OWNER.auth);
    expect(res.status).toBe(404);

    await expect(
      asDemoTenant(() => machineTelemetryService.pollGateway(otherGateway.id))
    ).rejects.toThrow(/not found/i);

    expect(await runAsTenant(other.id, () => prisma.machineGateway.count())).toBe(1);
    expect(await asDemoTenant(() => prisma.machineGateway.count())).toBeGreaterThan(0);
  });
});
