import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createCustomer,
  createProduct,
  createSalesInvoice,
  demoCompany,
} from "../factories";

const DEVICE_A = "test-device-aaaa-0001";
const DEVICE_B = "test-device-bbbb-0002";
const dev = (deviceId: string, extra: Record<string, string> = {}) => ({
  "x-device-id": deviceId,
  "x-app-version": "1.0.0-test",
  "x-device-platform": "android",
  ...extra,
});

const validCollection = (customerId: string, overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  customer_id: customerId,
  amount: 100,
  payment_mode: "Cash",
  collected_at: Date.now(),
  allocations: [],
  attachments: [],
  ...overrides,
});

describe("Field app (mobile) module", () => {
  let sales: { auth: Record<string, string> };
  let owner: { auth: Record<string, string> };
  let salesUserId: string;
  let routeId: string;

  beforeAll(async () => {
    sales = await authed("demo.sales");
    owner = await authed("demo.owner");
    const prisma = await getPrisma();
    salesUserId = (
      await asDemoTenant(() => prisma.user.findUniqueOrThrow({ where: { username: "demo.sales" } }))
    ).userId;
    // The seed gives every tenant route R01; other suites may have truncated it.
    const existing = await asDemoTenant(() =>
      prisma.route.findFirst({ where: { routeCode: "R01" } })
    );
    if (existing) routeId = existing.id;
    else {
      const res = await (
        await api()
      )
        .post("/api/mobile/admin/routes")
        .set(owner.auth)
        .send({ routeCode: "R01", routeName: "City Route 1" });
      expect(res.status).toBe(201);
      routeId = res.body.data.id;
      const customers = await asDemoTenant(() => prisma.customer.findMany({ take: 3 }));
      await (
        await api()
      )
        .put(`/api/mobile/admin/routes/${routeId}/customers`)
        .set(owner.auth)
        .send({ customers: customers.map((c, i) => ({ customerId: c.id, sequence: i + 1 })) });
      await (
        await api()
      )
        .put(`/api/mobile/admin/routes/${routeId}/assignments`)
        .set(owner.auth)
        .send({ assignments: [{ agentUserId: salesUserId, dayOfWeek: null }] });
    }
  });

  it("bootstrap returns the tenant, the agent, settings and the device", async () => {
    const res = await (await api()).get("/api/mobile/bootstrap").set(sales.auth).set(dev(DEVICE_A));
    expect(res.status).toBe(200);
    expect(res.body.data.company.id).toBe((await demoCompany()).id);
    expect(res.body.data.agent.userId).toBe(salesUserId);
    expect(res.body.data.settings).toMatchObject({
      orderStatusOnSubmit: "DRAFT",
      chequeOcrEnabled: false,
      tombstoneDays: 30,
    });
    expect(res.body.data.device).toEqual({ deviceId: DEVICE_A });
  });

  it("a full pull returns masters, the route and auto-planned visits for today", async () => {
    const res = await (
      await api()
    )
      .get("/api/mobile/sync/pull?full=1")
      .set(sales.auth)
      .set(dev(DEVICE_A));
    expect(res.status).toBe(200);
    const { changes, full, timestamp } = res.body;
    expect(full).toBe(true);
    expect(typeof timestamp).toBe("number");
    expect(changes.customers.updated.length).toBeGreaterThanOrEqual(3);
    expect(changes.products.updated.length).toBeGreaterThanOrEqual(1);
    expect(changes.routes.updated.map((r: { id: string }) => r.id)).toContain(routeId);
    expect(changes.route_customers.updated.length).toBeGreaterThanOrEqual(3);
    const today = new Date().toISOString().slice(0, 10);
    const todays = changes.visits.updated.filter(
      (v: { planned_date: string }) => v.planned_date === today
    );
    expect(todays.length).toBeGreaterThanOrEqual(3);
    // Every row belongs to the demo tenant's shape: no companyId leaks onto the wire.
    expect(JSON.stringify(changes)).not.toContain("companyId");
  });

  it("push requires a device id; a pull without one still works", async () => {
    const noDevice = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .send({ changes: {} });
    expect(noDevice.status).toBe(400);
    const pull = await (await api()).get("/api/mobile/sync/pull").set(sales.auth);
    expect(pull.status).toBe(200);
  });

  it("posts a collection into the books once, even when two devices push it", async () => {
    const prisma = await getPrisma();
    const customer = await createCustomer({ outstandingAmount: new Prisma.Decimal(5000) });
    const invoice = await createSalesInvoice({
      customerId: customer.id,
      grandTotal: new Prisma.Decimal(3000),
    });
    const collection = validCollection(customer.id, {
      amount: 3500,
      allocations: [{ invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, amount: 3000 }],
    });

    const first = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A))
      .send({ lastPulledAt: Date.now(), changes: { collections: { created: [collection] } } });
    expect(first.status).toBe(200);
    expect(
      first.body.results.collections[0],
      JSON.stringify(first.body.results.collections[0])
    ).toMatchObject({ id: collection.id, status: "POSTED" });
    expect(first.body.results.collections[0].receiptNo).toMatch(/^MC-\d{4}-\d{5}$/);

    // Same record from a second device: skipped, nothing posted twice.
    const second = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_B))
      .send({ lastPulledAt: Date.now(), changes: { collections: { created: [collection] } } });
    expect(second.body.results.collections[0]).toMatchObject({
      id: collection.id,
      status: "SKIPPED",
    });

    await asDemoTenant(async () => {
      const payments = await prisma.salesInvoicePayment.findMany({
        where: { salesInvoiceId: invoice.id },
      });
      expect(payments).toHaveLength(1);
      expect(Number(payments[0].amount)).toBe(3000);
      expect(payments[0].voucherPosted).toBe(true);

      const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe("PAID");

      const stored = await prisma.mobileCollection.findUniqueOrThrow({
        where: { id: collection.id },
      });
      expect(stored).toMatchObject({
        status: "POSTED",
        deviceId: DEVICE_A,
        appVersion: "1.0.0-test",
      });
      const voucherIds = (stored.voucherIds as number[]) ?? [];
      // Invoice receipt + on-account receipt for the ₹500 remainder.
      expect(voucherIds.length).toBeGreaterThanOrEqual(2);
      const vouchers = await prisma.voucher.findMany({
        where: { id: { in: voucherIds } },
        include: { items: true },
      });
      expect(vouchers).toHaveLength(voucherIds.length);
      for (const v of vouchers) {
        expect(v.type).toBe("RECEIPT");
        const debit = v.items.reduce((s, i) => s + Number(i.debitAmount), 0);
        const credit = v.items.reduce((s, i) => s + Number(i.creditAmount), 0);
        expect(debit, `voucher ${v.voucherNo} balanced`).toBeCloseTo(credit, 2);
      }
      const total = vouchers.reduce(
        (s, v) => s + v.items.reduce((t, i) => t + Number(i.debitAmount), 0),
        0
      );
      expect(total).toBeCloseTo(3500, 2);

      const cust = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(Number(cust.outstandingAmount)).toBe(1500);
    });

    // Both devices are now registered to the sales user.
    const devices = await (await api()).get("/api/mobile/admin/devices").set(owner.auth);
    expect(devices.status).toBe(200);
    const ids = devices.body.data.map((d: { deviceId: string }) => d.deviceId);
    expect(ids).toEqual(expect.arrayContaining([DEVICE_A, DEVICE_B]));
  });

  it("creates a draft sales order and echoes it on the next pull", async () => {
    const customer = await createCustomer();
    const product = await createProduct();
    const order = {
      id: randomUUID(),
      customer_id: customer.id,
      order_date: new Date().toISOString().slice(0, 10),
      remarks: "From the field",
      items: [{ productId: String(product.id), quantity: 2 }],
    };
    const push = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A))
      .send({ changes: { orders: { created: [order] } } });
    expect(push.status).toBe(200);
    expect(push.body.results.orders[0]).toMatchObject({ id: order.id, status: "CREATED" });
    expect(push.body.results.orders[0].orderNo).toBeTruthy();

    const pull = await (await api()).get("/api/mobile/sync/pull?full=1").set(sales.auth);
    const echoed = pull.body.changes.orders.updated.find((o: { id: string }) => o.id === order.id);
    expect(echoed).toMatchObject({ status: "DRAFT", customer_id: customer.id });
    expect(echoed.order_no).toBe(push.body.results.orders[0].orderNo);
  });

  it("echoes a failed record with its error", async () => {
    const bad = validCollection(randomUUID());
    const push = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A))
      .send({ changes: { collections: { created: [bad] } } });
    expect(push.status, JSON.stringify(push.body)).toBe(200);
    expect(push.body.results.collections[0]).toMatchObject({ id: bad.id, status: "FAILED" });
    expect(push.body.results.collections[0].error).toMatch(/Customer not found/);

    const pull = await (await api()).get("/api/mobile/sync/pull?full=1").set(sales.auth);
    const echoed = pull.body.changes.collections.updated.find(
      (c: { id: string }) => c.id === bad.id
    );
    expect(echoed).toMatchObject({ status: "FAILED" });
    expect(echoed.sync_error).toMatch(/Customer not found/);
  });

  it("rejects server-owned and append-only changes without failing the push", async () => {
    const customer = await createCustomer();
    const push = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A))
      .send({
        changes: {
          customers: { updated: [{ id: customer.id, firm_name: "Renamed on device" }] },
          products: { deleted: ["1"] },
          collections: { updated: [validCollection(customer.id)] },
          orders: { deleted: [randomUUID()] },
        },
      });
    expect(push.status).toBe(200);
    const rejected = push.body.results.rejected as { table: string; reason: string }[];
    expect(rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "customers", reason: "server-owned" }),
        expect.objectContaining({ table: "products", reason: "server-owned" }),
        expect.objectContaining({ table: "collections", reason: "append-only" }),
        expect.objectContaining({ table: "orders", reason: "append-only" }),
      ])
    );
    const renamed = await asDemoTenant(async () =>
      (await getPrisma()).customer.findUniqueOrThrow({ where: { id: customer.id } })
    );
    expect(renamed.firmName).toBe(customer.firmName);
  });

  it("merges visits field by field: the office keeps the plan, the agent keeps execution", async () => {
    const prisma = await getPrisma();
    const customer = await createCustomer();
    const today = new Date().toISOString().slice(0, 10);
    const planned = await (
      await api()
    )
      .post("/api/mobile/admin/visits")
      .set(owner.auth)
      .send({
        agentUserId: salesUserId,
        plannedDate: today,
        visits: [{ customerId: customer.id, plannedTime: "10:00" }],
      });
    expect(planned.status).toBe(201);
    const visit = planned.body.data.find(
      (v: { customerId: string }) => v.customerId === customer.id
    );
    const lastPulledAt = Date.now();
    await new Promise((r) => setTimeout(r, 20));

    // The office moves the visit after the device pulled.
    await asDemoTenant(() =>
      prisma.mobileVisit.update({ where: { id: visit.id }, data: { plannedTime: "11:30" } })
    );

    const deviceCopy = {
      id: visit.id,
      customer_id: customer.id,
      planned_date: today,
      planned_time: "10:00", // stale
      sequence: visit.sequence,
      status: "COMPLETED",
      outcome: "NO_ACTION",
      check_in_at: Date.now() - 60_000,
      check_out_at: Date.now(),
      latitude: 11.0168,
      longitude: 76.9558,
      notes: "Met the owner",
    };
    const push = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A))
      .send({ lastPulledAt, changes: { visits: { updated: [deviceCopy] } } });
    expect(push.status).toBe(200);
    expect(push.body.results.visits).toMatchObject({ ok: 1, merged: [visit.id] });

    const merged = await asDemoTenant(() =>
      prisma.mobileVisit.findUniqueOrThrow({ where: { id: visit.id } })
    );
    expect(merged.plannedTime).toBe("11:30"); // office wins
    expect(merged.status).toBe("COMPLETED"); // agent wins
    expect(merged.notes).toBe("Met the owner");

    // A push whose pull is newer than the office change applies the device's plan.
    const fresh = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A))
      .send({
        lastPulledAt: Date.now(),
        changes: { visits: { updated: [{ ...deviceCopy, planned_time: "12:00" }] } },
      });
    expect(fresh.body.results.visits.merged).toEqual([]);
    const applied = await asDemoTenant(() =>
      prisma.mobileVisit.findUniqueOrThrow({ where: { id: visit.id } })
    );
    expect(applied.plannedTime).toBe("12:00");

    // Another agent's visit cannot be deleted from this device.
    const foreign = await asDemoTenant(() =>
      prisma.mobileVisit.create({
        data: {
          id: randomUUID(),
          agentUserId: "someone-else",
          customerId: customer.id,
          plannedDate: new Date(`${today}T00:00:00.000Z`),
        },
      })
    );
    const del = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A))
      .send({ changes: { visits: { deleted: [foreign.id] } } });
    expect(del.body.results.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "visits", reason: "not-owner", ids: [foreign.id] }),
      ])
    );
  });

  it("returns tombstones for route customers removed by the office", async () => {
    const prisma = await getPrisma();
    const before = await asDemoTenant(() =>
      prisma.mobileRouteCustomer.findMany({
        where: { routeId, deletedAt: null },
        orderBy: { sequence: "asc" },
      })
    );
    expect(before.length).toBeGreaterThanOrEqual(2);
    const removed = before[before.length - 1];
    const keep = before.slice(0, -1);
    const res = await (
      await api()
    )
      .put(`/api/mobile/admin/routes/${routeId}/customers`)
      .set(owner.auth)
      .send({ customers: keep.map((c) => ({ customerId: c.customerId, sequence: c.sequence })) });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(keep.length);

    const pull = await (await api()).get("/api/mobile/sync/pull?full=1").set(sales.auth);
    expect(pull.body.changes.route_customers.deleted).toContain(removed.id);
    expect(
      pull.body.changes.route_customers.updated.map((r: { id: string }) => r.id)
    ).not.toContain(removed.id);

    // Putting the customer back restores the same row (no duplicate).
    await (
      await api()
    )
      .put(`/api/mobile/admin/routes/${routeId}/customers`)
      .set(owner.auth)
      .send({ customers: before.map((c) => ({ customerId: c.customerId, sequence: c.sequence })) });
    const after = await asDemoTenant(() =>
      prisma.mobileRouteCustomer.findMany({ where: { routeId, deletedAt: null } })
    );
    expect(after).toHaveLength(before.length);
  });

  it("refuses a revoked device until it is restored", async () => {
    const list = await (await api()).get("/api/mobile/admin/devices").set(owner.auth);
    const deviceB = list.body.data.find((d: { deviceId: string }) => d.deviceId === DEVICE_B);
    expect(deviceB).toBeTruthy();

    const revoke = await (
      await api()
    )
      .post(`/api/mobile/admin/devices/${deviceB.id}/revoke`)
      .set(owner.auth);
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revokedAt).toBeTruthy();

    const push = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_B))
      .send({ changes: {} });
    expect(push.status).toBe(403);
    expect(push.body.message).toBe("DEVICE_REVOKED");
    const pos = await (
      await api()
    )
      .post("/api/mobile/position")
      .set(sales.auth)
      .set(dev(DEVICE_B))
      .send({ positions: [{ latitude: 11, longitude: 77, recorded_at: Date.now() }] });
    expect(pos.status).toBe(403);

    const hidden = await (await api()).get("/api/mobile/admin/devices").set(owner.auth);
    expect(hidden.body.data.map((d: { deviceId: string }) => d.deviceId)).not.toContain(DEVICE_B);

    const restore = await (
      await api()
    )
      .post(`/api/mobile/admin/devices/${deviceB.id}/restore`)
      .set(owner.auth);
    expect(restore.status).toBe(200);
    const ok = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_B))
      .send({ changes: {} });
    expect(ok.status).toBe(200);
  });

  it("warns about clock skew but stores what was sent", async () => {
    const skewed = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A, { "x-device-time": String(Date.now() - 10 * 60 * 1000) }))
      .send({ changes: {} });
    expect(skewed.status).toBe(200);
    expect(skewed.body.results.warnings).toEqual([expect.objectContaining({ code: "CLOCK_SKEW" })]);
    const inSync = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(dev(DEVICE_A, { "x-device-time": String(Date.now()) }))
      .send({ changes: {} });
    expect(inSync.body.results.warnings).toEqual([]);
  });

  it("stores positions and serves the latest point per agent", async () => {
    const now = Date.now();
    const post = await (
      await api()
    )
      .post("/api/mobile/position")
      .set(sales.auth)
      .set(dev(DEVICE_A))
      .send({
        positions: [
          { latitude: 11.0168, longitude: 76.9558, recorded_at: now - 60_000, speed_kmh: 20 },
          { latitude: 11.02, longitude: 76.96, recorded_at: now, speed_kmh: 32, battery_pct: 80 },
        ],
      });
    expect(post.status).toBe(201);
    expect(post.body.stored).toBe(2);

    const latest = await (await api()).get("/api/mobile/admin/positions").set(owner.auth);
    expect(latest.status).toBe(200);
    const me = latest.body.data.find((p: { agentUserId: string }) => p.agentUserId === salesUserId);
    expect(me).toMatchObject({
      deviceId: DEVICE_A,
      latitude: 11.02,
      longitude: 76.96,
      speedKmh: 32,
      batteryPct: 80,
      agentName: expect.any(String),
    });
    expect(me.today.plannedVisits).toBeGreaterThanOrEqual(1);
    expect(typeof me.today.collections).toBe("number");
  });

  it("keeps office endpoints away from field users", async () => {
    const routes = await (await api()).get("/api/mobile/admin/routes").set(sales.auth);
    expect(routes.status).toBe(403);
    const devices = await (await api()).get("/api/mobile/admin/devices").set(sales.auth);
    expect(devices.status).toBe(403);
  });
});
