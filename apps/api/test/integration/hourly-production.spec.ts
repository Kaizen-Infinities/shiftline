import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { getISTDateString } from "../../src/utils/dateUtils";

/**
 * Hourly production (characterisation, Phase 2-T #4 — docs/archive/handoff/2026-09-13-commission-
 * phase-2-transition.md). Locks down today's behaviour of
 * `apps/api/src/modules/hourly-production/` so Phase 2's OEE and stock-movement work (P2-04,
 * P2-08) has a red test the moment it changes one of these paths.
 *
 * The entry point, `validateHourlyEntry`, requires a matching `WeeklyMachineProgram` row for the
 * machine/shift/date/production-order (an explicit `dailyPlanId`, or a `DailyProductionPlan` found
 * by coordinate, is optional and only checked when one exists) — with no matching weekly program
 * the entry is refused even before the production order or machine/shift existence is otherwise
 * used. Machine and Shift existence themselves are never checked in validation; only the eventual
 * insert's foreign keys would catch a bogus one.
 *
 * `2020-02-10` is a Monday, so it doubles as its own `weekStartDate`/`dayOfWeek` for the weekly
 * program fixture below. It must be a past date: entries for future dates or future hour slots are
 * refused (H33).
 */
const sfx = Date.now().toString(36).slice(-5);
const PRODUCTION_DATE = "2020-02-10";
const WEEK_START = new Date(Date.UTC(2020, 1, 10));
const WEEK_END = new Date(Date.UTC(2020, 1, 16));

/** Monday of the week holding a calendar date (YYYY-MM-DD), its Sunday, and dayOfWeek (Mon=1). */
const scheduleFor = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = day.getUTCDay() || 7;
  const monday = new Date(day.getTime() - (dayOfWeek - 1) * 86_400_000);
  return { monday, sunday: new Date(monday.getTime() + 6 * 86_400_000), dayOfWeek };
};

let OWNER: { auth: Record<string, string> };

describe("hourly production", () => {
  let machineId: string;
  let shiftId: string;
  let productionOrderId: string;
  let plannedQty: number;

  beforeAll(async () => {
    OWNER = await authed("demo.owner");

    const prisma = await getPrisma();
    const product = await createProduct();

    machineId = `M-${sfx}`;
    shiftId = `SH-${sfx}`;
    productionOrderId = `PO-${sfx}`;
    plannedQty = 500;

    await asDemoTenant(async () => {
      await prisma.machine.create({
        data: { machineId, machineName: `Test Machine ${sfx}` },
      });
      // 06:00-14:00 is an 8-hour shift, so hourIndex 8 would be "last hour" (auto-stops the
      // weekly program and logs a synthetic SYSTEM_STOP entry) — the tests below stay under that.
      await prisma.shift.create({
        data: {
          shiftCode: shiftId,
          shiftName: `Test Shift ${sfx}`,
          startTime: "06:00",
          endTime: "14:00",
        },
      });
      await prisma.productionOrder.create({
        data: {
          productionOrderId,
          orderDate: new Date("2031-02-01T00:00:00.000Z"),
          dueDate: new Date("2031-02-28T00:00:00.000Z"),
          productItemId: product.id,
          targetQty: 1000,
          uom: "NOS",
        },
      });
      // Required for validateHourlyEntry to accept the entry at all (no daily plan is used here).
      await prisma.weeklyMachineProgram.create({
        data: {
          weeklyProgramId: `WP-${sfx}`,
          weekStartDate: WEEK_START,
          weekEndDate: WEEK_END,
          dayOfWeek: 1,
          machineId,
          shiftId,
          productionOrderId,
          plannedQty,
        },
      });
    });
  });

  it("records an hour of production, and the list/detail views compute OEE for it", async () => {
    const client = await api();
    const create = await client.post("/api/hourly-productions").set(OWNER.auth).send({
      productionOrderId,
      productionDate: PRODUCTION_DATE,
      shiftId,
      machineId,
      hourIndex: 1,
      qtyProduced: 50,
      rejectQty: 5,
      scrapQty: 2,
    });
    expect(create.status, JSON.stringify(create.body).slice(0, 300)).toBe(201);
    const log = create.body.data;
    expect(Number(log.qtyProduced)).toBe(50);
    expect(log.newHighReached).toBe(false);
    // The response embeds the production order as it was fetched at insert time, *before*
    // syncProductionOrderQuantities (later in the same transaction) rolls the new totals in — so
    // the embedded row is one step stale. Characterized as-is.
    expect(log.productionOrder.status).toBe("CREATED");
    expect(Number(log.productionOrder.producedQty)).toBe(0);

    const prisma = await getPrisma();
    const order = await asDemoTenant(() =>
      prisma.productionOrder.findFirstOrThrow({ where: { productionOrderId } })
    );
    // The real row was updated: 50 produced is short of the 1000 target, so status moved off
    // CREATED to IN_PROGRESS (aggregated over every hourly log for this order, not just this one).
    expect(order.status).toBe("IN_PROGRESS");
    expect(Number(order.producedQty)).toBe(50);
    expect(Number(order.rejectedQty)).toBe(5);
    expect(Number(order.scrapQty)).toBe(2);

    const program = await asDemoTenant(() =>
      prisma.weeklyMachineProgram.findFirstOrThrow({ where: { weeklyProgramId: `WP-${sfx}` } })
    );
    // A DRAFT program is bumped to IN_PROGRESS by the first hourly entry against it.
    expect(program.status).toBe("IN_PROGRESS");

    const list = await client
      .get("/api/hourly-productions")
      .query({ productionOrderId, machineId, shiftId, productionDate: PRODUCTION_DATE })
      .set(OWNER.auth);
    expect(list.status, JSON.stringify(list.body).slice(0, 300)).toBe(200);
    const row = list.body.data.find(
      (r: any) => String(r.hourlyProductionId) === String(log.hourlyProductionId)
    );
    expect(row).toBeTruthy();
    // goodQty = 50 - 5 - 2 = 43; no downtime and the default 60-minute slot give 100% availability;
    // quality is 43/50; performance has no per-slot cycle time so it is hard-coded to 100.
    expect(row.goodQty).toBe(43);
    expect(row.availabilityPct).toBe(100);
    expect(row.qualityPct).toBe(86);
    expect(row.performancePct).toBe(100);
    expect(row.hourlyOEE).toBe(86);
    expect(row.operatorName).toBeNull();
    // Picked up from the weekly program fixture by machine/shift/date coordinate.
    expect(row.shiftPlannedQty).toBe(plannedQty);
    expect(row.weeklyProgramId).toBe(`WP-${sfx}`);

    const byId = await client
      .get(`/api/hourly-productions/${log.hourlyProductionId}`)
      .set(OWNER.auth);
    expect(byId.status).toBe(200);
    expect(byId.body.data.machineId).toBe(machineId);
  });

  it("refuses an entry dated after today (IST)", async () => {
    // 48 hours ahead is always at least one IST calendar day in the future.
    const future = getISTDateString(new Date(Date.now() + 48 * 3_600_000));
    const prisma = await getPrisma();
    const { monday, sunday, dayOfWeek } = scheduleFor(future);
    await asDemoTenant(() =>
      prisma.weeklyMachineProgram.create({
        data: {
          weeklyProgramId: `WP-FUT-${sfx}`,
          weekStartDate: monday,
          weekEndDate: sunday,
          dayOfWeek,
          machineId,
          shiftId,
          productionOrderId,
          plannedQty,
        },
      })
    );

    const res = await (await api()).post("/api/hourly-productions").set(OWNER.auth).send({
      productionOrderId,
      productionDate: future,
      shiftId,
      machineId,
      hourIndex: 1,
      qtyProduced: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cannot enter production for a future date/);
  });

  it("refuses an hour slot that has not started yet today (IST)", async () => {
    // Slot 1 starts at 23:59 IST: refused at any time of day except the last minute of the IST day.
    const today = getISTDateString();
    const prisma = await getPrisma();
    const lateShift = `SHL-${sfx}`;
    const { monday, sunday, dayOfWeek } = scheduleFor(today);
    await asDemoTenant(async () => {
      await prisma.shift.create({
        data: {
          shiftCode: lateShift,
          shiftName: `Late Shift ${sfx}`,
          startTime: "23:59",
          endTime: "23:59",
        },
      });
      await prisma.weeklyMachineProgram.create({
        data: {
          weeklyProgramId: `WP-LATE-${sfx}`,
          weekStartDate: monday,
          weekEndDate: sunday,
          dayOfWeek,
          machineId,
          shiftId: lateShift,
          productionOrderId,
          plannedQty,
        },
      });
    });

    const res = await (await api()).post("/api/hourly-productions").set(OWNER.auth).send({
      productionOrderId,
      productionDate: today,
      shiftId: lateShift,
      machineId,
      hourIndex: 1,
      qtyProduced: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cannot log hourly production for a future time slot/);
  });

  it("accepts an entry for today once its hour slot has started (IST)", async () => {
    // A shift starting at midnight IST has always started, so slot 1 is open at any time of day.
    const today = getISTDateString();
    const prisma = await getPrisma();
    const earlyShift = `SHE-${sfx}`;
    const { monday, sunday, dayOfWeek } = scheduleFor(today);
    await asDemoTenant(async () => {
      await prisma.shift.create({
        data: {
          shiftCode: earlyShift,
          shiftName: `Early Shift ${sfx}`,
          startTime: "00:00",
          endTime: "23:59",
        },
      });
      await prisma.weeklyMachineProgram.create({
        data: {
          weeklyProgramId: `WP-EARLY-${sfx}`,
          weekStartDate: monday,
          weekEndDate: sunday,
          dayOfWeek,
          machineId,
          shiftId: earlyShift,
          productionOrderId,
          plannedQty,
        },
      });
    });

    const res = await (await api()).post("/api/hourly-productions").set(OWNER.auth).send({
      productionOrderId,
      productionDate: today,
      shiftId: earlyShift,
      machineId,
      hourIndex: 1,
      qtyProduced: 5,
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  });

  it("refuses a second entry for the same machine, date, shift and hour", async () => {
    const res = await (await api()).post("/api/hourly-productions").set(OWNER.auth).send({
      productionOrderId,
      productionDate: PRODUCTION_DATE,
      shiftId,
      machineId,
      hourIndex: 1,
      qtyProduced: 10,
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Duplicate Hour Entry/);
  });

  it("refuses an entry against an unknown production order", async () => {
    const res = await (
      await api()
    )
      .post("/api/hourly-productions")
      .set(OWNER.auth)
      .send({
        productionOrderId: `NOPE-${sfx}`,
        productionDate: PRODUCTION_DATE,
        shiftId,
        machineId,
        hourIndex: 2,
        qtyProduced: 10,
      });
    expect(res.status).toBe(404);
  });

  it("refuses an entry with no matching weekly machine schedule", async () => {
    // A real production order, but a shift no weekly program was ever scheduled against.
    const res = await (
      await api()
    )
      .post("/api/hourly-productions")
      .set(OWNER.auth)
      .send({
        productionOrderId,
        productionDate: PRODUCTION_DATE,
        shiftId: `NOPE-SHIFT-${sfx}`,
        machineId,
        hourIndex: 2,
        qtyProduced: 10,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/No weekly machine schedule/);
  });

  it("grants the Production/Supervisor role access, and hides another tenant's hourly logs", async () => {
    const client = await api();
    // Fixed (P2T-04 bug #1): ROLE_DEFS used to grant this role "hourly-production" (singular,
    // hyphenated) while the permission registry's module key is "hourly_productions" (plural,
    // underscored) — provisioning.service.ts's keysFor() never matched the two, so the role was
    // provisioned with no hourly_productions.* permission at all. Now that the names agree, the
    // role that was always meant to own this module can reach it.
    const supervisor = await authed("demo.production");
    expect((await client.get("/api/hourly-productions").set(supervisor.auth)).status).toBe(200);

    const accounts = await authed("demo.accounts");
    expect((await client.get("/api/hourly-productions").set(accounts.auth)).status).toBe(403);

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Hourly Production Tenant B", companyCode: `HPB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.hourlyProduction.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.hourlyProduction.count())).toBeGreaterThan(0);
  });
});
