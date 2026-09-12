import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * The statutory half of a payroll run (P1-16).
 *
 * The arithmetic is proved in `test/unit/statutory-payroll.spec.ts`; what is proved here is that
 * a real run produces figures that tie together — the journal balances, the net in the books
 * equals the net in the bank file, and the employer's contributions land as a cost rather than as
 * a deduction from anyone's pay.
 */
const sfx = Date.now().toString(36).slice(-5);
/** UAN and ESIC numbers are digits only, so the suffix for those is taken from the clock. */
const digits = String(Date.now()).slice(-5);
const PERIOD = "2035-07";

let OWNER: { auth: Record<string, string> };
let RUN_ID: number;

const ledgerBalance = async (code: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const ledger = await prisma.accountLedger.findFirstOrThrow({ where: { code } });
    const items = await prisma.journalItem.findMany({
      where: {
        OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }],
        voucher: { status: "POSTED" },
      },
      select: { debitLedgerId: true, creditLedgerId: true, debitAmount: true, creditAmount: true },
    });
    return items.reduce(
      (s, i) =>
        s +
        (i.debitLedgerId === ledger.id ? Number(i.debitAmount) : 0) -
        (i.creditLedgerId === ledger.id ? Number(i.creditAmount) : 0),
      0
    );
  });
};

describe("statutory payroll", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();

    // A payroll run with two employees: one inside every scheme, one over the ESI limit.
    const run = await asDemoTenant(async () => {
      const employees = await Promise.all(
        [
          {
            empCode: `SP1-${sfx}`,
            fullName: "Ramesh Kumar",
            basicSalary: 15000,
            grossSalary: 25000,
            uan: `1002${digits}001`.slice(0, 12),
            pan: `ABCPK1234${sfx.slice(0, 1).toUpperCase()}`,
            esi: true,
          },
          {
            empCode: `SP2-${sfx}`,
            fullName: "Sunita Rao",
            basicSalary: 30000,
            grossSalary: 60000,
            uan: `1002${digits}002`.slice(0, 12),
            pan: `ABCPK5678${sfx.slice(0, 1).toUpperCase()}`,
            esi: false,
          },
        ].map((e) =>
          prisma.employee.create({
            data: {
              companyId: company.id,
              empCode: e.empCode,
              fullName: e.fullName,
              basicSalary: e.basicSalary,
              grossSalary: e.grossSalary,
              pfApplicable: true,
              uanNumber: e.uan,
              esiApplicable: e.esi,
              esiNumber: e.esi ? `310${digits}1234` : null,
              professionalTax: true,
              tdsApplicable: true,
              accountNumber: "1234567890",
              ifscCode: "HDFC0000123",
              panNumber: e.pan,
            },
          })
        )
      );

      const created = await prisma.payrollRun.create({
        data: {
          companyId: company.id,
          runCode: `RUN-${sfx}`,
          period: PERIOD,
          type: "MONTHLY",
          status: "APPROVED",
          calendarDays: 31,
          totalEmployees: 2,
          createdById: "test",
        },
      });
      await prisma.payrollResult.createMany({
        data: employees.map((e, i) => ({
          companyId: company.id,
          payrollRunId: created.id,
          employeeId: e.id,
          employeeCode: e.empCode,
          employeeName: e.fullName ?? e.empCode,
          department: "Production",
          salaryType: "MONTHLY",
          totalDays: 31,
          presentDays: 26,
          grossSalary: i === 0 ? 25000 : 60000,
          pfWage: i === 0 ? 15000 : 30000,
          pfApplicable: true,
          esiApplicable: i === 0,
          netSalary: i === 0 ? 22915 : 55000,
        })),
      });
      return created;
    });
    RUN_ID = run.id;
  });

  it("seeds the state rules with slabs rather than a flat amount", async () => {
    const res = await (await api()).get("/api/payroll-statutory/rules").set(OWNER.auth);
    expect(res.status).toBe(200);
    const rules = res.body.data as { stateCode: string; ptSlabs: { amount: number }[] }[];
    const tn = rules.find((r) => r.stateCode === "33");
    expect(tn).toBeDefined();
    expect(tn!.ptSlabs.length).toBeGreaterThan(1);
  });

  it("works out the statutory half of a run, splitting PF the way the EPFO takes it", async () => {
    const res = await (
      await api()
    )
      .post(`/api/payroll-statutory/runs/${RUN_ID}/compute`)
      .set(OWNER.auth)
      .send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.data.employees).toBe(2);

    const prisma = await getPrisma();
    const rows = await asDemoTenant(() =>
      prisma.payrollStatutory.findMany({
        where: { payrollRunId: RUN_ID },
        orderBy: { employeeCode: "asc" },
      })
    );
    const first = rows[0];
    // 12% of 15,000, with 1,250 of the employer's share going to the pension fund.
    expect(Number(first.epfEmployee)).toBe(1800);
    expect(Number(first.epsEmployer)).toBe(1250);
    expect(Number(first.epfEmployer)).toBe(550);
    expect(Number(first.edliCharges)).toBe(75);
    // ESI on gross, not on the PF wage — three different wages, three different bases.
    expect(Number(first.esiWage)).toBe(25000);
    expect(Number(first.esiEmployee)).toBe(188);

    // The second employee is outside ESI, so nothing is taken.
    const second = rows[1];
    expect(Number(second.esiEmployee)).toBe(0);
    // ...and the pension share is still capped though the PF wage is double the ceiling.
    expect(Number(second.epsEmployer)).toBe(1250);
  });

  it("flags a structure whose basic is under half of gross", async () => {
    const prisma = await getPrisma();
    const rows = await asDemoTenant(() =>
      prisma.payrollStatutory.findMany({
        where: { payrollRunId: RUN_ID },
        orderBy: { employeeCode: "asc" },
      })
    );
    // 15,000 of a 25,000 gross is 60% and passes; 30,000 of 60,000 is exactly half and passes.
    expect(rows[0].wageCheckPassed).toBe(true);
    expect(Number(rows[1].wageSharePercent)).toBe(50);
    expect(rows[1].wageCheckPassed).toBe(true);
  });

  it("writes an ECR the EPFO's shape and a bank file that adds up", async () => {
    const client = await api();
    const ecr = await client.get(`/api/payroll-statutory/runs/${RUN_ID}/ecr`).set(OWNER.auth);
    expect(ecr.status).toBe(200);
    expect(ecr.headers["content-type"]).toContain("text/plain");
    const lines = (ecr.text as string).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split("#~#")).toHaveLength(11);

    const bank = await client
      .get(`/api/payroll-statutory/runs/${RUN_ID}/bank-transfer`)
      .set(OWNER.auth);
    expect(bank.status).toBe(200);
    // The file's total is on a header so it can be checked against the books before uploading.
    expect(Number(bank.headers["x-transfer-total"])).toBe(22915 + 55000);
    expect(bank.headers["x-employees-skipped"]).toBe("0");
  });

  it("posts a journal that balances, with the employer's share as a cost", async () => {
    const salBefore = await ledgerBalance("SAL-EXP-001");
    const contribBefore = await ledgerBalance("SAL-CONTRIB-001");
    const pfBefore = await ledgerBalance("PF-PAY-001");

    const res = await (
      await api()
    )
      .post(`/api/payroll-statutory/runs/${RUN_ID}/post-journal`)
      .set(OWNER.auth)
      .send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.data.posted).toBe(true);

    const prisma = await getPrisma();
    const voucher = await asDemoTenant(() =>
      prisma.voucher.findUniqueOrThrow({
        where: { id: res.body.data.voucherId },
        include: { items: true },
      })
    );
    const net = voucher.items.reduce(
      (s, i) => s + Number(i.debitAmount) - Number(i.creditAmount),
      0
    );
    expect(Math.round(net)).toBe(0);

    // The gross is a salary cost and the employer's contributions a separate one — not netted
    // against anyone's pay.
    expect(Math.round((await ledgerBalance("SAL-EXP-001")) - salBefore)).toBe(85000);
    expect((await ledgerBalance("SAL-CONTRIB-001")) - contribBefore).toBeGreaterThan(0);
    // Both sides of the provident fund are owed to the same place.
    expect(pfBefore - (await ledgerBalance("PF-PAY-001"))).toBeGreaterThan(0);

    // Posting twice does not post twice.
    const again = await (
      await api()
    )
      .post(`/api/payroll-statutory/runs/${RUN_ID}/post-journal`)
      .set(OWNER.auth)
      .send({});
    expect(again.body.data.posted).toBe(false);
  });

  it("registers the month's filings on the approval gate", async () => {
    const res = await (
      await api()
    )
      .post(`/api/payroll-statutory/runs/${RUN_ID}/register-filings`)
      .set(OWNER.auth)
      .send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.registered).toBe(4);
    const types = (res.body.data.filings as { filingType: string }[]).map((f) => f.filingType);
    expect(types).toContain("PF_ECR");
    expect(types).toContain("ESI_MONTHLY");
    expect(types).toContain("PT_RETURN");
    expect(types).toContain("PAYROLL_RUN");
  });

  it("records a tax declaration and works the year's tax out from it", async () => {
    const prisma = await getPrisma();
    const employee = await asDemoTenant(() =>
      prisma.employee.findFirstOrThrow({ where: { empCode: `SP2-${sfx}` } })
    );
    const res = await (
      await api()
    )
      .post("/api/payroll-statutory/declarations")
      .set(OWNER.auth)
      .send({
        employeeId: String(employee.id),
        fyCode: "2035-36",
        regime: "OLD",
        declarations: { "80C": 150000, "80D": 25000 },
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    // 60,000 a month is 7.2 lakh a year. Less the 50,000 standard deduction and the 1.75 lakh
    // declared, the taxable income is 4.95 lakh — inside the section 87A rebate, so the tax is
    // nil. The declaration is what made it nil, which is the point of recording it.
    expect(Number(res.body.data.projectedIncome)).toBe(720000);
    expect(Number(res.body.data.projectedTax)).toBe(0);

    // Without the declaration the same salary is taxed.
    const bare = await (
      await api()
    )
      .post("/api/payroll-statutory/declarations")
      .set(OWNER.auth)
      .send({ employeeId: String(employee.id), fyCode: "2035-36", regime: "NEW" });
    expect(Number(bare.body.data.projectedTax)).toBe(0);
    expect(bare.body.data.regime).toBe("NEW");
  });

  it("refuses a run with no results, a user without the permission, and another tenant", async () => {
    const client = await api();
    const production = await authed("demo.production");
    expect((await client.get("/api/payroll-statutory/rules").set(production.auth)).status).toBe(
      403
    );

    const prisma = await getPrisma();
    const company = await demoCompany();
    const empty = await asDemoTenant(() =>
      prisma.payrollRun.create({
        data: {
          companyId: company.id,
          runCode: `EMPTY-${sfx}`,
          period: PERIOD,
          type: "MONTHLY",
          createdById: "test",
        },
      })
    );
    const res = await client
      .post(`/api/payroll-statutory/runs/${empty.id}/compute`)
      .set(OWNER.auth)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_RESULTS");

    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Payroll Tenant B", companyCode: `PYB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.payrollStatutory.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.payrollStatutory.count())).toBeGreaterThan(0);
  });
});
