import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { limitedUser } from "../helpers/limited-user";
import { createEmployee } from "../factories";

/** H31: the shared payroll employee list must not leak pay, bank or identity data to every payroll-view role. */
const sfx = Date.now().toString(36).slice(-6);

describe("GET /api/payroll/employees redaction", () => {
  it("masks documents for all, and hides pay and family data from an attendance-only role", async () => {
    const emp = await createEmployee({
      aadhaarNumber: String(Date.now()).padEnd(12, "7").slice(0, 12),
      panNumber: "ABCDE1234F",
      accountNumber: "9988776655",
      bankName: "Test Bank",
      grossSalary: 45000,
      fatherName: "Secret Father",
      personalMobile: "9000000001",
    });
    const client = await api();

    const attendanceOnly = await limitedUser(`h31${sfx}a`, ["payroll-attendance.view"]);
    const res = await client.get("/api/payroll/employees").set(attendanceOnly.auth);
    expect(res.status).toBe(200);
    const row = res.body.data.find((e: { id: string | number }) => String(e.id) === String(emp.id));
    expect(row.empCode).toBe(emp.empCode);
    expect(row.panNumber).toBe("XXXXXX234F");
    expect(row.aadhaarNumber).toMatch(/^X{8}\d{4}$/);
    for (const k of ["grossSalary", "accountNumber", "bankName", "fatherName", "personalMobile"]) {
      expect(row, k).not.toHaveProperty(k);
    }
    expect(JSON.stringify(res.body)).not.toContain("9988776655");

    const owner = await authed("demo.owner");
    const full = await client.get("/api/payroll/employees").set(owner.auth);
    const ownerRow = full.body.data.find(
      (e: { id: string | number }) => String(e.id) === String(emp.id)
    );
    expect(String(ownerRow.accountNumber)).toBe("9988776655");
    expect(ownerRow.panNumber).toBe("XXXXXX234F");
    expect(ownerRow).not.toHaveProperty("fatherName");
  });
});
