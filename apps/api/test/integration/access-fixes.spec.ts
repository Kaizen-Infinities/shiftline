import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The paid OCR provider is stubbed: the budget tests count calls that reach it.
const parse = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse };
  },
}));

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, demoCompany } from "../factories";
import { hashPassword } from "../../src/utils/hashPassword";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { env } from "../../src/config/env";
import { resetOcrBudgets } from "../../src/modules/mobile/mobile.ocr.service";

/**
 * Access-control regressions: route permissions on production/inventory endpoints, the credit
 * endpoint, leave ownership, mobile visit field ownership, tenant-scoped references and the
 * paid OCR budget.
 */
const sfx = Date.now().toString(36).slice(-5);
const PASSWORD = "Test@12345678";

type Auth = { Authorization: string };
let NONE: Auth; // a role with no permissions at all
let OWNER: Auth;
let LEAVE_A: { auth: Auth; employeeId: string; userId: string };
let LEAVE_B: { auth: Auth; employeeId: string; userId: string };

/** A user in the demo tenant whose role holds exactly `keys`, optionally linked to an employee. */
const makeUser = async (name: string, keys: string[], withEmployee = false) => {
  const prisma = await getPrisma();
  const username = `af.${name}.${sfx}`;
  let employeeId = "";
  let userId = "";
  await asDemoTenant(async () => {
    const company = await demoCompany();
    const role = await prisma.role.create({
      data: { companyId: company.id, code: `AF-${name}-${sfx}`.toUpperCase(), name: username },
    });
    if (keys.length) {
      const perms = await withoutTenant(() =>
        prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } })
      );
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
    const employee = withEmployee
      ? await prisma.employee.create({
          data: {
            companyId: company.id,
            empCode: `AF-${name}-${sfx}`,
            fullName: `Access ${name}`,
            status: "active",
          },
        })
      : null;
    if (employee) employeeId = String(employee.id);
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        username,
        fullName: `Access ${name}`,
        email: `${username}@test.shiftline.local`,
        passwordHash: await hashPassword(PASSWORD),
        employeeId: employee?.id ?? null,
        roleId: role.id,
        status: "active",
      },
    });
    userId = user.userId;
  });
  const login = await (
    await api()
  )
    .post("/api/auth/login")
    .send({ email: username, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body).slice(0, 300)).toBe(200);
  return {
    auth: { Authorization: `Bearer ${login.body.data.accessToken}` } as Auth,
    employeeId,
    userId,
  };
};

beforeAll(async () => {
  OWNER = (await authed("demo.owner")).auth;
  NONE = (await makeUser("none", [])).auth;
  LEAVE_A = await makeUser("la", ["leave.view", "leave.request"], true);
  LEAVE_B = await makeUser("lb", ["leave.view", "leave.request"], true);
});

describe("F06/F10: route permissions", () => {
  const today = new Date().toISOString().slice(0, 10);
  const cases: [string, string, Record<string, unknown>?][] = [
    ["get", "/api/product-capacity-history/product/1"],
    ["get", "/api/product-capacity-history/product/1/machine/M1"],
    [
      "post",
      "/api/product-capacity-history/manual",
      { productId: 1, date: today, shift: "A", machine: "M1", newCapacity: 5 },
    ],
    [
      "post",
      "/api/product-shift-records",
      {
        productId: 1,
        productionOrderId: "PO",
        machineId: "M",
        shiftId: "S",
        achievedQty: 1,
        targetQty: 1,
      },
    ],
    ["get", "/api/product-shift-records/product/1"],
    ["get", "/api/inventory/eod-stock"],
    ["post", "/api/inventory/eod-stock/run-now"],
    ["get", `/api/customers/${randomUUID()}/credit-status`],
  ];

  it.each(cases)("%s %s is refused without a permission", async (method, path, body) => {
    const client = await api();
    const req = method === "get" ? client.get(path) : client.post(path).send(body ?? {});
    const res = await req.set(NONE);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
  });

  it("run-now needs its own key, validates the date and still works for the owner", async () => {
    const viewOnly = (await makeUser("eodview", ["eod-stock.view", "eod-stock.edit"])).auth;
    const denied = await (
      await api()
    )
      .post("/api/inventory/eod-stock/run-now")
      .set(viewOnly)
      .send({});
    expect(denied.status).toBe(403);

    const future = await (
      await api()
    )
      .post("/api/inventory/eod-stock/run-now")
      .query({ date: "2999-01-01" })
      .set(OWNER)
      .send({});
    expect(future.status).toBe(400);
    const ancient = await (
      await api()
    )
      .post("/api/inventory/eod-stock/run-now")
      .query({ date: "2001-01-01" })
      .set(OWNER)
      .send({});
    expect(ancient.status).toBe(400);
  });

  it("the manual capacity body is validated", async () => {
    const res = await (
      await api()
    )
      .post("/api/product-capacity-history/manual")
      .set(OWNER)
      .send({ productId: 1, date: "not-a-date", newCapacity: -4 });
    expect(res.status).toBe(400);
  });

  it("the credit endpoint accepts a customer viewer", async () => {
    const viewer = (await makeUser("custview", ["customers.view"])).auth;
    const customer = await createCustomer();
    const res = await (await api()).get(`/api/customers/${customer.id}/credit-status`).set(viewer);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  });
});

describe("F07: leave ownership", () => {
  const request = (auth: Auth, employeeId: string, day: string) =>
    api().then((c) =>
      c.post("/api/leave/requests").set(auth).send({
        employeeId,
        leaveTypeCode: "LWP",
        fromDate: day,
        toDate: day,
      })
    );

  it("a requester can only create for themselves", async () => {
    const res = await request(LEAVE_A.auth, LEAVE_B.employeeId, "2038-06-02");
    expect(res.status).toBe(403);
  });

  it("A cannot cancel B's request, and cannot cancel an approved one of their own", async () => {
    // Make sure the leave types exist for the tenant.
    await (await api()).get("/api/labour/leave-types").set(OWNER);
    const b = await request(LEAVE_B.auth, LEAVE_B.employeeId, "2038-06-03");
    expect(b.status, JSON.stringify(b.body).slice(0, 300)).toBe(201);
    const foreign = await (
      await api()
    )
      .post(`/api/leave/requests/${b.body.data.id}/cancel`)
      .set(LEAVE_A.auth)
      .send({});
    expect(foreign.status).toBe(404);

    // The owner (leave.approve) can still act for anyone.
    const own = await request(LEAVE_A.auth, LEAVE_A.employeeId, "2038-06-04");
    expect(own.status, JSON.stringify(own.body).slice(0, 300)).toBe(201);
    const approved = await (
      await api()
    )
      .post(`/api/leave/requests/${own.body.data.id}/approve`)
      .set(OWNER)
      .send({});
    expect(approved.status, JSON.stringify(approved.body).slice(0, 300)).toBe(200);
    const selfCancel = await (
      await api()
    )
      .post(`/api/leave/requests/${own.body.data.id}/cancel`)
      .set(LEAVE_A.auth)
      .send({});
    expect(selfCancel.status).toBe(403);

    // A's own pending request can be withdrawn.
    const pending = await request(LEAVE_A.auth, LEAVE_A.employeeId, "2038-06-05");
    const withdrawn = await (
      await api()
    )
      .post(`/api/leave/requests/${pending.body.data.id}/cancel`)
      .set(LEAVE_A.auth)
      .send({});
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.status).toBe("CANCELLED");
  });

  it("two concurrent cancels restore the balance once", async () => {
    const prisma = await getPrisma();
    const made = await request(OWNER, LEAVE_B.employeeId, "2038-06-09");
    expect(made.status, JSON.stringify(made.body).slice(0, 300)).toBe(201);
    const id = made.body.data.id as string;
    await (await api()).post(`/api/leave/requests/${id}/approve`).set(OWNER).send({});
    const taken = async () =>
      asDemoTenant(async () =>
        Number(
          (
            await prisma.leaveBalance.findFirst({
              where: { employeeId: BigInt(LEAVE_B.employeeId), fyCode: made.body.data.fyCode },
            })
          )?.taken ?? 0
        )
      );
    const before = await taken();
    const client = await api();
    const results = await Promise.all([
      client.post(`/api/leave/requests/${id}/cancel`).set(OWNER).send({}),
      client.post(`/api/leave/requests/${id}/cancel`).set(OWNER).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await taken()).toBe(before - 1);
  });
});

describe("F08/F09: mobile visits", () => {
  let sales: { auth: Auth };
  let salesUserId: string;

  beforeAll(async () => {
    sales = await authed("demo.sales");
    const prisma = await getPrisma();
    salesUserId = (
      await asDemoTenant(() => prisma.user.findUniqueOrThrow({ where: { username: "demo.sales" } }))
    ).userId;
  });

  const device = {
    "x-device-id": "af-device-0001",
    "x-app-version": "1.0.0-test",
    "x-device-platform": "android",
  };

  const plan = async () => {
    const customer = await createCustomer();
    const today = new Date().toISOString().slice(0, 10);
    const res = await (
      await api()
    )
      .post("/api/mobile/admin/visits")
      .set(OWNER)
      .send({
        agentUserId: salesUserId,
        plannedDate: today,
        visits: [{ customerId: customer.id, plannedTime: "10:00" }],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const visit = res.body.data.find((v: { customerId: string }) => v.customerId === customer.id);
    return { customer, visit, today };
  };

  it.each([
    ["null", null],
    ["omitted", undefined],
    ["a stale value", 1],
    ["a just-valid value", () => Date.now()],
  ])("a device update cannot change planning fields with %s as the cursor", async (_n, cursor) => {
    const prisma = await getPrisma();
    const { customer, visit, today } = await plan();
    const other = await createCustomer();
    const body: Record<string, unknown> = {
      changes: {
        visits: {
          updated: [
            {
              id: visit.id,
              customer_id: other.id,
              planned_date: "2031-01-01",
              planned_time: "23:59",
              sequence: 99,
              status: "COMPLETED",
              notes: "done",
            },
          ],
        },
      },
    };
    if (cursor !== undefined) body.lastPulledAt = typeof cursor === "function" ? cursor() : cursor;
    const res = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(device)
      .send(body);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.results.visits.ok).toBe(1);
    const row = await asDemoTenant(() =>
      prisma.mobileVisit.findUniqueOrThrow({ where: { id: visit.id } })
    );
    expect(row.customerId).toBe(customer.id);
    expect(row.plannedTime).toBe("10:00");
    expect(row.plannedDate.toISOString().slice(0, 10)).toBe(today);
    expect(row.sequence).toBe(visit.sequence);
    expect(row.status).toBe("COMPLETED"); // execution fields still merge
    expect(row.notes).toBe("done");
  });

  it("rejects a future or malformed cursor", async () => {
    const client = await api();
    for (const lastPulledAt of [Date.now() + 3_600_000, "yesterday", -5]) {
      const res = await client
        .post("/api/mobile/sync/push")
        .set(sales.auth)
        .set(device)
        .send({ lastPulledAt, changes: {} });
      expect(res.status, String(lastPulledAt)).toBe(400);
    }
  });

  it("refuses a foreign customer on a pushed visit, a route-customer update and planning", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "AF Tenant B", companyCode: `AFB-${sfx}` } })
    );
    const foreignCustomer = await runAsTenant(other.id, () =>
      prisma.customer.create({
        data: { customerCode: `AFC-${sfx}`, firmName: "Foreign Customer", createdBy: "x" },
      })
    );
    const today = new Date().toISOString().slice(0, 10);

    const visitId = randomUUID();
    const push = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(sales.auth)
      .set(device)
      .send({
        changes: {
          visits: {
            created: [
              {
                id: visitId,
                customer_id: foreignCustomer.id,
                planned_date: today,
                sequence: 1,
                status: "PLANNED",
              },
            ],
          },
        },
      });
    expect(push.status).toBe(200);
    expect(push.body.results.visits.failed).toHaveLength(1);
    expect(await asDemoTenant(() => prisma.mobileVisit.count({ where: { id: visitId } }))).toBe(0);

    const planned = await (
      await api()
    )
      .post("/api/mobile/admin/visits")
      .set(OWNER)
      .send({
        agentUserId: salesUserId,
        plannedDate: today,
        visits: [{ customerId: foreignCustomer.id }],
      });
    expect(planned.status).toBe(404);

    const route = await (
      await api()
    )
      .post("/api/mobile/admin/routes")
      .set(OWNER)
      .send({ routeCode: `AF${sfx}`, routeName: "AF route" });
    expect(route.status).toBe(201);
    const rc = await (
      await api()
    )
      .put(`/api/mobile/admin/routes/${route.body.data.id}/customers`)
      .set(OWNER)
      .send({ customers: [{ customerId: foreignCustomer.id, sequence: 1 }] });
    expect(rc.status).toBe(404);
    const assign = await (
      await api()
    )
      .put(`/api/mobile/admin/routes/${route.body.data.id}/assignments`)
      .set(OWNER)
      .send({ assignments: [{ agentUserId: randomUUID(), dayOfWeek: null }] });
    expect(assign.status).toBe(404);
  });

  it("refuses a foreign customer type or grade on a customer", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "AF Tenant C", companyCode: `AFC2-${sfx}` } })
    );
    const foreignType = await runAsTenant(other.id, () =>
      prisma.customerType.create({ data: { name: `Foreign type ${sfx}` } })
    );
    const foreignGrade = await runAsTenant(other.id, () =>
      prisma.customerGrade.create({ data: { name: `Foreign grade ${sfx}` } })
    );
    const created = await (
      await api()
    )
      .post("/api/customers")
      .set(OWNER)
      .send({
        customerCode: `AFX-${sfx}`,
        firmName: "Cross tenant",
        customerTypeId: foreignType.id,
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(400);

    const customer = await createCustomer();
    const updated = await (
      await api()
    )
      .put(`/api/customers/${customer.id}`)
      .set(OWNER)
      .send({ customerGradeId: foreignGrade.id });
    expect(updated.status, JSON.stringify(updated.body).slice(0, 300)).toBe(400);
  });
});

describe("API-03: cheque OCR budget", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  );
  const ocr = async (auth: Auth) =>
    (await api())
      .post("/api/mobile/ocr/cheque")
      .set(auth)
      .set({ "x-device-id": "af-device-0002", "x-app-version": "1.0.0-test" })
      .attach("image", png, { filename: "cheque.png", contentType: "image/png" });

  it("answers 429 before calling the provider once the user budget is spent", async () => {
    const mutable = env as unknown as Record<string, unknown>;
    const saved = { key: env.ANTHROPIC_API_KEY, user: env.MOBILE_OCR_USER_PER_HOUR };
    mutable.ANTHROPIC_API_KEY = "test-key";
    mutable.MOBILE_OCR_USER_PER_HOUR = 2;
    resetOcrBudgets();
    parse.mockReset();
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { confidence: "high", warnings: [] },
    });
    try {
      const sales = (await authed("demo.sales")).auth;
      expect((await ocr(sales)).status).toBe(200);
      expect((await ocr(sales)).status).toBe(200);
      const third = await ocr(sales);
      expect(third.status).toBe(429);
      expect(JSON.stringify(third.body)).not.toMatch(/anthropic|api key/i);
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      mutable.ANTHROPIC_API_KEY = saved.key;
      mutable.MOBILE_OCR_USER_PER_HOUR = saved.user;
      resetOcrBudgets();
    }
  });

  it("caps concurrent provider calls", async () => {
    const mutable = env as unknown as Record<string, unknown>;
    const saved = { key: env.ANTHROPIC_API_KEY, max: env.MOBILE_OCR_MAX_CONCURRENT };
    mutable.ANTHROPIC_API_KEY = "test-key";
    mutable.MOBILE_OCR_MAX_CONCURRENT = 1;
    resetOcrBudgets();
    parse.mockReset();
    let release!: () => void;
    parse.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              stop_reason: "end_turn",
              parsed_output: { confidence: "high", warnings: [] },
            });
        })
    );
    try {
      const sales = (await authed("demo.sales")).auth;
      const first = ocr(sales).then((r) => r);
      await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
      const second = await ocr(sales);
      expect(second.status).toBe(429);
      release();
      expect((await first).status).toBe(200);
    } finally {
      mutable.ANTHROPIC_API_KEY = saved.key;
      mutable.MOBILE_OCR_MAX_CONCURRENT = saved.max;
      resetOcrBudgets();
    }
  });
});
