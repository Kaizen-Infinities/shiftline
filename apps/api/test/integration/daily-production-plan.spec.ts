import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { expectCleanError } from "../helpers/clean-error";
import { foreignTenant } from "../helpers/foreign-tenant";
import {
  activeShifts,
  assignOperator,
  createMachine,
  createPlannableOrder,
} from "../helpers/planning";
import { asDemoTenant, createEmployee } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";
import { byCode } from "../../src/lib/prisma";

/**
 * Daily production plans (R-04, characterisation). Pins today's behaviour of
 * `apps/api/src/modules/daily-production-plan/`:
 *  - a plan books one shift of one machine on one date against a weekly program; it needs an
 *    active machine and shift and an operator assignment covering the date;
 *  - the first plan moves the production order WEEKLY_SCHEDULED -> DAILY_PLANNED, deleting the
 *    last one moves it back;
 *  - ids are generated server-side (DP0001, ...), the same machine/shift/date/order cannot be
 *    planned twice, and a plan can be carried forward only once;
 *  - routes are gated by the weekly_programs.* permission keys.
 */
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
let seq = 0;
const N = (v: unknown) => Number(v);

const WEEK = "2028-02-07";
const WEEK_END = "2028-02-13";
// The operator assignment outlasts the weekly program so plans can use many different dates.
const ASSIGNED_UNTIL = "2028-12-31";
let dayCounter = 0;
/** A distinct date inside the assigned week for every plan, so slots never collide by accident. */
const nextDate = () => new Date(Date.UTC(2028, 2, 1 + dayCounter++)).toISOString().slice(0, 10);

let OWNER: { auth: Record<string, string> };
let FOREIGN: Awaited<ReturnType<typeof foreignTenant>>;
let shift1: string;
let shift2: string;
let shift3: string | undefined;
let machine: string;
let po: string;
let wp: string;
let operator: Awaited<ReturnType<typeof createEmployee>>;

const planBody = (over: Record<string, unknown> = {}) => ({
  weeklyProgramId: wp,
  productionOrderId: po,
  productionDate: nextDate(),
  machineId: machine,
  shiftId: shift1,
  plannedQty: 100,
  ...over,
});
const create = async (over: Record<string, unknown> = {}, auth = OWNER.auth) =>
  (await api()).post("/api/daily-production-plans").set(auth).send(planBody(over));
const getOne = async (id: string, auth = OWNER.auth) =>
  (await api()).get(`/api/daily-production-plans/${id}`).set(auth);
const orderStatus = async (id: string) => {
  const prisma = await getPrisma();
  const row = await asDemoTenant(() =>
    prisma.productionOrder.findUniqueOrThrow({ where: byCode("productionOrderId", id) })
  );
  return row.status;
};

/** A production order with a weekly program on the shared machine, ready for daily plans. */
const scheduledOrder = async (qty = 1000) => {
  const lone = await createPlannableOrder(OWNER.auth, `PD${sfx}${++seq}`, qty);
  const code = `WD${sfx}${seq}`;
  const res = await (
    await api()
  )
    .post("/api/weekly-machine-programs")
    .set(OWNER.auth)
    .send({
      weeklyProgramId: code,
      productionOrderId: lone.order.productionOrderId,
      weekStartDate: WEEK,
      weekEndDate: WEEK_END,
      machineId: machine,
      shiftId: shift3 ?? shift2,
      dayOfWeek: (seq % 7) + 1,
      plannedQty: qty,
    });
  if (res.status !== 201) throw new Error(`weekly setup failed: ${JSON.stringify(res.body)}`);
  return { po: lone.order.productionOrderId, wp: code };
};

describe("daily production plans", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    FOREIGN = await foreignTenant("xdpp");
    const shifts = await activeShifts();
    shift1 = shifts[0].shiftCode;
    shift2 = shifts[1].shiftCode;
    shift3 = shifts[2]?.shiftCode;
    machine = `MD${sfx}`;
    await createMachine(machine);
    operator = await createEmployee();
    await assignOperator({
      machineId: machine,
      shiftCode: shift1,
      employeeId: operator.id,
      weekStartDate: WEEK,
      weekEndDate: ASSIGNED_UNTIL,
    });
    const s = await scheduledOrder(100000);
    po = s.po;
    wp = s.wp;
  });

  describe("happy path", () => {
    it("creates a plan with a generated id, operators and the order moves to DAILY_PLANNED", async () => {
      expect(await orderStatus(po)).toBe("WEEKLY_SCHEDULED");
      const res = await create({ plannedHours: 8, priority: "HIGH", remarks: "first" });
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
      const dp = res.body.data;
      expect(dp.dailyPlanId).toMatch(/^DP\d{4,}$/);
      expect(dp.status).toBe("DRAFT");
      expect(dp.priority).toBe("HIGH");
      expect(N(dp.plannedQty)).toBe(100);
      expect(N(dp.plannedHours)).toBe(8);
      expect(dp.machineId).toBe(machine);
      expect(dp.shiftId).toBe(shift1);
      expect(dp.operators.map((o: { empCode: string }) => o.empCode)).toEqual([operator.empCode]);
      expect(dp.shiftIncharge).toBeNull();
      expect(dp.createdBy).toBeTruthy();
      expect(await orderStatus(po)).toBe("DAILY_PLANNED");
    });

    it("numbers plans one after the other", async () => {
      const a = await create();
      const b = await create();
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(N(b.body.data.dailyPlanId.slice(2))).toBe(N(a.body.data.dailyPlanId.slice(2)) + 1);
    });

    it("fetches a plan with its operators, order steps and neighbours", async () => {
      const made = await create();
      const res = await getOne(made.body.data.dailyPlanId);
      expect(res.status).toBe(200);
      expect(res.body.data.dailyPlanId).toBe(made.body.data.dailyPlanId);
      expect(res.body.data.productionOrder.productionOrderId).toBe(po);
      expect(res.body.data.weeklyMachineProgram.weeklyProgramId).toBe(wp);
      expect(res.body.data.operators).toHaveLength(1);
      expect(res.body.data.carryForwardTo).toEqual([]);
    });

    it("lists with filters and optional pagination", async () => {
      const date = nextDate();
      const made = await create({ productionDate: date, remarks: "list me" });
      const client = await api();
      const filtered = await client
        .get("/api/daily-production-plans")
        .query({
          productionOrderId: po,
          machineId: machine,
          shiftId: shift1,
          productionDate: date,
          status: "DRAFT",
        })
        .set(OWNER.auth);
      expect(filtered.status).toBe(200);
      const ids = filtered.body.data.dailyPlans.map((p: { dailyPlanId: string }) => p.dailyPlanId);
      expect(ids).toContain(made.body.data.dailyPlanId);
      expect(filtered.body.data.total).toBe(ids.length);
      expect(filtered.body.data.dailyPlans[0].operators).toHaveLength(1);

      const paged = await client
        .get("/api/daily-production-plans")
        .query({ productionOrderId: po, limit: "2", page: "1" })
        .set(OWNER.auth);
      expect(paged.body.data.dailyPlans).toHaveLength(2);
      expect(paged.body.data.limit).toBe(2);
      expect(paged.body.data.totalPages).toBe(Math.ceil(paged.body.data.total / 2));

      const none = await client
        .get("/api/daily-production-plans")
        .query({ weeklyProgramId: "NOPE" })
        .set(OWNER.auth);
      expect(none.body.data).toMatchObject({ dailyPlans: [], total: 0 });
    });

    it("updates quantity, hours, priority and remarks, and starts the plan", async () => {
      const made = await create();
      const id = made.body.data.dailyPlanId;
      const client = await api();
      const res = await client
        .put(`/api/daily-production-plans/${id}`)
        .set(OWNER.auth)
        .send({ plannedQty: 250, plannedHours: 6, priority: "URGENT", remarks: "bumped" });
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
      expect(N(res.body.data.plannedQty)).toBe(250);
      expect(N(res.body.data.plannedHours)).toBe(6);
      expect(res.body.data.priority).toBe("URGENT");
      expect(res.body.data.remarks).toBe("bumped");
      expect(res.body.data.updatedBy).toBeTruthy();
      // Untouched fields stay as they were.
      expect(res.body.data.machineId).toBe(machine);

      const start = await client
        .put(`/api/daily-production-plans/${id}`)
        .set(OWNER.auth)
        .send({ status: "IN_PROGRESS" });
      expect(start.status, JSON.stringify(start.body).slice(0, 300)).toBe(200);
      expect(start.body.data.status).toBe("IN_PROGRESS");
    });

    it("moves a plan into post-production, then completes it", async () => {
      const s = await scheduledOrder(500);
      const made = await create({ weeklyProgramId: s.wp, productionOrderId: s.po });
      expect(made.status, JSON.stringify(made.body).slice(0, 300)).toBe(201);
      const id = made.body.data.dailyPlanId;
      const client = await api();
      const post = await client
        .put(`/api/daily-production-plans/${id}`)
        .set(OWNER.auth)
        .send({ status: "POST_PRODUCTION" });
      expect(post.status, JSON.stringify(post.body).slice(0, 300)).toBe(200);
      expect(post.body.data.status).toBe("POST_PRODUCTION");
      expect(post.body.data.currentStepIndex).toBe(1);
      expect(await orderStatus(s.po)).toBe("POST_PRODUCTION");

      const done = await client
        .put(`/api/daily-production-plans/${id}`)
        .set(OWNER.auth)
        .send({ status: "COMPLETED" });
      expect(done.status, JSON.stringify(done.body).slice(0, 300)).toBe(200);
      expect(done.body.data.status).toBe("COMPLETED");
      expect(done.body.data.currentProductionStep).toBe("Completed");
    });

    it("short-closes the order from post-production and stops its other open plans", async () => {
      const s = await scheduledOrder(500);
      const keep = await create({ weeklyProgramId: s.wp, productionOrderId: s.po });
      const other = await create({ weeklyProgramId: s.wp, productionOrderId: s.po });
      expect(other.status).toBe(201);
      const client = await api();
      const res = await client
        .put(`/api/daily-production-plans/${keep.body.data.dailyPlanId}`)
        .set(OWNER.auth)
        .send({ status: "POST_PRODUCTION", shortClosePO: true, remarks: "Stopped: tool broke" });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(await orderStatus(s.po)).toBe("COMPLETED_WITH_SHORTFALL");
      const stopped = await getOne(other.body.data.dailyPlanId);
      expect(stopped.body.data.status).toBe("STOPPED");
    });

    it("deletes a plan and moves the order back to WEEKLY_SCHEDULED when it was the last one", async () => {
      const s = await scheduledOrder(300);
      const made = await create({ weeklyProgramId: s.wp, productionOrderId: s.po });
      expect(await orderStatus(s.po)).toBe("DAILY_PLANNED");
      const client = await api();
      const del = await client
        .delete(`/api/daily-production-plans/${made.body.data.dailyPlanId}`)
        .set(OWNER.auth);
      expect(del.status).toBe(200);
      expect((await getOne(made.body.data.dailyPlanId)).status).toBe(404);
      expect(await orderStatus(s.po)).toBe("WEEKLY_SCHEDULED");
    });

    it("refuses to delete a plan that already has hourly production logs", async () => {
      const made = await create();
      const id = made.body.data.dailyPlanId;
      const prisma = await getPrisma();
      await asDemoTenant(() =>
        prisma.hourlyProduction.create({
          data: {
            productionOrderId: po,
            dailyPlanId: id,
            machineId: machine,
            shiftId: shift1,
            productionDate: new Date(made.body.data.productionDate),
            hourIndex: 1,
            qtyProduced: 5,
          } as never,
        })
      );
      const res = await (await api()).delete(`/api/daily-production-plans/${id}`).set(OWNER.auth);
      expectCleanError(res, 400, /already has 1 hourly production logs/);
      expect((await getOne(id)).status).toBe(200);
    });
  });

  describe("business rules", () => {
    it("refuses the same machine, shift, date and order twice with 409", async () => {
      const date = nextDate();
      expect((await create({ productionDate: date })).status).toBe(201);
      expectCleanError(await create({ productionDate: date }), 409, /already scheduled/);
    });

    it("lets a plan be carried forward once only", async () => {
      const first = await create();
      const src = first.body.data.dailyPlanId;
      const next = await create({ carryForwardFromPlanId: src });
      expect(next.status, JSON.stringify(next.body).slice(0, 300)).toBe(201);
      const again = await create({ carryForwardFromPlanId: src });
      expectCleanError(again, 409, /already been carried forward/);
      expectCleanError(
        await create({ carryForwardFromPlanId: "DP-NOPE" }),
        404,
        /Source plan DP-NOPE not found/
      );
      const source = await getOne(src);
      expect(source.body.data.carryForwardTo).toHaveLength(1);
    });

    it("refuses a machine, shift or operator that cannot be planned", async () => {
      const prisma = await getPrisma();
      // Shift with no operator assignment.
      expectCleanError(await create({ shiftId: shift2 }), 400, /No operator is assigned/);

      // Inactive machine.
      const idle = `MI${sfx}`;
      await createMachine(idle, { isActive: false });
      expectCleanError(
        await create({ machineId: idle }),
        400,
        /currently inactive and cannot be planned/
      );

      // Inactive operator on an otherwise valid assignment.
      const gone = await createEmployee({ status: "inactive" });
      const m2 = `MJ${sfx}`;
      await createMachine(m2);
      await assignOperator({
        machineId: m2,
        shiftCode: shift1,
        employeeId: gone.id,
        weekStartDate: WEEK,
        weekEndDate: ASSIGNED_UNTIL,
      });
      expectCleanError(await create({ machineId: m2 }), 400, /is currently inactive\./);

      // Inactive shift.
      const shifts = await activeShifts();
      const spare = shifts[shifts.length - 1].shiftCode;
      await asDemoTenant(() =>
        prisma.shift.update({ where: byCode("shiftCode", spare), data: { isActive: false } })
      );
      try {
        expectCleanError(
          await create({ shiftId: spare }),
          400,
          /currently inactive and cannot be planned/
        );
      } finally {
        await asDemoTenant(() =>
          prisma.shift.update({ where: byCode("shiftCode", spare), data: { isActive: true } })
        );
      }
    });

    it("refuses an order that is not schedulable or already fully produced", async () => {
      const prisma = await getPrisma();
      const s = await scheduledOrder(100);
      await asDemoTenant(() =>
        prisma.productionOrder.update({
          where: byCode("productionOrderId", s.po),
          data: { status: "CANCELLED" },
        })
      );
      expectCleanError(
        await create({ weeklyProgramId: s.wp, productionOrderId: s.po }),
        400,
        /status must be schedulable/
      );
      await asDemoTenant(() =>
        prisma.productionOrder.update({
          where: byCode("productionOrderId", s.po),
          data: { status: "WEEKLY_SCHEDULED", producedQty: 100 },
        })
      );
      expectCleanError(
        await create({ weeklyProgramId: s.wp, productionOrderId: s.po }),
        400,
        /already been fully produced/
      );
    });

    it("refuses to start a plan whose order is in a state that cannot run", async () => {
      const prisma = await getPrisma();
      const s = await scheduledOrder(100);
      const made = await create({ weeklyProgramId: s.wp, productionOrderId: s.po });
      await asDemoTenant(() =>
        prisma.productionOrder.update({
          where: byCode("productionOrderId", s.po),
          data: { status: "CLOSED" },
        })
      );
      const res = await (
        await api()
      )
        .put(`/api/daily-production-plans/${made.body.data.dailyPlanId}`)
        .set(OWNER.auth)
        .send({ status: "IN_PROGRESS" });
      expectCleanError(res, 400, /cannot be started/);
    });

    it("keeps the one-per-slot rule on update, excluding the plan itself", async () => {
      const dateA = nextDate();
      const dateB = nextDate();
      const a = await create({ productionDate: dateA });
      const b = await create({ productionDate: dateB });
      const client = await api();
      expectCleanError(
        await client
          .put(`/api/daily-production-plans/${b.body.data.dailyPlanId}`)
          .set(OWNER.auth)
          .send({ productionDate: dateA }),
        409,
        /already scheduled/
      );
      const same = await client
        .put(`/api/daily-production-plans/${a.body.data.dailyPlanId}`)
        .set(OWNER.auth)
        .send({ productionDate: dateA, remarks: "same slot, same plan" });
      expect(same.status).toBe(200);
    });
  });

  describe("validation", () => {
    const paths = (res: { body: { errors: { path: string }[] } }) =>
      res.body.errors.map((e) => e.path);

    it("rejects an empty body with field-level errors", async () => {
      const res = await (await api()).post("/api/daily-production-plans").set(OWNER.auth).send({});
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.weeklyProgramId",
          "body.productionOrderId",
          "body.productionDate",
          "body.machineId",
          "body.shiftId",
          "body.plannedQty",
        ])
      );
    });

    it("rejects bad date, quantity, hours, enums and over-long fields", async () => {
      const res = await create({
        productionDate: "someday",
        plannedQty: 0,
        plannedHours: -2,
        priority: "WHENEVER",
        status: "WHENEVER",
        remarks: "r".repeat(256),
        selectedOperatorIds: "1".repeat(256),
        carryForwardFromPlanId: "C".repeat(51),
        weeklyProgramId: "W".repeat(21),
        productionOrderId: "P".repeat(21),
        machineId: "M".repeat(21),
        shiftId: "S".repeat(21),
      });
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.productionDate",
          "body.plannedQty",
          "body.plannedHours",
          "body.priority",
          "body.status",
          "body.remarks",
          "body.selectedOperatorIds",
          "body.carryForwardFromPlanId",
          "body.weeklyProgramId",
          "body.productionOrderId",
          "body.machineId",
          "body.shiftId",
        ])
      );
      expectCleanError(await create({ plannedQty: "100" }), 400, "Validation failed");
    });

    it("rejects unknown weekly program, order, machine and shift with 404", async () => {
      expectCleanError(
        await create({ weeklyProgramId: "NOPE" }),
        404,
        /Weekly Program with ID NOPE not found/
      );
      expectCleanError(
        await create({ productionOrderId: "NOPE" }),
        404,
        /Production Order with ID NOPE not found/
      );
      expectCleanError(await create({ machineId: "NOPE" }), 404, /Machine with ID NOPE not found/);
      expectCleanError(await create({ shiftId: "NOPE" }), 404, /Shift with ID NOPE not found/);
    });

    it("rejects a production date that is a full ISO timestamp with a 4xx, never a 500", async () => {
      const res = await create({ productionDate: "2028-02-08T00:00:00.000Z" });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.success).toBe(false);
    });

    it("rejects bad update bodies and unknown ids", async () => {
      const made = await create();
      const client = await api();
      const id = made.body.data.dailyPlanId;
      const bad = await client
        .put(`/api/daily-production-plans/${id}`)
        .set(OWNER.auth)
        .send({ plannedQty: -1, status: "WHENEVER", productionDate: "nope", priority: "NOW" });
      expectCleanError(bad, 400, "Validation failed");
      expect(paths(bad)).toEqual(
        expect.arrayContaining([
          "body.plannedQty",
          "body.status",
          "body.productionDate",
          "body.priority",
        ])
      );
      expectCleanError(await getOne("DP-NOPE"), 404, /not found/);
      expectCleanError(
        await client
          .put("/api/daily-production-plans/DP-NOPE")
          .set(OWNER.auth)
          .send({ remarks: "x" }),
        404,
        /not found/
      );
      expectCleanError(
        await client.delete("/api/daily-production-plans/DP-NOPE").set(OWNER.auth),
        404,
        /not found/
      );
    });

    it("rejects malformed list filters with a 4xx, never a 500", async () => {
      const client = await api();
      for (const query of [
        { productionDate: "garbage" },
        { limit: "abc" },
        { page: "-3", limit: "5" },
        { page: "0", limit: "5" },
        { limit: "2.5" },
      ]) {
        const res = await client.get("/api/daily-production-plans").query(query).set(OWNER.auth);
        const label = JSON.stringify(query);
        expect(res.status, `${label}: ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(500);
        expect(res.status, label).toBeGreaterThanOrEqual(400);
        expect(res.body.success, label).toBe(false);
      }
    });
  });

  describe("permissions", () => {
    it("refuses every route to roles without weekly_programs.*", async () => {
      const client = await api();
      for (const user of ["demo.sales", "demo.accounts", "demo.stores", "demo.auditor"]) {
        const { auth } = await authed(user);
        expectCleanError(await client.get("/api/daily-production-plans").set(auth), 403);
        expectCleanError(await client.get("/api/daily-production-plans/DP0001").set(auth), 403);
        expectCleanError(
          await client.post("/api/daily-production-plans").set(auth).send(planBody()),
          403
        );
        expectCleanError(
          await client.put("/api/daily-production-plans/DP0001").set(auth).send({ remarks: "x" }),
          403
        );
        expectCleanError(await client.delete("/api/daily-production-plans/DP0001").set(auth), 403);
      }
      expect((await client.get("/api/daily-production-plans")).status).toBe(401);
    });

    it("lets the production role plan", async () => {
      const prod = await authed("demo.production");
      const res = await create({}, prod.auth);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      expect((await getOne(res.body.data.dailyPlanId, prod.auth)).status).toBe(200);
    });
  });

  describe("tenancy", () => {
    let foreignPlan: string;
    let foreignWp: string;
    let foreignPo: string;

    beforeAll(async () => {
      const prisma = await getPrisma();
      foreignPo = `POFD${sfx}`;
      foreignWp = `WPFD${sfx}`;
      foreignPlan = `DPF${sfx}`;
      await runAsTenant(FOREIGN.companyId, async () => {
        const product = await prisma.product.findFirstOrThrow();
        const m = await prisma.machine.findFirstOrThrow();
        const sh = await prisma.shift.findFirstOrThrow({ where: { isActive: true } });
        await prisma.productionOrder.create({
          data: {
            productionOrderId: foreignPo,
            productItemId: product.id,
            orderDate: new Date(),
            dueDate: new Date(),
            targetQty: 100,
            uom: "PCS",
            status: "WEEKLY_SCHEDULED",
          } as never,
        });
        await prisma.weeklyMachineProgram.create({
          data: {
            weeklyProgramId: foreignWp,
            productionOrderId: foreignPo,
            weekStartDate: new Date(WEEK),
            weekEndDate: new Date(WEEK_END),
            machineId: m.machineId,
            shiftId: sh.shiftCode,
            dayOfWeek: 1,
            plannedQty: 100,
            status: "PLANNED",
          },
        });
        await prisma.dailyProductionPlan.create({
          data: {
            dailyPlanId: foreignPlan,
            weeklyProgramId: foreignWp,
            productionOrderId: foreignPo,
            productionDate: new Date(WEEK),
            machineId: m.machineId,
            shiftId: sh.shiftCode,
            plannedQty: 50,
            status: "DRAFT",
          },
        });
      });
    });

    it("hides a foreign plan from list and get, and cannot update or delete it", async () => {
      const client = await api();
      expectCleanError(await getOne(foreignPlan), 404, /not found/);
      const list = await client
        .get("/api/daily-production-plans")
        .query({ productionOrderId: foreignPo })
        .set(OWNER.auth);
      expect(list.status).toBe(200);
      expect(list.body.data).toMatchObject({ dailyPlans: [], total: 0 });
      const all = await client.get("/api/daily-production-plans").set(OWNER.auth);
      expect(JSON.stringify(all.body)).not.toContain(foreignPlan);
      expect(JSON.stringify(all.body)).not.toContain(FOREIGN.companyId);

      expectCleanError(
        await client
          .put(`/api/daily-production-plans/${foreignPlan}`)
          .set(OWNER.auth)
          .send({ remarks: "Hijacked" }),
        404,
        /not found/
      );
      expectCleanError(
        await client.delete(`/api/daily-production-plans/${foreignPlan}`).set(OWNER.auth),
        404,
        /not found/
      );
      const prisma = await getPrisma();
      const row = await runAsTenant(FOREIGN.companyId, () =>
        prisma.dailyProductionPlan.findUniqueOrThrow({ where: byCode("dailyPlanId", foreignPlan) })
      );
      expect(row.remarks).toBeNull();
    });

    it("cannot plan against a foreign weekly program or order", async () => {
      expectCleanError(
        await create({ weeklyProgramId: foreignWp }),
        404,
        /Weekly Program with ID .* not found/
      );
      expectCleanError(
        await create({ productionOrderId: foreignPo }),
        404,
        /Production Order with ID .* not found/
      );
    });

    it("cannot carry forward from, or re-point an own plan at, a foreign plan or program", async () => {
      expectCleanError(
        await create({ carryForwardFromPlanId: foreignPlan }),
        404,
        /Source plan .* not found/
      );
      const made = await create();
      const res = await (
        await api()
      )
        .put(`/api/daily-production-plans/${made.body.data.dailyPlanId}`)
        .set(OWNER.auth)
        .send({ weeklyProgramId: foreignWp });
      expectCleanError(res, 404, /Weekly Program with ID .* not found/);
    });

    it("does not resolve a foreign employee named in selectedOperatorIds", async () => {
      const prisma = await getPrisma();
      const foreignEmp = await runAsTenant(FOREIGN.companyId, () =>
        prisma.employee.findFirstOrThrow()
      );
      const res = await create({ selectedOperatorIds: `${operator.id},${foreignEmp.id}` });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      const names = res.body.data.operators.map((o: { fullName: string }) => o.fullName);
      expect(names).toContain(operator.fullName);
      expect(names).not.toContain(foreignEmp.fullName);
    });
  });
});
