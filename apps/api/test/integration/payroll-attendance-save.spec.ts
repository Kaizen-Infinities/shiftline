import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createEmployee } from "../factories";

/**
 * Attendance save (QA C08 / PAY-B01): POST /api/payroll/attendance used a batch
 * `prisma.$transaction([...])`, which the tenant-scoped client rejects, so every save returned 500
 * and nothing was stored. The save now runs in one interactive transaction.
 */
const sfx = Date.now().toString(36).slice(-6);
// Far from the periods other suites use; no payroll run exists for it, so the lock check passes.
const PERIOD = "2041-03";

let OWNER: { auth: Record<string, string> };
let empA: { id: bigint };
let empB: { id: bigint };

const rec = (employeeId: bigint, date: string, status = "PRESENT") => ({
  employeeId: Number(employeeId),
  date,
  status,
  otHours: 0,
  lateMinutes: 0,
  permissionMinutes: 0,
  salaryAdvance: 0,
});

describe("payroll attendance save", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    empA = await createEmployee({ empCode: `ATT-A-${sfx}`, fullName: "Attendance Save A" });
    empB = await createEmployee({ empCode: `ATT-B-${sfx}`, fullName: "Attendance Save B" });
  });

  it("saves an empty batch (the Clear action) without a server error", async () => {
    const client = await api();
    const res = await client
      .post("/api/payroll/attendance")
      .set(OWNER.auth)
      .send({ period: PERIOD, records: [] });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.count).toBe(0);
  });

  it("saves a single record and persists it", async () => {
    const client = await api();
    const res = await client
      .post("/api/payroll/attendance")
      .set(OWNER.auth)
      .send({ period: PERIOD, records: [rec(empA.id, "2041-03-02", "ABSENT")] });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.count).toBe(1);

    const rows = await asDemoTenant(async () =>
      (await getPrisma()).attendanceRecord.findMany({
        where: { employeeId: empA.id, period: PERIOD },
      })
    );
    expect(rows.map((r) => [r.date, r.status])).toEqual([["2041-03-02", "ABSENT"]]);
  });

  it("saves several records across two employees and updates an existing day", async () => {
    const client = await api();
    const first = await client
      .post("/api/payroll/attendance")
      .set(OWNER.auth)
      .send({
        period: PERIOD,
        records: [
          rec(empA.id, "2041-03-03"),
          rec(empA.id, "2041-03-04", "HALF_DAY"),
          rec(empB.id, "2041-03-03", "LEAVE_PAID"),
        ],
      });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);
    expect(first.body.data.count).toBe(3);

    // Re-saving the same employee/day is an update, not a second row.
    const again = await client
      .post("/api/payroll/attendance")
      .set(OWNER.auth)
      .send({
        period: PERIOD,
        records: [rec(empA.id, "2041-03-03", "LEAVE_UNPAID")],
      });
    expect(again.status).toBe(200);

    const rows = await asDemoTenant(async () =>
      (await getPrisma()).attendanceRecord.findMany({
        where: { period: PERIOD, employeeId: { in: [empA.id, empB.id] } },
        orderBy: [{ employeeId: "asc" }, { date: "asc" }],
      })
    );
    const summary = rows.map((r) => [r.employeeId.toString(), r.date, r.status]);
    expect(summary).toEqual([
      [empA.id.toString(), "2041-03-02", "ABSENT"],
      [empA.id.toString(), "2041-03-03", "LEAVE_UNPAID"],
      [empA.id.toString(), "2041-03-04", "HALF_DAY"],
      [empB.id.toString(), "2041-03-03", "LEAVE_PAID"],
    ]);
  });
});
