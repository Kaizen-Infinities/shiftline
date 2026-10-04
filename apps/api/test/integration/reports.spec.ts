import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { expectCleanError } from "../helpers/clean-error";
import { foreignTenant } from "../helpers/foreign-tenant";
import { activeShifts, createMachine, createPlannableOrder } from "../helpers/planning";
import { asDemoTenant, createCustomer, createProduct, createSupplier } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";
import { byCode } from "../../src/lib/prisma";

/**
 * Reports (R-04, characterisation). Pins today's behaviour of `apps/api/src/modules/reports/`:
 * five read-only reports, all behind `reports.view` (Owner and Accounts hold it):
 *  - machines: status, planned vs actual quantity and efficiency per machine;
 *  - weekly-programs: progress of each weekly program against hourly output of its order;
 *  - production-orders/:id: one order with a 24-hour breakdown;
 *  - sales-orders and purchase-orders: paged lists with filters.
 * Date filters on the first two apply only when both ends are given.
 */
const sfx = Date.now().toString(36).slice(-5).toUpperCase();

let OWNER: { auth: Record<string, string> };
let FOREIGN: Awaited<ReturnType<typeof foreignTenant>>;
let machine: string;
let poId: string;
let wpId: string;
let shift: string;
let customer: Awaited<ReturnType<typeof createCustomer>>;
const salesOrderNos: string[] = [];
let supplier: Awaited<ReturnType<typeof createSupplier>>;
const poNumbers: string[] = [];

const get = async (path: string, query: Record<string, unknown> = {}, auth = OWNER.auth) =>
  (await api()).get(`/api/reports${path}`).query(query).set(auth);

describe("reports", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    FOREIGN = await foreignTenant("xrep");
    const prisma = await getPrisma();
    shift = (await activeShifts())[0].shiftCode;

    // Production: a machine running an order, a weekly program for 100 of its 200, 50 produced.
    machine = `MR${sfx}`;
    await createMachine(machine);
    const { order } = await createPlannableOrder(OWNER.auth, `PR${sfx}`, 200);
    poId = order.productionOrderId;
    wpId = `WR${sfx}`;
    const wp = await (await api()).post("/api/weekly-machine-programs").set(OWNER.auth).send({
      weeklyProgramId: wpId,
      productionOrderId: poId,
      weekStartDate: "2029-01-01",
      weekEndDate: "2029-01-07",
      machineId: machine,
      shiftId: shift,
      dayOfWeek: 1,
      plannedQty: 100,
    });
    expect(wp.status, JSON.stringify(wp.body).slice(0, 300)).toBe(201);
    await asDemoTenant(async () => {
      await prisma.productionOrder.update({
        where: byCode("productionOrderId", poId),
        data: {
          machineMachineId: machine,
          status: "IN_PROGRESS",
          orderDate: new Date("2029-01-02"),
        },
      });
      for (const [hourIndex, qty] of [
        [1, 30],
        [2, 20],
      ]) {
        await prisma.hourlyProduction.create({
          data: {
            productionOrderId: poId,
            machineId: machine,
            shiftId: shift,
            productionDate: new Date("2029-01-01"),
            hourIndex,
            qtyProduced: qty,
          } as never,
        });
      }
    });

    // Sales: two orders for one customer.
    customer = await createCustomer();
    const product = await createProduct();
    for (const [i, date] of [
      [1, "2029-02-01"],
      [2, "2029-02-10"],
    ] as const) {
      const orderNo = `SO-R${sfx}-${i}`;
      salesOrderNos.push(orderNo);
      const res = await (
        await api()
      )
        .post("/api/sales-orders")
        .set(OWNER.auth)
        .send({
          orderNo,
          orderDate: date,
          customerId: customer.id,
          status: i === 1 ? "CONFIRMED" : "DRAFT",
          orderType: "telephone",
          salesPersonName: "Asha",
          items: [{ productId: product.id.toString(), quantity: 4 * i, unitPrice: 50 }],
        });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    }

    // Purchases: two orders for one supplier.
    supplier = await createSupplier();
    const owner = await asDemoTenant(() =>
      prisma.user.findFirstOrThrow({ where: { username: "demo.owner" } })
    );
    for (const [i, date] of [
      [1, "2029-03-01"],
      [2, "2029-03-15"],
    ] as const) {
      const poNumber = `PO-R${sfx}-${i}`;
      poNumbers.push(poNumber);
      await asDemoTenant(() =>
        prisma.purchaseOrder.create({
          data: {
            poNumber,
            poDate: new Date(date),
            expectedDeliveryDate: new Date(date),
            supplierId: supplier.id,
            status: i === 1 ? "APPROVED" : "DRAFT",
            netAmount: 118 * i,
            totalTax: 18 * i,
            billingAddressLine1: "1 Bill St",
            billingCity: "Chennai",
            billingState: "Tamil Nadu",
            billingPincode: "600001",
            shippingAddressLine1: "2 Ship St",
            shippingCity: "Chennai",
            shippingState: "Tamil Nadu",
            shippingPincode: "600002",
            createdBy: owner.userId,
            items: {
              create: [
                {
                  productId: "RM-X",
                  uom: "KG",
                  quantity: 10 * i,
                  unitPrice: 10,
                  lineTotal: 100 * i,
                },
              ],
            },
          } as never,
        })
      );
    }
  });

  describe("machine report", () => {
    it("reports status, plan, target and efficiency per machine", async () => {
      const res = await get("/machines");
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      const row = res.body.data.find((m: { machineId: string }) => m.machineId === machine);
      expect(row.status).toBe("RUNNING");
      expect(row.isActive).toBe(true);
      expect(row.activeProductionOrder).toMatchObject({
        productionOrderId: poId,
        targetQty: 200,
        status: "IN_PROGRESS",
      });
      expect(row.metrics).toEqual({
        totalWeeklyPlannedQty: 100,
        totalTargetQty: 200,
        totalActualQty: 50,
        efficiencyPercentage: 50,
      });
    });

    it("narrows by date range only when both ends are given", async () => {
      const inside = await get("/machines", { startDate: "2029-01-01", endDate: "2029-01-31" });
      const hit = inside.body.data.find((m: { machineId: string }) => m.machineId === machine);
      expect(hit.metrics.totalActualQty).toBe(50);
      const outside = await get("/machines", { startDate: "2030-01-01", endDate: "2030-01-31" });
      const miss = outside.body.data.find((m: { machineId: string }) => m.machineId === machine);
      expect(miss.metrics).toEqual({
        totalWeeklyPlannedQty: 0,
        totalTargetQty: 0,
        totalActualQty: 0,
        efficiencyPercentage: 0,
      });
      // One end alone is ignored.
      const half = await get("/machines", { startDate: "2030-01-01" });
      expect(
        half.body.data.find((m: { machineId: string }) => m.machineId === machine).metrics
          .totalActualQty
      ).toBe(50);
    });

    it("shows an inactive machine as INACTIVE", async () => {
      const code = `MX${sfx}`;
      await createMachine(code, { isActive: false });
      const res = await get("/machines");
      expect(res.body.data.find((m: { machineId: string }) => m.machineId === code).status).toBe(
        "INACTIVE"
      );
    });
  });

  describe("weekly program report", () => {
    it("reports progress of each program against the order's hourly output", async () => {
      const res = await get("/weekly-programs");
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      const row = res.body.data.find(
        (w: { weeklyProgramId: string }) => w.weeklyProgramId === wpId
      );
      expect(row).toMatchObject({
        machineId: machine,
        plannedQty: 100,
        totalActualQty: 50,
        progressPercentage: 50,
        productionOrdersCount: 1,
        status: "PLANNED",
      });
      expect(row.machineName).toContain(machine);
    });

    it("filters by week range", async () => {
      const inside = await get("/weekly-programs", {
        startDate: "2029-01-01",
        endDate: "2029-01-07",
      });
      expect(inside.body.data.map((w: { weeklyProgramId: string }) => w.weeklyProgramId)).toContain(
        wpId
      );
      const outside = await get("/weekly-programs", {
        startDate: "2030-01-01",
        endDate: "2030-01-07",
      });
      expect(
        outside.body.data.map((w: { weeklyProgramId: string }) => w.weeklyProgramId)
      ).not.toContain(wpId);
    });
  });

  describe("production order report", () => {
    it("reports totals and a 24-hour breakdown", async () => {
      const res = await get(`/production-orders/${poId}`);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      const r = res.body.data;
      expect(r).toMatchObject({
        productionOrderId: poId,
        machineId: machine,
        targetQty: 200,
        totalQtyProduced: 50,
        remainingQty: 150,
        progressPercentage: 25,
        status: "IN_PROGRESS",
      });
      expect(r.hourlyBreakdown).toHaveLength(24);
      expect(r.hourlyBreakdown[0]).toMatchObject({ hourIndex: 1, qtyProduced: 30 });
      expect(r.hourlyBreakdown[1]).toMatchObject({ hourIndex: 2, qtyProduced: 20 });
      expect(r.hourlyBreakdown[2]).toMatchObject({ hourIndex: 3, qtyProduced: 0, loggedAt: null });
    });

    it("404s on an unknown order", async () => {
      expectCleanError(await get("/production-orders/NOPE"), 404, /not found/);
    });
  });

  describe("sales order report", () => {
    it("lists orders with customer, totals and items", async () => {
      const res = await get("/sales-orders", { customerId: customer.id });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.data).toMatchObject({ total: 2, page: 1, totalPages: 1 });
      const [newest, oldest] = res.body.data.data;
      // Newest order date first.
      expect(newest.orderNo).toBe(salesOrderNos[1]);
      expect(oldest.orderNo).toBe(salesOrderNos[0]);
      expect(newest).toMatchObject({
        itemsCount: 1,
        totalQty: 8,
        netAmount: 400,
        status: "DRAFT",
        customerCode: customer.customerCode,
      });
      expect(newest.items[0].quantity).toBe(8);
    });

    it("filters by number, status, sales person, type and date range, and pages", async () => {
      const q = { customerId: customer.id };
      expect(
        (await get("/sales-orders", { ...q, orderNo: salesOrderNos[0].toLowerCase() })).body.data
          .total
      ).toBe(1);
      expect((await get("/sales-orders", { ...q, status: "CONFIRMED" })).body.data.total).toBe(1);
      expect((await get("/sales-orders", { ...q, salesPersonName: "ash" })).body.data.total).toBe(
        2
      );
      expect((await get("/sales-orders", { ...q, orderType: "TELE" })).body.data.total).toBe(2);
      expect(
        (await get("/sales-orders", { ...q, startDate: "2029-02-05", endDate: "2029-02-28" })).body
          .data.total
      ).toBe(1);
      const paged = await get("/sales-orders", { ...q, limit: "1", page: "2" });
      expect(paged.body.data).toMatchObject({ total: 2, page: 2, totalPages: 2 });
      expect(paged.body.data.data).toHaveLength(1);
      expect(paged.body.data.data[0].orderNo).toBe(salesOrderNos[0]);
    });

    it("rejects malformed filters with a clean 400", async () => {
      expectCleanError(
        await get("/sales-orders", { customerId: "not-a-uuid" }),
        400,
        "Validation failed"
      );
      expectCleanError(
        await get("/sales-orders", { status: "WHENEVER" }),
        400,
        "Validation failed"
      );
      expectCleanError(
        await get("/sales-orders", { startDate: "garbage", endDate: "2029-01-01" }),
        400,
        "Validation failed"
      );
      expectCleanError(await get("/sales-orders", { page: "0" }), 400, "Validation failed");
      expectCleanError(await get("/sales-orders", { page: "-2" }), 400, "Validation failed");
      expectCleanError(await get("/sales-orders", { limit: "abc" }), 400, "Validation failed");
      expectCleanError(await get("/sales-orders", { limit: "100000" }), 400, "Validation failed");
    });
  });

  describe("purchase order report", () => {
    it("lists orders with supplier, tax, addresses and items", async () => {
      const res = await get("/purchase-orders", { supplierId: supplier.id });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.data).toMatchObject({ total: 2, page: 1, totalPages: 1 });
      const [newest] = res.body.data.data;
      expect(newest).toMatchObject({
        poNumber: poNumbers[1],
        supplierCode: supplier.supplierCode,
        netAmount: 236,
        totalTax: 36,
        itemsCount: 1,
        status: "DRAFT",
        billingAddress: "1 Bill St Chennai Tamil Nadu 600001",
        shippingAddress: "2 Ship St Chennai Tamil Nadu 600002",
      });
      expect(newest.items[0]).toEqual({ productId: "RM-X", quantity: 20, uom: "KG" });
    });

    it("filters by number, status, date range and pages", async () => {
      const q = { supplierId: String(supplier.id) };
      expect(
        (await get("/purchase-orders", { ...q, poNumber: poNumbers[0].toLowerCase() })).body.data
          .total
      ).toBe(1);
      expect((await get("/purchase-orders", { ...q, status: "APPROVED" })).body.data.total).toBe(1);
      expect(
        (await get("/purchase-orders", { ...q, startDate: "2029-03-10", endDate: "2029-03-31" }))
          .body.data.total
      ).toBe(1);
      const paged = await get("/purchase-orders", { ...q, limit: "1", page: "2" });
      expect(paged.body.data.data.map((p: { poNumber: string }) => p.poNumber)).toEqual([
        poNumbers[0],
      ]);
    });

    it("rejects malformed filters with a clean 400", async () => {
      expectCleanError(
        await get("/purchase-orders", { supplierId: "abc" }),
        400,
        "Validation failed"
      );
      expectCleanError(
        await get("/purchase-orders", { supplierId: "99999999999999" }),
        400,
        "Validation failed"
      );
      expectCleanError(await get("/purchase-orders", { page: "0" }), 400, "Validation failed");
      expectCleanError(
        await get("/purchase-orders", { endDate: "garbage" }),
        400,
        "Validation failed"
      );
    });
  });

  describe("input validation on the other reports", () => {
    it("rejects bad dates with a clean 400, never a 500", async () => {
      expectCleanError(
        await get("/machines", { startDate: "garbage", endDate: "2029-01-31" }),
        400,
        "Validation failed"
      );
      expectCleanError(
        await get("/weekly-programs", { startDate: "2029-01-01", endDate: "soon" }),
        400,
        "Validation failed"
      );
      expectCleanError(await get("/production-orders/" + "P".repeat(30)), 400, "Validation failed");
    });
  });

  describe("permissions", () => {
    // reports.view is not a registered permission, so the routes use the registered
    // production-reports / sales-reports / purchase-reports keys (Owner and Auditor hold them).
    const routes = [
      "/machines",
      "/weekly-programs",
      "/production-orders/ANY",
      "/sales-orders",
      "/purchase-orders",
    ];

    it("refuses roles without the matching report key, and anonymous callers", async () => {
      for (const user of ["demo.sales", "demo.stores", "demo.production", "demo.accounts"]) {
        const { auth } = await authed(user);
        for (const path of routes) expectCleanError(await get(path, {}, auth), 403);
      }
      for (const path of routes) {
        expect((await (await api()).get(`/api/reports${path}`)).status).toBe(401);
      }
    });

    it("lets the owner and the read-only auditor read every report", async () => {
      const auditor = await authed("demo.auditor");
      for (const path of ["/machines", "/weekly-programs", "/sales-orders", "/purchase-orders"]) {
        expect((await get(path, {}, OWNER.auth)).status, path).toBe(200);
        expect((await get(path, {}, auditor.auth)).status, path).toBe(200);
      }
      expect((await get(`/production-orders/${poId}`, {}, auditor.auth)).status).toBe(200);
    });
  });

  describe("tenancy", () => {
    let foreignPo: string;
    let foreignMachine: string;
    let foreignCustomerId: string;
    let foreignSupplierId: number;
    let foreignSoNo: string;
    let foreignPoNo: string;

    beforeAll(async () => {
      const prisma = await getPrisma();
      foreignPo = `PF${sfx}`;
      foreignSoNo = `SO-F${sfx}`;
      foreignPoNo = `PO-F${sfx}`;
      await runAsTenant(FOREIGN.companyId, async () => {
        const product = await prisma.product.findFirstOrThrow();
        const m = await prisma.machine.findFirstOrThrow();
        const owner = await prisma.user.findFirstOrThrow();
        const cust = await prisma.customer.findFirstOrThrow();
        const sup = await prisma.supplier.findFirstOrThrow();
        foreignMachine = m.machineId;
        foreignCustomerId = cust.id;
        foreignSupplierId = sup.id;
        await prisma.productionOrder.create({
          data: {
            productionOrderId: foreignPo,
            productItemId: product.id,
            orderDate: new Date("2029-01-02"),
            dueDate: new Date("2029-02-02"),
            targetQty: 999,
            uom: "PCS",
            status: "IN_PROGRESS",
            machineMachineId: m.machineId,
          } as never,
        });
        await prisma.salesOrder.create({
          data: {
            orderNo: foreignSoNo,
            orderDate: new Date("2029-02-02"),
            customerId: cust.id,
            createdBy: owner.userId,
          },
        });
        await prisma.purchaseOrder.create({
          data: {
            poNumber: foreignPoNo,
            poDate: new Date("2029-03-02"),
            expectedDeliveryDate: new Date("2029-03-02"),
            supplierId: sup.id,
            billingAddressLine1: "x",
            billingCity: "x",
            billingState: "x",
            billingPincode: "600001",
            shippingAddressLine1: "x",
            shippingCity: "x",
            shippingState: "x",
            shippingPincode: "600001",
          } as never,
        });
      });
    });

    it("404s on a foreign production order", async () => {
      expectCleanError(await get(`/production-orders/${foreignPo}`), 404, /not found/);
    });

    it("never lists foreign rows in any report", async () => {
      const machines = await get("/machines");
      expect(JSON.stringify(machines.body)).not.toContain(FOREIGN.companyId);
      const mine = machines.body.data.map((m: { machineId: string }) => m.machineId);
      // The foreign machine code may coincide with a demo one; if so it is the demo row's data.
      const row = machines.body.data.find(
        (m: { machineId: string }) => m.machineId === foreignMachine
      );
      if (row) expect(row.activeProductionOrder?.productionOrderId).not.toBe(foreignPo);
      expect(mine).toContain(machine);

      const wps = await get("/weekly-programs");
      expect(JSON.stringify(wps.body)).not.toContain(FOREIGN.companyId);

      const so = await get("/sales-orders", { orderNo: foreignSoNo });
      expect(so.body.data).toMatchObject({ total: 0, data: [] });
      const soByCustomer = await get("/sales-orders", { customerId: foreignCustomerId });
      expect(soByCustomer.body.data.total).toBe(0);

      const po = await get("/purchase-orders", { poNumber: foreignPoNo });
      expect(po.body.data).toMatchObject({ total: 0, data: [] });
      const poBySupplier = await get("/purchase-orders", { supplierId: String(foreignSupplierId) });
      expect(
        poBySupplier.body.data.data.map((p: { poNumber: string }) => p.poNumber)
      ).not.toContain(foreignPoNo);
    });
  });
});
