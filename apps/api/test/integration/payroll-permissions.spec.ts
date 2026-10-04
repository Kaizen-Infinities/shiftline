import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { foreignTenant } from "../helpers/foreign-tenant";
import { limitedUser } from "../helpers/limited-user";
import { createEmployee } from "../factories";

/**
 * Payroll API permissions: every /api/payroll route needs a payroll key. Shared reads (employees,
 * config, attendance) open to any payroll view key; writes and the run lifecycle need their own.
 */
const sfx = Date.now().toString(36).slice(-6);

let OWNER: { auth: Record<string, string> };

describe("payroll permissions", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("refuses the anonymous and a role with no payroll keys on every route family", async () => {
    const client = await api();
    expect((await client.get("/api/payroll/employees")).status).toBe(401);

    const none = await limitedUser(`pr${sfx}none`, ["profile.view"]);
    const gets = [
      "/api/payroll/config",
      "/api/payroll/employees",
      "/api/payroll/attendance?period=2026-04",
      "/api/payroll/runs",
      "/api/payroll/advances",
    ];
    for (const path of gets) {
      const res = await client.get(path).set(none.auth);
      expect(res.status, path).toBe(403);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|SELECT |\.ts:\d/i);
    }
    const posts = ["/api/payroll/runs", "/api/payroll/attendance", "/api/payroll/advances"];
    for (const path of posts) {
      expect((await client.post(path).set(none.auth).send({})).status, path).toBe(403);
    }
    expect((await client.put("/api/payroll/config").set(none.auth).send({})).status).toBe(403);
    expect((await client.post("/api/payroll/runs/1/approve").set(none.auth)).status).toBe(403);
    expect((await client.post("/api/payroll/runs/1/lock").set(none.auth)).status).toBe(403);
    expect((await client.delete("/api/payroll/runs/1").set(none.auth)).status).toBe(403);
    expect((await client.get("/api/payroll-statutory/rules").set(none.auth)).status).toBe(403);
    expect((await client.get("/api/labour/holidays").set(none.auth)).status).toBe(403);
  });

  it("lets a view-only role read but not write or run payroll", async () => {
    const client = await api();
    const viewer = await limitedUser(`pr${sfx}view`, ["payroll-attendance.view"]);
    expect((await client.get("/api/payroll/employees").set(viewer.auth)).status).toBe(200);
    expect((await client.get("/api/payroll/runs").set(viewer.auth)).status).toBe(200);
    // not a run-detail or advance reader
    expect((await client.get("/api/payroll/advances").set(viewer.auth)).status).toBe(403);
    expect((await client.get("/api/payroll/runs/1").set(viewer.auth)).status).toBe(403);
    expect((await client.post("/api/payroll/attendance").set(viewer.auth).send({})).status).toBe(
      403
    );
    expect((await client.post("/api/payroll/runs").set(viewer.auth).send({})).status).toBe(403);
  });

  it("opens each write to its own key", async () => {
    const client = await api();
    const editor = await limitedUser(`pr${sfx}edit`, [
      "payroll-attendance.view",
      "payroll-attendance.edit",
    ]);
    // permitted: reaches validation (400), not the permission wall
    const att = await client.post("/api/payroll/attendance").set(editor.auth).send({});
    expect(att.status).toBe(400);
    expect((await client.post("/api/payroll/runs").set(editor.auth).send({})).status).toBe(403);
  });

  it("serves the owner", async () => {
    const client = await api();
    for (const path of [
      "/api/payroll/config",
      "/api/payroll/employees",
      "/api/payroll/attendance?period=2026-04",
      "/api/payroll/runs",
      "/api/payroll/advances",
    ]) {
      const res = await client.get(path).set(OWNER.auth);
      expect(res.status, `${path} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
    }
  });

  it("keeps the auditor read-only", async () => {
    const client = await api();
    const { auth } = await authed("demo.auditor");
    expect((await client.get("/api/payroll/employees").set(auth)).status).toBe(200);
    expect((await client.post("/api/payroll/runs").set(auth).send({})).status).toBe(403);
  });

  it("never shows another tenant's employees", async () => {
    const emp = await createEmployee({ fullName: `Payroll Visible ${sfx}` });
    const foreign = await foreignTenant(`pay${sfx.slice(0, 4)}`);
    const client = await api();

    const demo = await client.get("/api/payroll/employees").set(OWNER.auth);
    expect(demo.status).toBe(200);
    expect(JSON.stringify(demo.body.data)).toContain(emp.empCode);

    const other = await client.get("/api/payroll/employees").set(foreign.auth);
    expect(other.status).toBe(200);
    expect(JSON.stringify(other.body.data)).not.toContain(emp.empCode);
    expect(JSON.stringify(other.body.data)).not.toContain("Payroll Visible");
  });
});
