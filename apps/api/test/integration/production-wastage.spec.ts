import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { expectCleanError } from "../helpers/clean-error";
import { foreignTenant } from "../helpers/foreign-tenant";
import { limitedUser } from "../helpers/limited-user";
import { asDemoTenant, createProduct } from "../factories";

/**
 * Production wastage (R-02): the seven routes use their own `production-wastages.*` keys
 * (view for reads, create, edit for update/approve/reject, delete) instead of `machines.view`.
 */
const sfx = Date.now().toString(36).slice(-5);

let OWNER: { auth: Record<string, string> };
let productId: number;
let machineId: string;
let shiftId: string;
let productionOrderId: string;
let dayCounter = 0;

/** A body that is valid and unique (one wastage per order, shift and date). */
const body = (over: Record<string, unknown> = {}) => {
  dayCounter += 1;
  return {
    wastageDate: `2032-03-${String(dayCounter).padStart(2, "0")}`,
    productionOrderId,
    machineId,
    shiftId,
    productId,
    wastageType: "SCRAP",
    quantity: 2.5,
    uom: "NOS",
    reason: "Flash on edges",
    ...over,
  };
};

const create = async (over: Record<string, unknown> = {}) => {
  const res = await (await api()).post("/api/production-wastages").set(OWNER.auth).send(body(over));
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data as { id: string; wastageNo: string; status: string };
};

describe("production wastage", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const product = await createProduct();
    productId = Number(product.id);
    machineId = `WM-${sfx}`;
    shiftId = `WS-${sfx}`;
    productionOrderId = `WPO-${sfx}`;
    await asDemoTenant(async () => {
      await prisma.machine.create({ data: { machineId, machineName: `Wastage Machine ${sfx}` } });
      await prisma.shift.create({
        data: { shiftCode: shiftId, shiftName: `WS ${sfx}`, startTime: "06:00", endTime: "14:00" },
      });
      await prisma.productionOrder.create({
        data: {
          productionOrderId,
          orderDate: new Date("2032-03-01T00:00:00.000Z"),
          dueDate: new Date("2032-04-01T00:00:00.000Z"),
          productItemId: product.id,
          targetQty: 100,
          uom: "NOS",
        },
      });
    });
  });

  it("creates, lists, reads, edits, approves and deletes a log", async () => {
    const client = await api();
    const made = await create();
    expect(made.status).toBe("DRAFT");
    expect(made.wastageNo).toMatch(/^WST-\d{8}-\d{4}$/);

    const list = await client.get("/api/production-wastages").set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: any) => r.id)).toContain(made.id);

    const filtered = await client
      .get("/api/production-wastages")
      .query({ productionOrderId, status: "DRAFT" })
      .set(OWNER.auth);
    expect(filtered.body.data.every((r: any) => r.productionOrderId === productionOrderId)).toBe(
      true
    );

    const one = await client.get(`/api/production-wastages/${made.id}`).set(OWNER.auth);
    expect(one.status).toBe(200);
    expect(one.body.data.wastageNo).toBe(made.wastageNo);

    const edited = await client
      .put(`/api/production-wastages/${made.id}`)
      .set(OWNER.auth)
      .send({ quantity: 4, reason: "Edited" });
    expect(edited.status).toBe(200);
    expect(Number(edited.body.data.quantity)).toBe(4);

    const approved = await client
      .post(`/api/production-wastages/${made.id}/approve`)
      .set(OWNER.auth);
    expect(approved.status, JSON.stringify(approved.body).slice(0, 300)).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");

    // An approved log is frozen.
    expectCleanError(
      await client.put(`/api/production-wastages/${made.id}`).set(OWNER.auth).send({ quantity: 1 }),
      400
    );
    expectCleanError(
      await client.delete(`/api/production-wastages/${made.id}`).set(OWNER.auth),
      400
    );
    expectCleanError(
      await client.post(`/api/production-wastages/${made.id}/approve`).set(OWNER.auth),
      400
    );
    expectCleanError(
      await client.post(`/api/production-wastages/${made.id}/reject`).set(OWNER.auth),
      400
    );

    const draft = await create();
    const rejected = await client
      .post(`/api/production-wastages/${draft.id}/reject`)
      .set(OWNER.auth);
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");

    const toDelete = await create();
    expect(
      (await client.delete(`/api/production-wastages/${toDelete.id}`).set(OWNER.auth)).status
    ).toBe(200);
    expectCleanError(
      await client.get(`/api/production-wastages/${toDelete.id}`).set(OWNER.auth),
      404
    );
  });

  it("rejects invalid input with a clean error", async () => {
    const client = await api();
    const post = (b: Record<string, unknown>) =>
      client.post("/api/production-wastages").set(OWNER.auth).send(b);

    expectCleanError(await post({}), 400);
    for (const [label, over] of Object.entries({
      "missing date": { wastageDate: "" },
      "missing order": { productionOrderId: "" },
      "missing machine": { machineId: "" },
      "missing shift": { shiftId: "" },
      "bad product id": { productId: 0 },
      "bad wastage type": { wastageType: "NOT_A_TYPE" },
      "zero quantity": { quantity: 0 },
      "negative quantity": { quantity: -3 },
      "string quantity": { quantity: "lots" },
      "missing uom": { uom: "" },
      "negative value": { estimatedValue: -1 },
      "bad status": { status: "LOST" },
      "overlong reason": { reason: "x".repeat(300) },
    })) {
      const res = await post(body(over));
      expect(res.status, label).toBe(400);
      expect(res.body.success, label).toBe(false);
    }

    const made = await create();
    expectCleanError(await client.get("/api/production-wastages/abc").set(OWNER.auth), 400);
    expectCleanError(
      await client.put("/api/production-wastages/abc").set(OWNER.auth).send({ quantity: 1 }),
      400
    );
    expectCleanError(
      await client
        .put(`/api/production-wastages/${made.id}`)
        .set(OWNER.auth)
        .send({ quantity: -1 }),
      400
    );
    expectCleanError(await client.delete("/api/production-wastages/abc").set(OWNER.auth), 400);
    expectCleanError(
      await client.post("/api/production-wastages/abc/approve").set(OWNER.auth),
      400
    );
    expectCleanError(await client.post("/api/production-wastages/abc/reject").set(OWNER.auth), 400);

    // Business rejections: unknown references and a second log for the same order, shift and date.
    expectCleanError(await post(body({ productionOrderId: "NOPE" })), 404);
    expectCleanError(await post(body({ machineId: "NOPE" })), 404);
    expectCleanError(await post(body({ shiftId: "NOPE" })), 404);
    expectCleanError(await post(body({ productId: 999999999 })), 404);
    expectCleanError(await post(body({ rawMaterialId: "NOPE" })), 404);
    const date = "2032-06-15";
    await create({ wastageDate: date });
    expectCleanError(await post(body({ wastageDate: date })), 409);
    expectCleanError(await client.get("/api/production-wastages/999999999").set(OWNER.auth), 404);
  });

  it("gates each route on its own production-wastages key, not machines.view", async () => {
    const client = await api();
    const made = await create();
    const paths = {
      list: () => (auth: any) => client.get("/api/production-wastages").set(auth),
      one: () => (auth: any) => client.get(`/api/production-wastages/${made.id}`).set(auth),
      create: () => (auth: any) => client.post("/api/production-wastages").set(auth).send(body()),
      edit: () => (auth: any) =>
        client.put(`/api/production-wastages/${made.id}`).set(auth).send({ quantity: 1 }),
      approve: () => (auth: any) =>
        client.post(`/api/production-wastages/${made.id}/approve`).set(auth),
      reject: () => (auth: any) =>
        client.post(`/api/production-wastages/${made.id}/reject`).set(auth),
      remove: () => (auth: any) => client.delete(`/api/production-wastages/${made.id}`).set(auth),
    };

    // The storekeeper and accountant hold no production-wastages key.
    for (const user of ["demo.stores", "demo.accounts", "demo.auditor"]) {
      const { auth } = await authed(user);
      for (const [name, call] of Object.entries(paths)) {
        const res = await call()(auth);
        expect(res.status, `${user} ${name}`).toBe(403);
      }
    }
    // The production supervisor keeps working.
    const prod = await authed("demo.production");
    expect((await paths.list()(prod.auth)).status).toBe(200);

    // machines.view alone no longer opens anything.
    const machinesOnly = await limitedUser(`wastmach${sfx}`, ["machines.view"]);
    for (const [name, call] of Object.entries(paths)) {
      expect((await call()(machinesOnly.auth)).status, `machines.view ${name}`).toBe(403);
    }

    // view-only: reads pass, writes do not.
    const viewer = await limitedUser(`wastview${sfx}`, ["production-wastages.view"]);
    expect((await paths.list()(viewer.auth)).status).toBe(200);
    expect((await paths.one()(viewer.auth)).status).toBe(200);
    for (const name of ["create", "edit", "approve", "reject", "remove"] as const) {
      expect((await paths[name]()(viewer.auth)).status, `viewer ${name}`).toBe(403);
    }

    // Each write key opens only its own routes.
    const creator = await limitedUser(`wastcreate${sfx}`, ["production-wastages.create"]);
    expect((await paths.create()(creator.auth)).status).toBe(201);
    expect((await paths.list()(creator.auth)).status).toBe(403);
    const editor = await limitedUser(`wastedit${sfx}`, ["production-wastages.edit"]);
    expect((await paths.edit()(editor.auth)).status).toBe(200);
    const deleter = await limitedUser(`wastdel${sfx}`, ["production-wastages.delete"]);
    expect((await paths.remove()(deleter.auth)).status).toBe(200);
    expect((await paths.edit()(deleter.auth)).status).toBe(403);

    expect((await client.get("/api/production-wastages")).status).toBe(401);
  });

  it("never shows or touches another tenant's wastage", async () => {
    const client = await api();
    const mine = await create();
    const foreign = await foreignTenant(`wst${sfx}`);

    const list = await client.get("/api/production-wastages").set(foreign.auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);

    expectCleanError(
      await client.get(`/api/production-wastages/${mine.id}`).set(foreign.auth),
      404
    );
    expectCleanError(
      await client
        .put(`/api/production-wastages/${mine.id}`)
        .set(foreign.auth)
        .send({ quantity: 9 }),
      404
    );
    expectCleanError(
      await client.post(`/api/production-wastages/${mine.id}/approve`).set(foreign.auth),
      404
    );
    expectCleanError(
      await client.post(`/api/production-wastages/${mine.id}/reject`).set(foreign.auth),
      404
    );
    expectCleanError(
      await client.delete(`/api/production-wastages/${mine.id}`).set(foreign.auth),
      404
    );

    // The foreign owner cannot log against this tenant's order, machine or shift.
    expectCleanError(
      await client.post("/api/production-wastages").set(foreign.auth).send(body()),
      404
    );

    // And the demo log is untouched.
    const still = await client.get(`/api/production-wastages/${mine.id}`).set(OWNER.auth);
    expect(still.status).toBe(200);
    expect(still.body.data.status).toBe("DRAFT");
  });
});
