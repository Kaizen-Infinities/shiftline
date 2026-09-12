/**
 * What the Labour Codes say a company owes an employee (P1-17b).
 *
 * All of it is money the company owes and mostly does not know it owes: leave that has accrued,
 * gratuity that has been building since the fifth year, the bonus the Act requires whether or not
 * the year was good. Kept apart from the database because each one is a formula somebody will
 * check against the bare words of an Act.
 */
const n2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const DAY = 86400000;

// ── Overtime ──────────────────────────────────────────────────────────────────
/** Beyond this in a day, overtime starts. */
export const DAILY_HOURS = 9;
/** ...or beyond this in a week, whichever comes first. */
export const WEEKLY_HOURS = 48;
/** Overtime is paid at twice the ordinary rate. The Act says twice; it is not negotiable. */
export const OVERTIME_MULTIPLIER = 2;
/** The most overtime that may be *worked* in a quarter, under the OSH Code. */
export const QUARTERLY_OVERTIME_CAP = 125;

export interface OvertimeInput {
  /** Hours actually worked each day of the week, in order. */
  dailyHours: number[];
  /** The ordinary hourly rate: monthly wage over the month's hours. */
  hourlyRate: number;
  /** Overtime already worked this quarter, for the cap. */
  quarterToDateHours?: number;
}

export interface Overtime {
  dailyExcess: number;
  weeklyExcess: number;
  overtimeHours: number;
  amount: number;
  /** Hours beyond what the quarter allows: payable, but the company is in breach for working them. */
  hoursOverCap: number;
}

/**
 * Overtime for a week.
 *
 * The two triggers do not add up — an hour beyond nine on Tuesday is the same hour that takes the
 * week past forty-eight — so the answer is the greater of the two, not the sum. Adding them is
 * the usual mistake and pays the same hour twice.
 */
export const overtimeForWeek = (input: OvertimeInput): Overtime => {
  const dailyExcess = input.dailyHours.reduce((s, h) => s + Math.max(h - DAILY_HOURS, 0), 0);
  const total = input.dailyHours.reduce((s, h) => s + h, 0);
  const weeklyExcess = Math.max(total - WEEKLY_HOURS, 0);
  const overtimeHours = Math.max(dailyExcess, weeklyExcess);
  const quarterToDate = input.quarterToDateHours ?? 0;
  const hoursOverCap = Math.max(quarterToDate + overtimeHours - QUARTERLY_OVERTIME_CAP, 0);
  return {
    dailyExcess: n2(dailyExcess),
    weeklyExcess: n2(weeklyExcess),
    overtimeHours: n2(overtimeHours),
    // Over the cap is still paid: the employee worked the hours. The breach is the company's.
    amount: n2(overtimeHours * input.hourlyRate * OVERTIME_MULTIPLIER),
    hoursOverCap: n2(hoursOverCap),
  };
};

// ── Gratuity ──────────────────────────────────────────────────────────────────
/** Fifteen days' wages for each completed year, and a month is reckoned as twenty-six days. */
export const GRATUITY_DAYS = 15;
export const GRATUITY_MONTH_DAYS = 26;
export const GRATUITY_QUALIFYING_YEARS = 5;
/** A fixed-term employee qualifies after one year under the Codes. */
export const FIXED_TERM_QUALIFYING_YEARS = 1;
export const GRATUITY_CEILING = 2000000;

export interface GratuityInput {
  joinedOn: Date;
  leftOn: Date;
  /** Basic plus dearness allowance last drawn — not gross, and not an average. */
  lastDrawnWage: number;
  fixedTerm?: boolean;
}

export interface Gratuity {
  serviceYears: number;
  countedYears: number;
  eligible: boolean;
  amount: number;
  cappedAtCeiling: boolean;
}

/**
 * Gratuity on leaving.
 *
 * Two details decide the number and both are easy to get wrong: service beyond six months in the
 * final year **rounds up to a whole year**, and the wage is basic plus dearness allowance last
 * drawn rather than gross — using gross overstates every settlement by the allowances.
 */
export const gratuity = (input: GratuityInput): Gratuity => {
  const days = Math.max((input.leftOn.getTime() - input.joinedOn.getTime()) / DAY, 0);
  const serviceYears = days / 365.25;
  const qualifying = input.fixedTerm ? FIXED_TERM_QUALIFYING_YEARS : GRATUITY_QUALIFYING_YEARS;
  if (serviceYears < qualifying) {
    return {
      serviceYears: n2(serviceYears),
      countedYears: 0,
      eligible: false,
      amount: 0,
      cappedAtCeiling: false,
    };
  }
  const whole = Math.floor(serviceYears);
  const remainder = serviceYears - whole;
  // More than six months of the last year counts as a whole year.
  const countedYears = remainder > 0.5 ? whole + 1 : whole;
  const raw = n2((input.lastDrawnWage * GRATUITY_DAYS * countedYears) / GRATUITY_MONTH_DAYS);
  return {
    serviceYears: n2(serviceYears),
    countedYears,
    eligible: true,
    amount: Math.min(raw, GRATUITY_CEILING),
    cappedAtCeiling: raw > GRATUITY_CEILING,
  };
};

// ── Statutory bonus ───────────────────────────────────────────────────────────
/** Above this monthly wage, the Act does not apply. */
export const BONUS_ELIGIBILITY_WAGE = 21000;
/** Bonus is worked out on this, or the minimum wage if it is higher — not on the actual wage. */
export const BONUS_CALCULATION_CEILING = 7000;
export const BONUS_MINIMUM_PERCENT = 8.33;
export const BONUS_MAXIMUM_PERCENT = 20;

export interface BonusInput {
  /** The employee's monthly wage: basic plus dearness allowance. */
  monthlyWage: number;
  /** Months actually worked in the year; thirty days of work in the year is the minimum. */
  monthsWorked: number;
  /** The state's minimum wage for the employee's category, where it exceeds the ceiling. */
  minimumWage?: number;
  /** What the company is paying this year, between the floor and the cap. */
  percent?: number;
}

export interface Bonus {
  eligible: boolean;
  calculationWage: number;
  percent: number;
  amount: number;
}

/**
 * Statutory bonus for a year.
 *
 * The trap is the second ceiling. An employee earning ₹20,000 is eligible, but the bonus is
 * computed on ₹7,000 (or the minimum wage if that is higher) rather than on what they earn.
 * Computing it on the actual wage overstates the liability nearly threefold.
 */
export const statutoryBonus = (input: BonusInput): Bonus => {
  if (input.monthlyWage > BONUS_ELIGIBILITY_WAGE || input.monthsWorked < 1) {
    return { eligible: false, calculationWage: 0, percent: 0, amount: 0 };
  }
  const ceiling = Math.max(BONUS_CALCULATION_CEILING, input.minimumWage ?? 0);
  const calculationWage = Math.min(input.monthlyWage, ceiling);
  const percent = Math.min(
    Math.max(input.percent ?? BONUS_MINIMUM_PERCENT, BONUS_MINIMUM_PERCENT),
    BONUS_MAXIMUM_PERCENT
  );
  const months = Math.min(Math.max(input.monthsWorked, 0), 12);
  return {
    eligible: true,
    calculationWage,
    percent,
    amount: n2((calculationWage * months * percent) / 100),
  };
};

// ── Leave ─────────────────────────────────────────────────────────────────────
export interface LeaveAccrualInput {
  basis: "ANNUAL" | "MONTHLY" | "DAYS_WORKED";
  daysPerYear: number;
  /** One earned day for every this many worked, when the basis says so. */
  daysWorkedPerDay?: number;
  monthsWorked?: number;
  daysWorked?: number;
}

/** What has accrued so far under the policy's basis. */
export const leaveAccrued = (input: LeaveAccrualInput): number => {
  switch (input.basis) {
    case "MONTHLY":
      return n2((input.daysPerYear / 12) * Math.min(input.monthsWorked ?? 0, 12));
    case "DAYS_WORKED":
      // The Factories Act's earned leave: one day for every twenty actually worked.
      return n2(Math.floor((input.daysWorked ?? 0) / (input.daysWorkedPerDay || 20)));
    case "ANNUAL":
    default:
      return n2(input.daysPerYear);
  }
};

/** What carries into the next year, and what is lost at the cap. */
export const carryForward = (closing: number, cap: number): { carried: number; lapsed: number } => {
  const carried = n2(Math.min(Math.max(closing, 0), Math.max(cap, 0)));
  return { carried, lapsed: n2(Math.max(closing - carried, 0)) };
};

/** Encashment at the daily wage, a month being twenty-six days as everywhere else here. */
export const leaveEncashment = (days: number, monthlyWage: number): number =>
  n2((Math.max(days, 0) * monthlyWage) / GRATUITY_MONTH_DAYS);

// ── Settlement ────────────────────────────────────────────────────────────────
export interface SettlementInput {
  salaryDue: number;
  leaveEncashment: number;
  gratuity: number;
  bonus: number;
  otherDues?: number;
  noticeDaysRequired: number;
  noticeDaysServed: number;
  monthlyWage: number;
  advanceRecovery?: number;
  otherRecovery?: number;
}

export interface Settlement {
  dues: number;
  noticeRecovery: number;
  recoveries: number;
  netPayable: number;
}

/**
 * What is actually handed over.
 *
 * Notice not served is recovered at the daily wage for the days short — and a settlement can come
 * out negative, which is a real outcome the company then has to decide what to do about rather
 * than something to clamp to zero and quietly forget.
 */
export const settle = (input: SettlementInput): Settlement => {
  const dues = n2(
    input.salaryDue + input.leaveEncashment + input.gratuity + input.bonus + (input.otherDues ?? 0)
  );
  const short = Math.max(input.noticeDaysRequired - input.noticeDaysServed, 0);
  const noticeRecovery = n2((short * input.monthlyWage) / GRATUITY_MONTH_DAYS);
  const recoveries = n2(noticeRecovery + (input.advanceRecovery ?? 0) + (input.otherRecovery ?? 0));
  return { dues, noticeRecovery, recoveries, netPayable: n2(dues - recoveries) };
};
