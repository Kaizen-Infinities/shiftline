import { describe, it, expect, beforeAll } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct } from "../factories";
import oeeService, { calculateOeeMetrics } from "../../src/modules/oee/oee.service";

/**
 * Characterisation tests for OEE (Phase 2-T brief, section 4): the shop floor's
 * Availability x Performance x Quality dashboard.
 *
 * There is no "recompute" route -- hourly-production.service.ts calls
 * oeeService.recalculateAndSaveSnapshot() after saving hourly output, and only
 * the two read endpoints (machine summary, all-machines status) plus the
 * production-order summary are mounted. The first test below used to pin down a
 * genuine, live bug in that write path (a compound-unique key name that didn't match the
 * schema's generated one, so every upsert was rejected and no snapshot was ever written
 * through the normal flow) -- fixed as P2T-04 bug #2; the test now proves the upsert works.
 * The rest of the suite characterises the read side and the named P2-04 gap around it.
 */
const sfx = Date.now().toString(36).slice(-5);
const DATE = "2031-02-10";
const PROD_DATE = new Date(`${DATE}T00:00:00.000Z`);

describe("OEE dashboard", () => {
  let OWNER: { auth: Record<string, string> };
  let product: { id: bigint; productName: string };

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    product = await createProduct();
  });

  it("recalculateAndSaveSnapshot writes a real snapshot row (P2T-04 bug #2, fixed)", async () => {
    // MachineOeeSnapshot's real unique selector, from `@@unique([companyId, machineId,
    // productionDate, shiftId])` in schema.prisma, is `companyId_machineId_productionDate_shiftId`
    // (confirmed against the generated Prisma client's MachineOeeSnapshotWhereUniqueInput). The
    // service's upsert used to name it `machineId_productionDate_shiftId` -- missing the
    // companyId prefix -- which Prisma's client-side validation rejected as an unknown argument;
    // hourly-production.service.ts's try/catch around this call ("OEE calculation errors should
    // not fail the main operation") silently swallowed every failure, so no MachineOeeSnapshot
    // row was ever written through the normal flow. Fixed by using the correct compound key.
    const prisma = await getPrisma();
    const machine = await asDemoTenant(() =>
      prisma.machine.create({ data: { machineId: `M-FIXED-${sfx}`, machineName: "Fixed Press" } })
    );

    await asDemoTenant(() =>
      oeeService.recalculateAndSaveSnapshot({
        machineId: machine.machineId,
        productionDate: DATE,
        shiftId: `SFT-FIXED-${sfx}`,
      })
    );

    const snapshot = await asDemoTenant(() =>
      prisma.machineOeeSnapshot.findFirstOrThrow({
        where: { machineId: machine.machineId, productionDate: PROD_DATE },
      })
    );
    expect(snapshot.shiftId).toBe(`SFT-FIXED-${sfx}`);
    // No hourly output was logged for this machine/date, so every aggregate is zero.
    expect(Number(snapshot.totalProduced)).toBe(0);

    // Calling it again for the same machine/date/shift upserts the same row rather than
    // duplicating it.
    await asDemoTenant(() =>
      oeeService.recalculateAndSaveSnapshot({
        machineId: machine.machineId,
        productionDate: DATE,
        shiftId: `SFT-FIXED-${sfx}`,
      })
    );
    expect(
      await asDemoTenant(() =>
        prisma.machineOeeSnapshot.count({
          where: { machineId: machine.machineId, productionDate: PROD_DATE },
        })
      )
    ).toBe(1);
  });

  it("computes a production order's OEE from its hourly output, and always reports 100% performance there regardless of the machine's cycle time", async () => {
    const prisma = await getPrisma();
    const client = await api();

    const po = await asDemoTenant(async () => {
      const shift = await prisma.shift.create({
        data: {
          shiftCode: `SFT-A-${sfx}`,
          shiftName: `OEE Shift A ${sfx}`,
          startTime: "08:00",
          endTime: "16:00",
        },
      });
      const machine = await prisma.machine.create({
        data: { machineId: `M-PO-${sfx}`, machineName: "OEE PO Press", cycleTime: 60 },
      });
      const order = await prisma.productionOrder.create({
        data: {
          productionOrderId: `PO-A-${sfx}`,
          orderDate: new Date(),
          productItemId: product.id,
          targetQty: 1000,
          uom: "NOS",
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
      await prisma.hourlyProduction.create({
        data: {
          productionOrderId: order.productionOrderId,
          productionDate: PROD_DATE,
          shiftId: shift.shiftCode,
          machineId: machine.machineId,
          hourIndex: 1,
          qtyProduced: 350,
          rejectQty: 20,
          scrapQty: 10,
          downtime: 30,
          runtimeMinutes: 480,
        },
      });
      return order;
    });

    const res = await client
      .get(`/api/oee/production-order/${po.productionOrderId}`)
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const data = res.body.data;
    expect(data.productionOrderId).toBe(po.productionOrderId);
    expect(data.productName).toBe(product.productName);
    expect(data.targetQty).toBe(1000);
    expect(data.producedQty).toBe(350);
    // Good qty = produced - reject - scrap = 350 - 20 - 10.
    expect(data.goodQty).toBe(320);
    expect(data.rejectQty).toBe(20);
    expect(data.scrapQty).toBe(10);
    expect(data.wasteQty).toBe(0);
    expect(data.remainingQty).toBe(650);
    expect(data.runtimeMinutes).toBe(480);
    expect(data.downtimeMinutes).toBe(30);
    // No DailyProductionPlan exists for this order, so `totalPlannedMinutes` is 0 and the service
    // falls back to `totalPlannedMinutes || totalRuntime` -- planned time becomes the runtime
    // itself. Availability = (480 - 30) / 480 = 93.75%, matching the machine-level shift minutes
    // only by coincidence.
    expect(data.availability).toBe(93.75);
    // getProductionOrderOeeSummary's call to calculateOeeMetrics never passes cycleTimeSeconds at
    // all, so performance is pinned at the 100% default for every production order, regardless of
    // the machine's actual cycle time (60s here) -- a second, related gap alongside the
    // machine-level one named in the Phase 2-T brief.
    expect(data.performance).toBe(100);
    // Quality = 320 good / 350 produced.
    expect(data.quality).toBe(91.43);
    expect(data.oeePercent).toBe(85.71);
  });

  it("reads back a machine's OEE snapshot and surfaces it on the machines status list", async () => {
    const prisma = await getPrisma();
    const client = await api();

    // The write path is exercised directly in the first test above; this one inserts the
    // MachineOeeSnapshot row directly instead, to test the read side (getMachineOeeSummary,
    // getAllMachinesStatus) in isolation, using calculateOeeMetrics for the same arithmetic the
    // service's upsert would itself have produced.
    const oee = calculateOeeMetrics({
      plannedRunTimeMinutes: 480,
      totalRuntimeMinutes: 480,
      totalDowntimeMinutes: 30,
      totalProduced: 350,
      totalReject: 20,
      totalScrap: 10,
      cycleTimeSeconds: 60,
    });
    expect(oee).toEqual({
      availability: 93.75,
      performance: 77.78,
      quality: 91.43,
      oeePercent: 66.67,
      goodQty: 320,
    });

    const machine = await asDemoTenant(async () => {
      const shift = await prisma.shift.create({
        data: {
          shiftCode: `SFT-B-${sfx}`,
          shiftName: `OEE Shift B ${sfx}`,
          startTime: "08:00",
          endTime: "16:00",
        },
      });
      const m = await prisma.machine.create({
        data: { machineId: `M-SUM-${sfx}`, machineName: "OEE Summary Press", cycleTime: 60 },
      });
      const order = await prisma.productionOrder.create({
        data: {
          productionOrderId: `PO-B-${sfx}`,
          orderDate: new Date(),
          productItemId: product.id,
          targetQty: 1000,
          uom: "NOS",
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
      await prisma.hourlyProduction.create({
        data: {
          productionOrderId: order.productionOrderId,
          productionDate: PROD_DATE,
          shiftId: shift.shiftCode,
          machineId: m.machineId,
          hourIndex: 1,
          qtyProduced: 350,
          rejectQty: 20,
          scrapQty: 10,
          downtime: 30,
          runtimeMinutes: 480,
        },
      });
      await prisma.machineOeeSnapshot.create({
        data: {
          machineId: m.machineId,
          productionDate: PROD_DATE,
          shiftId: shift.shiftCode,
          plannedRunTime: 480,
          actualRunTime: 450,
          totalDowntime: 30,
          totalProduced: 350,
          goodQty: oee.goodQty,
          rejectQty: 20,
          availability: oee.availability,
          performance: oee.performance,
          quality: oee.quality,
          oeePercent: oee.oeePercent,
        },
      });
      return m;
    });

    const res = await client
      .get(`/api/oee/machine/${machine.machineId}/summary`)
      .query({ date: DATE })
      .set(OWNER.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const data = res.body.data;
    expect(data.machineId).toBe(machine.machineId);
    expect(data.machineName).toBe("OEE Summary Press");
    expect(data.machineStatus).toBe("IDLE");
    expect(data.oeeToday).toEqual({
      availability: 93.75,
      performance: 77.78,
      quality: 91.43,
      oeePercent: 66.67,
    });
    expect(data.snapshots).toHaveLength(1);
    // downtimeToday comes straight off the hourly-production aggregate, not off the snapshot.
    expect(data.downtimeToday).toBe(30);
    expect(data.todayPlannedHours).toBe(0);
    expect(data.runningOrdersCount).toBe(0);

    const statusRes = await client
      .get("/api/oee/machines/status")
      .query({ date: DATE })
      .set(OWNER.auth);
    expect(statusRes.status).toBe(200);
    const row = (statusRes.body.data as any[]).find((m) => m.machineId === machine.machineId);
    expect(row).toBeTruthy();
    expect(row.currentOee).toBe(66.67);
    expect(row.availability).toBe(93.75);
    expect(row.performance).toBe(77.78);
    expect(row.quality).toBe(91.43);
    // No DailyProductionPlan was created for this machine/date, so nothing reads as "active".
    expect(row.activeProductionOrderId).toBeNull();
    expect(row.currentShift).toBeNull();
  });

  it("defaults performance to 100% when the machine's cycle time is unset, however low the actual output (the gap named in the Phase 2-T brief, P2-04)", async () => {
    const prisma = await getPrisma();
    const client = await api();

    // Pinned at the pure-formula level first, independent of any storage concern: with no cycle
    // time, performance short-circuits to 100 even though 10 pieces in 380 run-minutes would be a
    // few percent under any real cycle time.
    const oee = calculateOeeMetrics({
      plannedRunTimeMinutes: 480,
      totalRuntimeMinutes: 480,
      totalDowntimeMinutes: 100,
      totalProduced: 10,
      totalReject: 0,
      totalScrap: 0,
      cycleTimeSeconds: null,
    });
    expect(oee.performance).toBe(100);
    expect(oee.availability).toBe(79.17);
    expect(oee.quality).toBe(100);
    expect(oee.oeePercent).toBe(79.17);

    // And the same value read back off the machine summary endpoint, via a directly-inserted
    // snapshot for the reason given in the previous test.
    const machine = await asDemoTenant(async () => {
      const shift = await prisma.shift.create({
        data: {
          shiftCode: `SFT-C-${sfx}`,
          shiftName: `OEE Shift C ${sfx}`,
          startTime: "08:00",
          endTime: "16:00",
        },
      });
      const m = await prisma.machine.create({
        data: { machineId: `M-GAP-${sfx}`, machineName: "No Cycle Time Press" },
      });
      const order = await prisma.productionOrder.create({
        data: {
          productionOrderId: `PO-C-${sfx}`,
          orderDate: new Date(),
          productItemId: product.id,
          targetQty: 500,
          uom: "NOS",
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
      await prisma.hourlyProduction.create({
        data: {
          productionOrderId: order.productionOrderId,
          productionDate: PROD_DATE,
          shiftId: shift.shiftCode,
          machineId: m.machineId,
          hourIndex: 1,
          qtyProduced: 10,
          downtime: 100,
          runtimeMinutes: 480,
        },
      });
      await prisma.machineOeeSnapshot.create({
        data: {
          machineId: m.machineId,
          productionDate: PROD_DATE,
          shiftId: shift.shiftCode,
          plannedRunTime: 480,
          actualRunTime: 380,
          totalDowntime: 100,
          totalProduced: 10,
          goodQty: oee.goodQty,
          rejectQty: 0,
          availability: oee.availability,
          performance: oee.performance,
          quality: oee.quality,
          oeePercent: oee.oeePercent,
        },
      });
      return m;
    });

    const res = await client
      .get(`/api/oee/machine/${machine.machineId}/summary`)
      .query({ date: DATE })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.oeeToday.performance).toBe(100);
  });

  it("404s for a machine id and a production order id that do not exist", async () => {
    const client = await api();
    const badMachine = await client.get(`/api/oee/machine/NOPE-${sfx}/summary`).set(OWNER.auth);
    expect(badMachine.status).toBe(404);
    expect(badMachine.body.message).toBe(`Machine NOPE-${sfx} not found`);

    const badOrder = await client.get(`/api/oee/production-order/NOPE-PO-${sfx}`).set(OWNER.auth);
    expect(badOrder.status).toBe(404);
    expect(badOrder.body.message).toBe(`Production Order NOPE-PO-${sfx} not found`);
  });

  it("grants the Production/Supervisor role oee-dashboard.view, and hides another tenant's OEE snapshots", async () => {
    const client = await api();
    const production = await authed("demo.production");
    // Fixed (P2T-04 bug #1): ROLE_DEFS's PRODUCTION entry (provisioning.service.ts) used to list
    // module "oee", but the permission registry (packages/shared/src/permissions.ts) registers
    // this dashboard's module as "oee-dashboard" -- so the shop-floor role that most plausibly
    // needs it held no oee-dashboard key at all. Now that the names agree, it does.
    expect(
      (await client.get(`/api/oee/machine/M-ANY-${sfx}/summary`).set(production.auth)).status
    ).toBe(404); // the role can now reach the route; M-ANY-<sfx> just isn't a real machine.

    const accounts = await authed("demo.accounts");
    expect(
      (await client.get(`/api/oee/machine/M-ANY-${sfx}/summary`).set(accounts.auth)).status
    ).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "OEE Tenant B", companyCode: `OEEB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.machineOeeSnapshot.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.machineOeeSnapshot.count())).toBeGreaterThan(0);
  });
});
