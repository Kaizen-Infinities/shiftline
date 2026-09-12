import { describe, expect, it } from "vitest";

import {
  ESI_WAGE_LIMIT,
  PF_WAGE_CEILING,
  esiSplit,
  pfSplit,
  professionalTax,
  salaryTax,
  wageCheck,
  type PtSlab,
} from "../../src/modules/payroll/statutory.calc";
import {
  buildBankTransferFile,
  buildEcr,
  buildEsicFile,
  buildPtSummary,
  type StatutoryLine,
} from "../../src/modules/payroll/statutory.files";

/**
 * The statutory arithmetic (P1-16). Every one of these is a rule a portal or an inspector will
 * check, so they are tested against the rule rather than against the implementation.
 */
describe("provident fund", () => {
  it("splits the employer's 12% into pension and provident fund", () => {
    const split = pfSplit({ pfWage: 15000 });
    // The employee's 12% of 15,000.
    expect(split.epfEmployee).toBe(1800);
    // 8.33% of 15,000 is 1,250 — the pension share, and its ceiling.
    expect(split.epsEmployer).toBe(1250);
    // Whatever the pension did not take out of the employer's 12%.
    expect(split.epfEmployer).toBe(550);
    expect(split.epsEmployer + split.epfEmployer).toBe(1800);
    // 0.5% each, on top of the 12%.
    expect(split.edliCharges).toBe(75);
    expect(split.pfAdminCharges).toBe(75);
  });

  it("caps the contribution at the wage ceiling unless the employer says otherwise", () => {
    const capped = pfSplit({ pfWage: 40000 });
    expect(capped.epfEmployee).toBe(1800);
    expect(capped.epsEmployer).toBe(1250);

    const uncapped = pfSplit({ pfWage: 40000, contributeOnFullWage: true });
    expect(uncapped.epfEmployee).toBe(4800);
    // The pension share stays at the ceiling however much the employer contributes on: 1,250 is
    // the most the scheme ever takes, and the rest of the 12% goes to the provident fund.
    expect(uncapped.epsEmployer).toBe(1250);
    expect(uncapped.epfEmployer).toBe(3550);
    expect(PF_WAGE_CEILING).toBe(15000);
  });

  it("stops the pension share for someone the scheme no longer covers", () => {
    const split = pfSplit({ pfWage: 15000, pensionExempt: true });
    expect(split.epsEmployer).toBe(0);
    // The whole 12% goes to the provident fund instead — it is not saved.
    expect(split.epfEmployer).toBe(1800);
  });

  it("adds voluntary contributions without the employer matching them", () => {
    const split = pfSplit({ pfWage: 15000, vpfPercent: 8 });
    expect(split.vpf).toBe(1200);
    // The employer's side is untouched by the employee's voluntary extra.
    expect(split.epsEmployer + split.epfEmployer).toBe(1800);
  });
});

describe("employees' state insurance", () => {
  it("takes 0.75% and 3.25%, rounded up", () => {
    const split = esiSplit(20000, true);
    expect(split.esiEmployee).toBe(150);
    expect(split.esiEmployer).toBe(650);

    // The scheme rounds up: 0.75% of 10,001 is 75.0075, and the contribution is 76.
    expect(esiSplit(10001, true).esiEmployee).toBe(76);
  });

  it("contributes nothing when the employee is not covered", () => {
    const split = esiSplit(30000, false);
    expect(split.applicable).toBe(false);
    expect(split.esiEmployee).toBe(0);
    expect(ESI_WAGE_LIMIT).toBe(21000);
  });
});

describe("professional tax", () => {
  const tnSlabs: PtSlab[] = [
    { upTo: 21000, amount: 0 },
    { upTo: 30000, amount: 135 },
    { upTo: 45000, amount: 315 },
    { upTo: Number.MAX_SAFE_INTEGER, amount: 1250 },
  ];

  it("follows the state's slab rather than a flat amount", () => {
    expect(professionalTax(18000, tnSlabs, 7)).toBe(0);
    expect(professionalTax(25000, tnSlabs, 7)).toBe(135);
    expect(professionalTax(40000, tnSlabs, 7)).toBe(315);
    expect(professionalTax(200000, tnSlabs, 7)).toBe(1250);
  });

  it("charges a month-specific slab only in that month", () => {
    const maharashtra: PtSlab[] = [
      { upTo: 25000, amount: 0 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 300, month: 2 },
    ];
    // February carries the extra hundred that makes the year 2,500.
    expect(professionalTax(50000, maharashtra, 2)).toBe(200);
    expect(professionalTax(50000, maharashtra, 7)).toBe(200);
    // ...and a slab restricted to a month charges nothing in the others.
    expect(
      professionalTax(50000, [{ upTo: Number.MAX_SAFE_INTEGER, amount: 300, month: 2 }], 7)
    ).toBe(0);
  });
});

describe("the Code on Wages check", () => {
  it("passes when basic and dearness allowance are half of gross or more", () => {
    expect(wageCheck(15000, 30000).passed).toBe(true);
    expect(wageCheck(20000, 30000).passed).toBe(true);
  });

  it("fails and says what the shortfall is", () => {
    const check = wageCheck(9000, 30000);
    expect(check.passed).toBe(false);
    expect(check.sharePercent).toBe(30);
    // PF, gratuity and bonus all follow this wage, which is why the Code puts a floor under it.
    expect(check.shortfall).toBe(6000);
  });
});

describe("tax on salary", () => {
  it("takes nothing under the new regime up to the rebate", () => {
    // 12 lakh of salary, less the 75,000 standard deduction, is inside the rebate.
    const tax = salaryTax({ annualGross: 1200000, regime: "NEW" });
    expect(tax.taxableIncome).toBe(1125000);
    expect(tax.totalTax).toBe(0);
    expect(tax.monthlyDeduction).toBe(0);
  });

  it("charges the slabs above the rebate, with cess on top", () => {
    const tax = salaryTax({ annualGross: 2000000, regime: "NEW" });
    expect(tax.taxableIncome).toBe(1925000);
    // 4-8L at 5% = 20,000; 8-12L at 10% = 40,000; 12-16L at 15% = 60,000;
    // 16-19.25L at 20% = 65,000. That is 185,000.
    expect(tax.taxBeforeRebate).toBe(185000);
    expect(tax.rebate).toBe(0);
    expect(tax.cess).toBe(7400);
    expect(tax.totalTax).toBe(192400);
    expect(tax.monthlyDeduction).toBeCloseTo(192400 / 12, 2);
  });

  it("ignores an old-regime declaration when the employee chose the new one", () => {
    const withDeclaration = salaryTax({
      annualGross: 2000000,
      regime: "NEW",
      deductions: 150000,
    });
    const without = salaryTax({ annualGross: 2000000, regime: "NEW" });
    // The new regime allows the standard deduction and nothing else; declaring investments and
    // then choosing it buys nothing, and the code says so rather than quietly applying them.
    expect(withDeclaration.totalTax).toBe(without.totalTax);
    expect(withDeclaration.otherDeductions).toBe(0);
  });

  it("allows the declaration under the old regime", () => {
    const tax = salaryTax({
      annualGross: 1000000,
      regime: "OLD",
      deductions: 150000,
      professionalTaxPaid: 2400,
    });
    expect(tax.otherDeductions).toBe(152400);
    expect(tax.taxableIncome).toBe(1000000 - 50000 - 152400);
  });
});

describe("the files the portals want", () => {
  const line = (over: Partial<StatutoryLine> = {}): StatutoryLine => ({
    employeeCode: "E001",
    employeeName: "Ramesh Kumar",
    uan: "100200300400",
    esicNumber: "3101234567",
    pfWage: 15000,
    esiWage: 20000,
    grossWage: 25000,
    epfEmployee: 1800,
    epsEmployer: 1250,
    epfEmployer: 550,
    vpf: 0,
    esiEmployee: 150,
    esiEmployer: 650,
    professionalTax: 135,
    incomeTax: 0,
    netSalary: 22915,
    lopDays: 0,
    workingDays: 26,
    bankAccountNumber: "1234567890",
    bankIfsc: "hdfc0000123",
    ...over,
  });

  it("writes the ECR in the EPFO's field order and leaves out a member with no UAN", () => {
    const out = buildEcr([line(), line({ employeeCode: "E002", uan: null })]);
    expect(out.filed).toBe(1);
    // A member without a UAN cannot be filed, and is named rather than silently dropped.
    expect(out.skipped).toEqual(["E002"]);
    const fields = out.text.split("#~#");
    expect(fields[0]).toBe("100200300400");
    expect(fields[1]).toBe("Ramesh Kumar");
    expect(fields[2]).toBe("25000"); // gross wages
    expect(fields[3]).toBe("15000"); // EPF wages
    expect(fields[4]).toBe("15000"); // EPS wages, capped at the ceiling
    expect(fields[6]).toBe("1800"); // the employee's contribution, including any VPF
    expect(fields[7]).toBe("1250"); // to the pension fund
    expect(fields[8]).toBe("550"); // the difference into EPF
  });

  it("caps the EPS wage at the ceiling even when PF is on the full wage", () => {
    const out = buildEcr([
      line({ pfWage: 40000, epfEmployee: 4800, epsEmployer: 1250, epfEmployer: 3550 }),
    ]);
    const fields = out.text.split("#~#");
    expect(fields[3]).toBe("40000");
    expect(fields[4]).toBe("15000");
  });

  it("writes the ESIC file for covered members only", () => {
    const out = buildEsicFile([
      line(),
      // Over the wage limit: no contribution, so no line at all rather than a line of zeroes.
      line({ employeeCode: "E003", esiEmployee: 0, esiEmployer: 0 }),
      line({ employeeCode: "E004", esicNumber: null }),
    ]);
    expect(out.filed).toBe(1);
    expect(out.skipped).toEqual(["E004"]);
    expect(out.text.split(",")[0]).toBe("3101234567");
  });

  it("sums professional tax by state", () => {
    const out = buildPtSummary([
      { ...line(), stateCode: "33", stateName: "Tamil Nadu" },
      { ...line(), employeeCode: "E002", stateCode: "33", stateName: "Tamil Nadu" },
      {
        ...line(),
        employeeCode: "E003",
        stateCode: "27",
        stateName: "Maharashtra",
        professionalTax: 200,
      },
    ]);
    expect(out.total).toBe(470);
    expect(out.rows.find((r) => r.stateCode === "33")?.employees).toBe(2);
  });

  it("writes a bank file and names anyone it could not pay", () => {
    const out = buildBankTransferFile(
      [line(), line({ employeeCode: "E005", bankAccountNumber: null })],
      "2026-08"
    );
    expect(out.filed).toBe(1);
    expect(out.total).toBe(22915);
    // Silently dropping someone from the transfer file means they do not get paid.
    expect(out.skipped).toEqual(["E005"]);
    expect(out.text.split("\n")[1]).toContain("HDFC0000123");
  });
});
