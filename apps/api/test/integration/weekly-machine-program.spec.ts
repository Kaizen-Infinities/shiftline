import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { expectCleanError } from "../helpers/clean-error";
import { foreignTenant } from "../helpers/foreign-tenant";
import { activeShifts, createMachine, createPlannableOrder } from "../helpers/planning";
import { asDemoTenant } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";
import { byCode } from "../../src/lib/prisma";

/**
 * Weekly machine programs (R-04, characterisation). Pins today's behaviour of
 * `apps/api/src/modules/weekly-machine-program/`:
 *  - a program books one (machine, shift, weekday) slot of a week for part of a production order;
 *    the sum of a PO's active programs may not exceed its target quantity;
 *  - creating the first program moves the PO READY_FOR_PLANNING -> WEEKLY_SCHEDULED and reserves
 *    raw material pro rata; deleting it puts both back;
 *  - a second program on a booked slot is refused with 409;
 *  - programs are addressed by their business code (`weeklyProgramId`), unique per tenant.
 */
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
let seq = 0;
const wpCode = () => `WP${sfx}${++seq}`;
const N = (v: unknown) => Number(v);

// Mondays far from the other suites' dates.
const WEEK_A = "2027-03-01";
const WEEK_A_END = "2027-03-07";
const WEEK_B = "2027-03-08";
const WEEK_B_END = "2027-03-14";

let OWNER: { auth: Record<string, string> };
let FOREIGN: Awaited<ReturnType<typeof foreignTenant>>;
let shift1: string;
let shift2: string;
let machine1: string;
let machine2: string;
let po1: string; // target 1000
let po2: string; // target 500
let rmId: string;

// Every call books a week of its own unless the test names one, so slots never collide by accident.
const freshWeek = () => {
  const start = new Date(Date.UTC(2028, 0, 3 + 7 * seq));
  const end = new Date(start.getTime() + 6 * 86400000);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
};
const payload = (over: Record<string, unknown> = {}) => {
  const [weekStartDate, weekEndDate] = freshWeek();
  return {
    weeklyProgramId: wpCode(),
    productionOrderId: po1,
    weekStartDate,
    weekEndDate,
    machineId: machine1,
    shiftId: shift1,
    dayOfWeek: 1,
    plannedQty: 100,
    ...over,
  };
};
const create = async (over: Record<string, unknown> = {}, auth = OWNER.auth) =>
  (await api()).post("/api/weekly-machine-programs").set(auth).send(payload(over));
const getOne = async (id: string) =>
  (await api()).get(`/api/weekly-machine-programs/${id}`).set(OWNER.auth);
const reserved = async () => {
  const prisma = await getPrisma();
  const rm = await asDemoTenant(() =>
    prisma.rawMaterial.findFirstOrThrow({ where: { rawMaterialId: rmId } })
  );
  return N(rm.reservedQty);
};

describe("weekly machine programs", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    FOREIGN = await foreignTenant("xwmp");
    const shifts = await activeShifts();
    shift1 = shifts[0].shiftCode;
    shift2 = shifts[1].shiftCode;
    machine1 = `MW1${sfx}`;
    machine2 = `MW2${sfx}`;
    await createMachine(machine1);
    await createMachine(machine2);
    const a = await createPlannableOrder(OWNER.auth, `POW1${sfx}`, 1000);
    const b = await createPlannableOrder(OWNER.auth, `POW2${sfx}`, 500);
    po1 = a.order.productionOrderId;
    po2 = b.order.productionOrderId;
    rmId = a.rm.rawMaterialId;
    expect(a.order.status).toBe("READY_FOR_PLANNING");
  });

  describe("happy path", () => {
    it("suggests the next program id", async () => {
      const res = await (await api()).get("/api/weekly-machine-programs/next-id").set(OWNER.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.nextId).toMatch(/\d/);
    });

    it("creates a program, schedules the order and reserves raw material pro rata", async () => {
      const before = await reserved();
      const res = await create({
        plannedHours: 8,
        setupHours: 1,
        remarks: "first run",
        priority: "HIGH",
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
      const wp = res.body.data;
      expect(wp.status).toBe("PLANNED");
      expect(wp.priority).toBe("HIGH");
      expect(wp.sequenceNo).toBe(1);
      expect(N(wp.plannedQty)).toBe(100);
      expect(N(wp.plannedHours)).toBe(8);
      expect(wp.machineId).toBe(machine1);
      expect(wp.shiftId).toBe(shift1);
      expect(wp.machine.machineName).toContain(machine1);
      expect(wp.createdBy).toBeTruthy();

      // 100 of 1000 planned; the order needs 10 KG in total, so 1 KG is reserved.
      expect((await reserved()) - before).toBeCloseTo(1, 5);
      const prisma = await getPrisma();
      const order = await asDemoTenant(() =>
        prisma.productionOrder.findUniqueOrThrow({ where: byCode("productionOrderId", po1) })
      );
      expect(order.status).toBe("WEEKLY_SCHEDULED");
    });

    it("lists with machine, week and search filters", async () => {
      const code = wpCode();
      const res = await create({
        weeklyProgramId: code,
        weekStartDate: WEEK_A,
        weekEndDate: WEEK_A_END,
        dayOfWeek: 2,
        plannedQty: 50,
      });
      expect(res.status).toBe(201);
      const client = await api();

      const byMachine = await client
        .get("/api/weekly-machine-programs")
        .query({ machineId: machine1, weekStartDate: WEEK_A })
        .set(OWNER.auth);
      expect(byMachine.status).toBe(200);
      const ids = byMachine.body.data.map((w: { weeklyProgramId: string }) => w.weeklyProgramId);
      expect(ids).toContain(code);
      expect(
        byMachine.body.data.every((w: { machineId: string }) => w.machineId === machine1)
      ).toBe(true);

      const search = await client
        .get("/api/weekly-machine-programs")
        .query({ search: code.toLowerCase() })
        .set(OWNER.auth);
      expect(search.body.data.map((w: { weeklyProgramId: string }) => w.weeklyProgramId)).toEqual([
        code,
      ]);

      const otherWeek = await client
        .get("/api/weekly-machine-programs")
        .query({ machineId: machine1, weekStartDate: "2031-01-06" })
        .set(OWNER.auth);
      expect(otherWeek.body.data).toEqual([]);
    });

    it("fetches one program by its business code and lists pending ones", async () => {
      const code = wpCode();
      await create({ weeklyProgramId: code, dayOfWeek: 3, plannedQty: 10 });
      const one = await getOne(code);
      expect(one.status).toBe(200);
      expect(one.body.data.weeklyProgramId).toBe(code);
      expect(one.body.data.productionOrder.productionOrderId).toBe(po1);
      expect(one.body.data.shift.shiftCode).toBe(shift1);

      const pending = await (
        await api()
      )
        .get("/api/weekly-machine-programs/pending")
        .set(OWNER.auth);
      expect(pending.status).toBe(200);
      expect(
        pending.body.data.map((w: { weeklyProgramId: string }) => w.weeklyProgramId)
      ).toContain(code);
    });

    it("assigns the next sequence number when the slot already holds a closed program", async () => {
      const first = wpCode();
      await create({
        weeklyProgramId: first,
        weekStartDate: WEEK_A,
        weekEndDate: WEEK_A_END,
        machineId: machine2,
        dayOfWeek: 4,
        plannedQty: 10,
      });
      const put = await (
        await api()
      )
        .put(`/api/weekly-machine-programs/${first}`)
        .set(OWNER.auth)
        .send({ status: "CANCELLED" });
      expect(put.status, JSON.stringify(put.body).slice(0, 300)).toBe(200);
      const second = await create({
        weekStartDate: WEEK_A,
        weekEndDate: WEEK_A_END,
        machineId: machine2,
        dayOfWeek: 4,
        plannedQty: 10,
      });
      expect(second.status, JSON.stringify(second.body).slice(0, 300)).toBe(201);
      expect(second.body.data.sequenceNo).toBe(2);
    });

    it("builds the daily-planning grid for a machine and week", async () => {
      const code = wpCode();
      await create({
        weeklyProgramId: code,
        weekStartDate: WEEK_A,
        weekEndDate: WEEK_A_END,
        machineId: machine2,
        dayOfWeek: 5,
        plannedQty: 20,
      });
      const res = await (
        await api()
      )
        .get("/api/weekly-machine-programs/daily-planning/data")
        .query({ machineId: machine2, weekStartDate: WEEK_A })
        .set(OWNER.auth);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.data.machineId).toBe(machine2);
      expect(res.body.data.days).toHaveLength(7);
      expect(res.body.data.days[0]).toMatchObject({
        dayOfWeek: 1,
        dayName: "Monday",
        date: WEEK_A,
      });
      const friday = res.body.data.days[4];
      const cell = friday.shifts.find((s: { shiftId: string }) => s.shiftId === shift1);
      expect(cell.programs.map((p: { weeklyProgramId: string }) => p.weeklyProgramId)).toContain(
        code
      );
      const prog = cell.programs.find(
        (p: { weeklyProgramId: string }) => p.weeklyProgramId === code
      );
      expect(prog).toMatchObject({
        plannedQty: 20,
        producedQty: 0,
        remainingQty: 20,
        status: "PLANNED",
      });
    });

    it("updates a program, moving the slot and changing the quantity", async () => {
      const code = wpCode();
      await create({ weeklyProgramId: code, dayOfWeek: 6, plannedQty: 10 });
      const res = await (
        await api()
      )
        .put(`/api/weekly-machine-programs/${code}`)
        .set(OWNER.auth)
        .send({ plannedQty: 25, dayOfWeek: 7, remarks: "moved", priority: "LOW", shiftId: shift2 });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(N(res.body.data.plannedQty)).toBe(25);
      expect(res.body.data.dayOfWeek).toBe(7);
      expect(res.body.data.shiftId).toBe(shift2);
      expect(res.body.data.priority).toBe("LOW");
      expect(res.body.data.updatedBy).toBeTruthy();
    });

    it("deletes a planned program, releases the reservation and reverts the order", async () => {
      const lone = await createPlannableOrder(OWNER.auth, `POW3${sfx}${++seq}`, 200);
      const code = wpCode();
      const made = await create({
        weeklyProgramId: code,
        productionOrderId: lone.order.productionOrderId,
        machineId: machine2,
        dayOfWeek: 2,
        weekStartDate: WEEK_B,
        weekEndDate: WEEK_B_END,
        plannedQty: 200,
      });
      expect(made.status, JSON.stringify(made.body).slice(0, 300)).toBe(201);
      const prisma = await getPrisma();
      const rmBefore = await asDemoTenant(() =>
        prisma.rawMaterial.findFirstOrThrow({ where: { rawMaterialId: lone.rm.rawMaterialId } })
      );
      expect(N(rmBefore.reservedQty)).toBe(10);

      const del = await (
        await api()
      )
        .delete(`/api/weekly-machine-programs/${code}`)
        .set(OWNER.auth);
      expect(del.status).toBe(200);
      expect((await getOne(code)).status).toBe(404);
      const [rmAfter, order] = await asDemoTenant(() =>
        Promise.all([
          prisma.rawMaterial.findFirstOrThrow({ where: { rawMaterialId: lone.rm.rawMaterialId } }),
          prisma.productionOrder.findUniqueOrThrow({
            where: byCode("productionOrderId", lone.order.productionOrderId),
          }),
        ])
      );
      expect(N(rmAfter.reservedQty)).toBe(0);
      expect(order.status).toBe("READY_FOR_PLANNING");
    });

    it("stops an in-progress program: completes it and carries the remainder forward", async () => {
      const lone = await createPlannableOrder(OWNER.auth, `POW4${sfx}${++seq}`, 300);
      const code = wpCode();
      const made = await create({
        weeklyProgramId: code,
        productionOrderId: lone.order.productionOrderId,
        machineId: machine2,
        dayOfWeek: 3,
        weekStartDate: WEEK_B,
        weekEndDate: WEEK_B_END,
        plannedQty: 300,
        status: "IN_PROGRESS",
      });
      expect(made.status, JSON.stringify(made.body).slice(0, 300)).toBe(201);
      const res = await (
        await api()
      )
        .put(`/api/weekly-machine-programs/${code}`)
        .set(OWNER.auth)
        .send({ status: "PLANNED" });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.machineId).toBeNull();
      const all = await (
        await api()
      )
        .get("/api/weekly-machine-programs")
        .query({ search: "PLANNED" })
        .set(OWNER.auth);
      const carried = all.body.data.filter(
        (w: { productionOrderId: string; weeklyProgramId: string }) =>
          w.productionOrderId === lone.order.productionOrderId && w.weeklyProgramId !== code
      );
      expect(carried).toHaveLength(1);
      expect(N(carried[0].plannedQty)).toBe(300);
    });
  });

  describe("business rules", () => {
    it("refuses a second program on a booked machine/shift/day with 409", async () => {
      const slot = {
        weekStartDate: WEEK_A,
        weekEndDate: WEEK_A_END,
        machineId: machine2,
        shiftId: shift2,
        dayOfWeek: 1,
        plannedQty: 10,
      };
      expect((await create(slot)).status).toBe(201);
      const res = await create(slot);
      expectCleanError(res, 409, /already scheduled or running/);
    });

    it("refuses an update that moves a program onto a booked slot", async () => {
      const a = wpCode();
      const b = wpCode();
      await create({
        weeklyProgramId: a,
        machineId: machine2,
        shiftId: shift1,
        dayOfWeek: 7,
        weekStartDate: WEEK_B,
        weekEndDate: WEEK_B_END,
        plannedQty: 5,
      });
      await create({
        weeklyProgramId: b,
        machineId: machine2,
        shiftId: shift1,
        dayOfWeek: 6,
        weekStartDate: WEEK_B,
        weekEndDate: WEEK_B_END,
        plannedQty: 5,
      });
      const res = await (
        await api()
      )
        .put(`/api/weekly-machine-programs/${b}`)
        .set(OWNER.auth)
        .send({ dayOfWeek: 7 });
      expectCleanError(res, 409, /already scheduled or running/);
    });

    it("refuses programs that together exceed the order's target quantity", async () => {
      const res = await create({
        productionOrderId: po2,
        machineId: machine2,
        shiftId: shift1,
        dayOfWeek: 1,
        weekStartDate: WEEK_B,
        weekEndDate: WEEK_B_END,
        plannedQty: 501,
      });
      expectCleanError(res, 400, /cannot exceed the Production Order target quantity/);
      const ok = await create({
        productionOrderId: po2,
        machineId: machine2,
        shiftId: shift1,
        dayOfWeek: 1,
        weekStartDate: WEEK_B,
        weekEndDate: WEEK_B_END,
        plannedQty: 500,
      });
      expect(ok.status).toBe(201);
      const update = await (
        await api()
      )
        .put(`/api/weekly-machine-programs/${ok.body.data.weeklyProgramId}`)
        .set(OWNER.auth)
        .send({ plannedQty: 501 });
      expectCleanError(update, 400, /Cannot update Weekly Program/);
    });

    it("refuses to schedule orders that are waiting for material, cancelled or finished", async () => {
      const prisma = await getPrisma();
      for (const [status, pattern] of [
        ["WAITING_FOR_MATERIAL", /WAITING_FOR_MATERIAL/],
        ["CANCELLED", /already cancelled/],
        ["CLOSED", /already closed/],
        ["CREATED", /Current status: CREATED/],
      ] as const) {
        const lone = await createPlannableOrder(OWNER.auth, `POW5${sfx}${++seq}`, 100);
        await asDemoTenant(() =>
          prisma.productionOrder.update({
            where: byCode("productionOrderId", lone.order.productionOrderId),
            data: { status },
          })
        );
        const res = await create({
          productionOrderId: lone.order.productionOrderId,
          machineId: machine2,
          dayOfWeek: 2,
          plannedQty: 10,
        });
        expectCleanError(res, 400, pattern);
      }
    });

    it("refuses to delete a program once production has started", async () => {
      const code = wpCode();
      await create({
        weeklyProgramId: code,
        machineId: machine2,
        shiftId: shift2,
        dayOfWeek: 2,
        weekStartDate: WEEK_B,
        weekEndDate: WEEK_B_END,
        plannedQty: 1,
      });
      const client = await api();
      await client
        .put(`/api/weekly-machine-programs/${code}`)
        .set(OWNER.auth)
        .send({ status: "COMPLETED" });
      const res = await client.delete(`/api/weekly-machine-programs/${code}`).set(OWNER.auth);
      expectCleanError(res, 400, "Cannot delete weekly program once production has started.");
      expect((await getOne(code)).status).toBe(200);
    });
  });

  describe("validation", () => {
    const paths = (res: { body: { errors: { path: string }[] } }) =>
      res.body.errors.map((e) => e.path);

    it("rejects an empty body with field-level errors", async () => {
      const res = await (await api()).post("/api/weekly-machine-programs").set(OWNER.auth).send({});
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.weeklyProgramId",
          "body.productionOrderId",
          "body.weekStartDate",
          "body.weekEndDate",
          "body.dayOfWeek",
          "body.plannedQty",
        ])
      );
    });

    it("rejects bad dates, day, quantities, hours and enums", async () => {
      const res = await create({
        weekStartDate: "next tuesday",
        weekEndDate: "soon",
        dayOfWeek: 8,
        plannedQty: 0,
        plannedHours: -1,
        setupHours: -1,
        sequenceNo: -1,
        priority: "WHENEVER",
        status: "WHENEVER",
        remarks: "r".repeat(256),
      });
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.weekStartDate",
          "body.weekEndDate",
          "body.dayOfWeek",
          "body.plannedQty",
          "body.plannedHours",
          "body.setupHours",
          "body.sequenceNo",
          "body.priority",
          "body.status",
          "body.remarks",
        ])
      );
      expectCleanError(await create({ dayOfWeek: 1.5 }), 400, "Validation failed");
      expectCleanError(await create({ plannedQty: "100" }), 400, "Validation failed");
    });

    it("rejects ids longer than the columns with a 400, never a 500", async () => {
      const res = await create({ weeklyProgramId: "W".repeat(40) });
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toContain("body.weeklyProgramId");
      expectCleanError(
        await create({ productionOrderId: "P".repeat(40) }),
        400,
        "Validation failed"
      );
      expectCleanError(await create({ machineId: "M".repeat(40) }), 400, "Validation failed");
      expectCleanError(await create({ shiftId: "S".repeat(40) }), 400, "Validation failed");
    });

    it("rejects a duplicate program id (409) and unknown order, machine and shift (404)", async () => {
      const first = await create({
        machineId: machine2,
        dayOfWeek: 1,
        weekStartDate: "2027-04-05",
        weekEndDate: "2027-04-11",
        plannedQty: 1,
      });
      expect(first.status).toBe(201);
      expectCleanError(
        await create({ weeklyProgramId: first.body.data.weeklyProgramId }),
        409,
        /already exists/
      );
      expectCleanError(
        await create({ productionOrderId: "NOPE" }),
        404,
        "Production Order not found"
      );
      expectCleanError(await create({ machineId: "NOPE" }), 404, "Machine not found");
      expectCleanError(await create({ shiftId: "NOPE" }), 404, "Shift not found");
    });

    it("rejects bad update bodies", async () => {
      const code = wpCode();
      await create({
        weeklyProgramId: code,
        machineId: machine2,
        dayOfWeek: 4,
        weekStartDate: "2027-04-12",
        weekEndDate: "2027-04-18",
        plannedQty: 1,
      });
      const res = await (
        await api()
      )
        .put(`/api/weekly-machine-programs/${code}`)
        .set(OWNER.auth)
        .send({ plannedQty: -3, dayOfWeek: 0, status: "WHENEVER", weekStartDate: "nope" });
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.plannedQty",
          "body.dayOfWeek",
          "body.status",
          "body.weekStartDate",
        ])
      );
    });

    it("answers 404 for unknown codes on get, update and delete", async () => {
      const client = await api();
      expectCleanError(await getOne("NOPE"), 404, /not found/);
      expectCleanError(
        await client
          .put("/api/weekly-machine-programs/NOPE")
          .set(OWNER.auth)
          .send({ remarks: "x" }),
        404,
        /not found/
      );
      expectCleanError(
        await client.delete("/api/weekly-machine-programs/NOPE").set(OWNER.auth),
        404,
        /not found/
      );
    });

    it("rejects a malformed daily-planning query with a 4xx, never a 500", async () => {
      const client = await api();
      const missing = await client
        .get("/api/weekly-machine-programs/daily-planning/data")
        .set(OWNER.auth);
      expect(missing.status, JSON.stringify(missing.body).slice(0, 300)).toBeGreaterThanOrEqual(
        400
      );
      expect(missing.status).toBeLessThan(500);
      expect(missing.body.success).toBe(false);
      const bad = await client
        .get("/api/weekly-machine-programs/daily-planning/data")
        .query({ machineId: machine1, weekStartDate: "garbage" })
        .set(OWNER.auth);
      expect(bad.status, JSON.stringify(bad.body).slice(0, 300)).toBeGreaterThanOrEqual(400);
      expect(bad.status).toBeLessThan(500);
      const list = await client
        .get("/api/weekly-machine-programs")
        .query({ weekStartDate: "garbage" })
        .set(OWNER.auth);
      expect(list.status, JSON.stringify(list.body).slice(0, 300)).toBeGreaterThanOrEqual(400);
      expect(list.status).toBeLessThan(500);
    });
  });

  describe("permissions", () => {
    it("refuses every route to roles without weekly_programs.*", async () => {
      const client = await api();
      for (const user of ["demo.sales", "demo.accounts", "demo.stores"]) {
        const { auth } = await authed(user);
        expectCleanError(await client.get("/api/weekly-machine-programs").set(auth), 403);
        expectCleanError(await client.get("/api/weekly-machine-programs/next-id").set(auth), 403);
        expectCleanError(await client.get("/api/weekly-machine-programs/pending").set(auth), 403);
        expectCleanError(
          await client.get("/api/weekly-machine-programs/daily-planning/data").set(auth),
          403
        );
        expectCleanError(await client.get("/api/weekly-machine-programs/WP1").set(auth), 403);
        expectCleanError(
          await client.post("/api/weekly-machine-programs").set(auth).send(payload()),
          403
        );
        expectCleanError(
          await client.put("/api/weekly-machine-programs/WP1").set(auth).send({ remarks: "x" }),
          403
        );
        expectCleanError(await client.delete("/api/weekly-machine-programs/WP1").set(auth), 403);
      }
      expect((await client.get("/api/weekly-machine-programs")).status).toBe(401);
    });

    it("lets the production role plan", async () => {
      const prod = await authed("demo.production");
      const res = await create(
        {
          machineId: machine2,
          shiftId: shift2,
          dayOfWeek: 3,
          weekStartDate: "2027-05-03",
          weekEndDate: "2027-05-09",
          plannedQty: 1,
        },
        prod.auth
      );
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    });
  });

  describe("tenancy", () => {
    let foreignCode: string;
    let foreignPo: string;
    let foreignMachine: string;
    let foreignShift: string;

    beforeAll(async () => {
      const prisma = await getPrisma();
      foreignPo = `POF${sfx}`;
      foreignCode = `WPF${sfx}`;
      await runAsTenant(FOREIGN.companyId, async () => {
        const product = await prisma.product.findFirstOrThrow();
        const machine = await prisma.machine.findFirstOrThrow();
        const shift = await prisma.shift.findFirstOrThrow({ where: { isActive: true } });
        foreignMachine = machine.machineId;
        foreignShift = shift.shiftCode;
        await prisma.productionOrder.create({
          data: {
            productionOrderId: foreignPo,
            productItemId: product.id,
            orderDate: new Date(),
            dueDate: new Date(),
            targetQty: 100,
            uom: "PCS",
            status: "READY_FOR_PLANNING",
          } as never,
        });
        await prisma.weeklyMachineProgram.create({
          data: {
            weeklyProgramId: foreignCode,
            productionOrderId: foreignPo,
            weekStartDate: new Date(WEEK_A),
            weekEndDate: new Date(WEEK_A_END),
            machineId: foreignMachine,
            shiftId: foreignShift,
            dayOfWeek: 1,
            plannedQty: 10,
            status: "PLANNED",
          },
        });
      });
    });

    it("hides a foreign program from list, get, pending and the planning grid", async () => {
      const client = await api();
      expectCleanError(await getOne(foreignCode), 404, /not found/);
      const list = await client
        .get("/api/weekly-machine-programs")
        .query({ search: foreignCode })
        .set(OWNER.auth);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
      const pending = await client.get("/api/weekly-machine-programs/pending").set(OWNER.auth);
      expect(JSON.stringify(pending.body)).not.toContain(foreignCode);
      expect(JSON.stringify(pending.body)).not.toContain(FOREIGN.companyId);
      const grid = await client
        .get("/api/weekly-machine-programs/daily-planning/data")
        .query({ machineId: foreignMachine, weekStartDate: WEEK_A })
        .set(OWNER.auth);
      expect(grid.status).toBe(200);
      expect(JSON.stringify(grid.body)).not.toContain(foreignCode);
    });

    it("cannot update or delete a foreign program", async () => {
      const client = await api();
      expectCleanError(
        await client
          .put(`/api/weekly-machine-programs/${foreignCode}`)
          .set(OWNER.auth)
          .send({ remarks: "Hijacked" }),
        404,
        /not found/
      );
      expectCleanError(
        await client.delete(`/api/weekly-machine-programs/${foreignCode}`).set(OWNER.auth),
        404,
        /not found/
      );
      const prisma = await getPrisma();
      const row = await runAsTenant(FOREIGN.companyId, () =>
        prisma.weeklyMachineProgram.findUniqueOrThrow({
          where: byCode("weeklyProgramId", foreignCode),
        })
      );
      expect(row.remarks).toBeNull();
      expect(row.status).toBe("PLANNED");
    });

    it("cannot schedule a foreign order, machine or shift", async () => {
      expectCleanError(
        await create({ productionOrderId: foreignPo }),
        404,
        "Production Order not found"
      );
      const own = await create({ machineId: foreignMachine, dayOfWeek: 1 });
      // The demo tenant may own a machine with the same code; either way it is not the foreign row.
      if (own.status === 201) expect(own.body.data.machine.companyId).not.toBe(FOREIGN.companyId);
      else expectCleanError(own, 404, "Machine not found");
    });

    it("cannot move an own program onto a foreign order", async () => {
      const code = wpCode();
      await create({
        weeklyProgramId: code,
        machineId: machine2,
        dayOfWeek: 6,
        weekStartDate: "2027-05-10",
        weekEndDate: "2027-05-16",
        plannedQty: 1,
      });
      const res = await (
        await api()
      )
        .put(`/api/weekly-machine-programs/${code}`)
        .set(OWNER.auth)
        .send({ productionOrderId: foreignPo });
      expectCleanError(res, 404, "Production Order not found");
    });

    it("allows the same program code in two tenants", async () => {
      const res = await create({
        weeklyProgramId: foreignCode,
        machineId: machine2,
        dayOfWeek: 5,
        weekStartDate: "2027-05-17",
        weekEndDate: "2027-05-23",
        plannedQty: 1,
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    });
  });
});
