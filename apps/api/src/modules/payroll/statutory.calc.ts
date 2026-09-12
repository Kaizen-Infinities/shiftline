/**
 * The statutory half of payroll (P1-16).
 *
 * Kept apart from the database because every number here is a rule somebody can check, and the
 * rules are the part that gets a company fined. Three of them are worth stating plainly, because
 * a payroll that treats them casually produces files the portals reject:
 *
 *  1. **The employer's 12% is not one contribution.** 8.33% goes to the pension scheme (on wages
 *     capped at ₹15,000, so ₹1,250 a month at most) and the balance of the 12% to the provident
 *     fund. On top of that the employer pays 0.50% EDLI and 0.50% administration charges. An ECR
 *     built from a single "employer PF" figure is rejected at upload.
 *  2. **The three wages are three different wages.** PF is on basic plus dearness allowance, ESI
 *     on gross, professional tax on gross as the state defines it. Using one base for all three
 *     is the most common payroll error there is.
 *  3. **ESI eligibility is fixed for the contribution period, not month by month.** A raise above
 *     the limit in September does not stop the contribution until the period ends — but that is
 *     a decision the caller makes with the employee's history, so this file takes the flag.
 */
const n2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
/** The EPFO rounds a contribution to the rupee. */
const rupee = (v: number) => Math.round(v + Number.EPSILON);

// ── Provident fund ────────────────────────────────────────────────────────────
/** The statutory wage ceiling for the pension share. */
export const PF_WAGE_CEILING = 15000;
export const PF_RATE = 12;
export const EPS_RATE = 8.33;
export const EDLI_RATE = 0.5;
export const PF_ADMIN_RATE = 0.5;
/** The EPFO's minimum administration charge for a month, however small the wage bill. */
export const PF_ADMIN_MINIMUM = 500;

export interface PfInput {
  /** Basic plus dearness allowance for the month, already reduced for loss of pay. */
  pfWage: number;
  /** True when the employer contributes on the full wage rather than on the ceiling. */
  contributeOnFullWage?: boolean;
  /** The employee's own extra, over and above the 12%. */
  vpfPercent?: number;
  /** An employee over 58, or one who joined the fund after the pension scheme closed to them. */
  pensionExempt?: boolean;
}

export interface PfSplit {
  pfWage: number;
  epfEmployee: number;
  epsEmployer: number;
  epfEmployer: number;
  edliCharges: number;
  pfAdminCharges: number;
  vpf: number;
  employerTotal: number;
}

export const pfSplit = (input: PfInput): PfSplit => {
  const wage = n2(Math.max(input.pfWage, 0));
  // The employee's own 12% is on the wage the employer decided to contribute on.
  const contributoryWage = input.contributeOnFullWage ? wage : Math.min(wage, PF_WAGE_CEILING);
  const epfEmployee = rupee((contributoryWage * PF_RATE) / 100);
  const vpf = rupee((contributoryWage * (input.vpfPercent ?? 0)) / 100);

  // The pension share is capped at the ceiling whatever the employer contributes on, and stops
  // altogether for someone the scheme no longer covers.
  const pensionWage = Math.min(contributoryWage, PF_WAGE_CEILING);
  const epsEmployer = input.pensionExempt ? 0 : rupee((pensionWage * EPS_RATE) / 100);
  const employerTwelve = rupee((contributoryWage * PF_RATE) / 100);
  // Whatever the pension did not take stays in the provident fund.
  const epfEmployer = n2(employerTwelve - epsEmployer);

  const edliCharges = rupee((pensionWage * EDLI_RATE) / 100);
  const pfAdminCharges = rupee((contributoryWage * PF_ADMIN_RATE) / 100);

  return {
    pfWage: wage,
    epfEmployee,
    epsEmployer,
    epfEmployer,
    edliCharges,
    pfAdminCharges,
    vpf,
    employerTotal: n2(epsEmployer + epfEmployer + edliCharges + pfAdminCharges),
  };
};

// ── Employees' State Insurance ────────────────────────────────────────────────
export const ESI_WAGE_LIMIT = 21000;
export const ESI_EMPLOYEE_RATE = 0.75;
export const ESI_EMPLOYER_RATE = 3.25;

export interface EsiSplit {
  applicable: boolean;
  esiWage: number;
  esiEmployee: number;
  esiEmployer: number;
}

/**
 * ESI rounds the employee's share **up** to the rupee and the employer's share up as well; the
 * scheme says so explicitly, and rounding down leaves the contribution short.
 */
export const esiSplit = (grossWage: number, applicable: boolean): EsiSplit => {
  const wage = n2(Math.max(grossWage, 0));
  if (!applicable || wage <= 0) {
    return { applicable: false, esiWage: wage, esiEmployee: 0, esiEmployer: 0 };
  }
  return {
    applicable: true,
    esiWage: wage,
    esiEmployee: Math.ceil((wage * ESI_EMPLOYEE_RATE) / 100),
    esiEmployer: Math.ceil((wage * ESI_EMPLOYER_RATE) / 100),
  };
};

// ── Professional tax ──────────────────────────────────────────────────────────
export interface PtSlab {
  /** The top of the band; the last slab uses `Infinity` or a very large number. */
  upTo: number;
  amount: number;
  /** Charge this amount only in this month (1-12). Maharashtra's February is the usual case. */
  month?: number;
}

/**
 * Professional tax for a month.
 *
 * A slab carrying a month is charged in that month only, which is how states that take a larger
 * amount once a year are handled without a second table.
 */
export const professionalTax = (wage: number, slabs: PtSlab[], month: number): number => {
  const ordered = [...slabs].sort((a, b) => a.upTo - b.upTo);
  for (const slab of ordered) {
    if (wage <= slab.upTo) {
      if (slab.month !== undefined && slab.month !== month) return 0;
      return n2(slab.amount);
    }
  }
  const last = ordered[ordered.length - 1];
  if (!last) return 0;
  if (last.month !== undefined && last.month !== month) return 0;
  return n2(last.amount);
};

/** The states a manufacturer is most likely to be in, with the slabs they levy. */
export const DEFAULT_STATUTORY_RULES: {
  stateCode: string;
  stateName: string;
  ptSlabs: PtSlab[];
  lwfEmployee: number;
  lwfEmployer: number;
  lwfFrequency: string;
  lwfMonths: number[];
}[] = [
  {
    stateCode: "33",
    stateName: "Tamil Nadu",
    // Tamil Nadu levies half-yearly; the monthly figure is the half-yearly one divided by six.
    ptSlabs: [
      { upTo: 21000, amount: 0 },
      { upTo: 30000, amount: 135 },
      { upTo: 45000, amount: 315 },
      { upTo: 60000, amount: 690 },
      { upTo: 75000, amount: 1025 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 1250 },
    ],
    lwfEmployee: 20,
    lwfEmployer: 40,
    lwfFrequency: "ANNUAL",
    lwfMonths: [12],
  },
  {
    stateCode: "27",
    stateName: "Maharashtra",
    ptSlabs: [
      { upTo: 25000, amount: 0 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
      // February carries the extra ₹100 that makes the year ₹2,500.
      { upTo: Number.MAX_SAFE_INTEGER, amount: 300, month: 2 },
    ],
    lwfEmployee: 25,
    lwfEmployer: 75,
    lwfFrequency: "HALF_YEARLY",
    lwfMonths: [6, 12],
  },
  {
    stateCode: "29",
    stateName: "Karnataka",
    ptSlabs: [
      { upTo: 24999, amount: 0 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
    ],
    lwfEmployee: 20,
    lwfEmployer: 40,
    lwfFrequency: "ANNUAL",
    lwfMonths: [12],
  },
  {
    stateCode: "24",
    stateName: "Gujarat",
    ptSlabs: [
      { upTo: 12000, amount: 0 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
    ],
    lwfEmployee: 6,
    lwfEmployer: 12,
    lwfFrequency: "HALF_YEARLY",
    lwfMonths: [6, 12],
  },
  {
    stateCode: "36",
    stateName: "Telangana",
    ptSlabs: [
      { upTo: 15000, amount: 0 },
      { upTo: 20000, amount: 150 },
      { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
    ],
    lwfEmployee: 2,
    lwfEmployer: 5,
    lwfFrequency: "ANNUAL",
    lwfMonths: [12],
  },
  {
    stateCode: "07",
    stateName: "Delhi",
    // Delhi does not levy professional tax at all; the rule exists so the absence is explicit.
    ptSlabs: [{ upTo: Number.MAX_SAFE_INTEGER, amount: 0 }],
    lwfEmployee: 0.75,
    lwfEmployer: 2.25,
    lwfFrequency: "HALF_YEARLY",
    lwfMonths: [6, 12],
  },
];

// ── The Labour Code wage check ────────────────────────────────────────────────
/** The Code on Wages: basic plus dearness allowance has to be at least half of the whole. */
export const MINIMUM_WAGE_SHARE = 50;

export const wageCheck = (
  basicPlusDa: number,
  gross: number
): { sharePercent: number; passed: boolean; shortfall: number } => {
  if (gross <= 0) return { sharePercent: 0, passed: true, shortfall: 0 };
  const sharePercent = n2((basicPlusDa / gross) * 100);
  const required = n2((gross * MINIMUM_WAGE_SHARE) / 100);
  return {
    sharePercent,
    passed: sharePercent >= MINIMUM_WAGE_SHARE,
    // What the basic would have to rise by. PF, gratuity and bonus all follow this number, which
    // is exactly why the Code sets a floor under it.
    shortfall: sharePercent >= MINIMUM_WAGE_SHARE ? 0 : n2(required - basicPlusDa),
  };
};

// ── Tax on salary ─────────────────────────────────────────────────────────────
export interface TaxSlab {
  upTo: number;
  rate: number;
}

/**
 * The two regimes as they stand for FY 2026-27. Seed values, not gospel: a Finance Act moves them
 * every year, which is why they are exported constants rather than buried in the calculation.
 */
export const NEW_REGIME_SLABS: TaxSlab[] = [
  { upTo: 400000, rate: 0 },
  { upTo: 800000, rate: 5 },
  { upTo: 1200000, rate: 10 },
  { upTo: 1600000, rate: 15 },
  { upTo: 2000000, rate: 20 },
  { upTo: 2400000, rate: 25 },
  { upTo: Number.MAX_SAFE_INTEGER, rate: 30 },
];
export const OLD_REGIME_SLABS: TaxSlab[] = [
  { upTo: 250000, rate: 0 },
  { upTo: 500000, rate: 5 },
  { upTo: 1000000, rate: 20 },
  { upTo: Number.MAX_SAFE_INTEGER, rate: 30 },
];
export const STANDARD_DEDUCTION = { NEW: 75000, OLD: 50000 } as const;
/** Section 87A: a rebate that takes the tax to nil up to this much taxable income. */
export const REBATE_87A = { NEW: { upTo: 1200000, max: 60000 }, OLD: { upTo: 500000, max: 12500 } };
export const CESS_RATE = 4;

export interface SalaryTaxInput {
  /** Salary for the whole year, gross. */
  annualGross: number;
  regime: "OLD" | "NEW";
  /** What the old regime allows and the new one does not: 80C, 80D, house rent and the rest. */
  deductions?: number;
  /** Professional tax paid is deductible from salary under the old regime. */
  professionalTaxPaid?: number;
}

export interface SalaryTax {
  regime: "OLD" | "NEW";
  annualGross: number;
  standardDeduction: number;
  otherDeductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  cess: number;
  totalTax: number;
  monthlyDeduction: number;
}

const slabTax = (taxable: number, slabs: TaxSlab[]): number => {
  let tax = 0;
  let previous = 0;
  for (const slab of slabs) {
    if (taxable <= previous) break;
    const inBand = Math.min(taxable, slab.upTo) - previous;
    tax += (inBand * slab.rate) / 100;
    previous = slab.upTo;
  }
  return n2(tax);
};

/**
 * Tax on salary for a year, and the twelfth of it that comes off this month.
 *
 * The new regime allows the standard deduction and nothing else — an employee who declares
 * investments and then chooses it gets no benefit from them, which is worth the code saying
 * plainly rather than quietly ignoring the declaration.
 */
export const salaryTax = (input: SalaryTaxInput): SalaryTax => {
  const gross = n2(Math.max(input.annualGross, 0));
  const standard = STANDARD_DEDUCTION[input.regime];
  const other =
    input.regime === "OLD" ? n2((input.deductions ?? 0) + (input.professionalTaxPaid ?? 0)) : 0;
  const taxable = n2(Math.max(gross - standard - other, 0));

  const slabs = input.regime === "NEW" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  const beforeRebate = slabTax(taxable, slabs);
  const rebateRule = REBATE_87A[input.regime];
  const rebate = taxable <= rebateRule.upTo ? Math.min(beforeRebate, rebateRule.max) : 0;
  const afterRebate = n2(Math.max(beforeRebate - rebate, 0));
  const cess = n2((afterRebate * CESS_RATE) / 100);
  const total = n2(afterRebate + cess);

  return {
    regime: input.regime,
    annualGross: gross,
    standardDeduction: standard,
    otherDeductions: other,
    taxableIncome: taxable,
    taxBeforeRebate: beforeRebate,
    rebate,
    cess,
    totalTax: total,
    monthlyDeduction: n2(total / 12),
  };
};
