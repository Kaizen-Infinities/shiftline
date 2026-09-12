/**
 * The files the portals want (P1-16).
 *
 * Each one is a fixed field order with a fixed delimiter and no header, and each portal rejects
 * the whole file on one bad line rather than skipping it. So the shape below is dictated, not
 * designed, and the field order is the part to be careful with.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const rupee = (v: unknown) => Math.round(Number(v ?? 0) || 0);

export interface StatutoryLine {
  employeeCode: string;
  employeeName: string;
  uan: string | null;
  esicNumber: string | null;
  pfWage: number;
  esiWage: number;
  grossWage: number;
  epfEmployee: number;
  epsEmployer: number;
  epfEmployer: number;
  vpf: number;
  esiEmployee: number;
  esiEmployer: number;
  professionalTax: number;
  incomeTax: number;
  netSalary: number;
  lopDays: number;
  workingDays: number;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
}

/**
 * The EPFO's electronic challan-cum-return.
 *
 * `#~#` separated, one line per member, in this order: UAN, name, gross wages, EPF wages, EPS
 * wages, EDLI wages, the employee's contribution, the EPS contribution, the difference the
 * employer pays into EPF, days of non-contributing service, and the refund of advances. The
 * portal matches on the UAN, so a member without one cannot be filed and is left out with the
 * count saying so.
 */
export const buildEcr = (
  lines: StatutoryLine[]
): { text: string; filed: number; skipped: string[] } => {
  const skipped: string[] = [];
  const rows: string[] = [];
  for (const l of lines) {
    if (!l.uan || !/^\d{12}$/.test(l.uan)) {
      skipped.push(l.employeeCode);
      continue;
    }
    // EPS and EDLI wages are the wage the pension share was worked out on, which is the PF wage
    // capped at the ceiling — not the gross, and not the uncapped PF wage.
    const epsWage = Math.min(rupee(l.pfWage), 15000);
    rows.push(
      [
        l.uan,
        l.employeeName.replace(/[#~]/g, " ").slice(0, 85),
        rupee(l.grossWage),
        rupee(l.pfWage),
        epsWage,
        epsWage,
        rupee(l.epfEmployee + l.vpf),
        rupee(l.epsEmployer),
        rupee(l.epfEmployer),
        Math.round(l.lopDays),
        0,
      ].join("#~#")
    );
  }
  return { text: rows.join("\n"), filed: rows.length, skipped };
};

/**
 * The ESIC monthly contribution file: IP number, name, days worked, wages and the employee's
 * contribution, comma separated. Only members actually covered in the month go in — a wage above
 * the limit means no line at all rather than a line of zeroes.
 */
export const buildEsicFile = (
  lines: StatutoryLine[]
): { text: string; filed: number; skipped: string[] } => {
  const skipped: string[] = [];
  const rows: string[] = [];
  for (const l of lines) {
    if (l.esiEmployee <= 0 && l.esiEmployer <= 0) continue;
    if (!l.esicNumber) {
      skipped.push(l.employeeCode);
      continue;
    }
    rows.push(
      [
        l.esicNumber,
        l.employeeName.replace(/,/g, " ").slice(0, 60),
        Math.round(l.workingDays),
        rupee(l.esiWage),
        rupee(l.esiEmployee),
        "0",
        "",
      ].join(",")
    );
  }
  return { text: rows.join("\n"), filed: rows.length, skipped };
};

/**
 * The professional-tax challan summary: what is owed to each state, and how many people it is
 * for. It is a summary rather than a file because every state's portal wants something different
 * and most of them still take a paper challan.
 */
export const buildPtSummary = (
  lines: (StatutoryLine & { stateCode: string | null; stateName?: string })[]
): {
  rows: { stateCode: string; stateName: string; employees: number; amount: number }[];
  total: number;
} => {
  const byState = new Map<
    string,
    { stateCode: string; stateName: string; employees: number; amount: number }
  >();
  for (const l of lines) {
    if (l.professionalTax <= 0) continue;
    const code = l.stateCode ?? "--";
    const row = byState.get(code) ?? {
      stateCode: code,
      stateName: l.stateName ?? code,
      employees: 0,
      amount: 0,
    };
    row.employees++;
    row.amount = n2(row.amount + l.professionalTax);
    byState.set(code, row);
  }
  const rows = [...byState.values()].sort((a, b) => b.amount - a.amount);
  return { rows, total: n2(rows.reduce((s, r) => s + r.amount, 0)) };
};

/**
 * The bank's salary transfer file, in the layout every Indian corporate net-banking portal takes:
 * account number, IFSC, name, amount, and a narration. An employee without bank details is left
 * out and named, because a transfer file that silently drops someone means they do not get paid.
 */
export const buildBankTransferFile = (
  lines: StatutoryLine[],
  periodKey: string
): { text: string; total: number; filed: number; skipped: string[] } => {
  const skipped: string[] = [];
  const rows: string[] = ["Account Number,IFSC,Beneficiary Name,Amount,Narration"];
  let total = 0;
  for (const l of lines) {
    if (l.netSalary <= 0) continue;
    if (!l.bankAccountNumber || !l.bankIfsc) {
      skipped.push(l.employeeCode);
      continue;
    }
    total = n2(total + l.netSalary);
    rows.push(
      [
        l.bankAccountNumber,
        l.bankIfsc.toUpperCase(),
        `"${l.employeeName.replace(/"/g, "")}"`,
        n2(l.netSalary).toFixed(2),
        `Salary ${periodKey}`,
      ].join(",")
    );
  }
  return { text: rows.join("\n"), total, filed: rows.length - 1, skipped };
};

/**
 * Form 24Q's salary annexure for a quarter: one row per employee with what was paid and what was
 * deducted. The e-TDS utility takes the same `^`-delimited shape as 26Q, so the file itself is
 * built by the TDS module; this is the data it needs.
 */
export const build24QRows = (
  lines: (StatutoryLine & { pan?: string | null })[]
): {
  employeeCode: string;
  employeeName: string;
  pan: string | null;
  amountPaid: number;
  taxDeducted: number;
}[] =>
  lines
    .filter((l) => l.grossWage > 0)
    .map((l) => ({
      employeeCode: l.employeeCode,
      employeeName: l.employeeName,
      pan: l.pan ?? null,
      amountPaid: n2(l.grossWage),
      taxDeducted: n2(l.incomeTax),
    }));
