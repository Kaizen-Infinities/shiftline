import { z } from "zod";

import { CLAIM_STATUSES, SCHEME_KINDS, SCHEME_STATUSES, type SchemeKind } from "./subsidy.calc";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-27");
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Months look like 2026-04");
const money = (what: string) =>
  z.coerce
    .number({ message: `${what} must be a number` })
    .finite(`${what} must be a number`)
    .max(99_999_999_999, `${what} is too large`);
const positive = (what: string) => money(what).gt(0, `${what} must be more than zero`);
const pct = (what: string) =>
  z.coerce
    .number({ message: `${what} must be a number` })
    .gt(0, `${what} must be more than zero`)
    .max(100, `${what} is a percentage; enter at most 100`);

// ── Kind-specific details ───────────────────────────────────────────────────

export const capitalDetails = z
  .object({
    eligiblePlantMachinery: positive("The eligible plant and machinery value"),
    ratePct: pct("The subsidy rate"),
    extraPct: z.coerce
      .number()
      .min(0, "The extra rate cannot be negative")
      .max(100, "The extra rate is a percentage")
      .nullable()
      .optional(),
    cap: positive("The cap").nullable().optional(),
  })
  .strict()
  .refine((d) => d.ratePct + (d.extraPct ?? 0) <= 100, {
    message: "The rate and the extra rate together cannot exceed 100%",
    path: ["extraPct"],
  });

export const ltptDetails = z
  .object({
    startMonth: monthStr,
    months: z.coerce
      .number()
      .int("Months must be a whole number")
      .min(1, "The subsidy runs for at least one month")
      .max(120, "The subsidy period is at most 120 months"),
    ratePct: pct("The subsidy rate"),
    monthlyBaseTariff: positive("The monthly base tariff"),
    tariffByMonth: z
      .record(monthStr, money("A month's tariff").min(0, "A month's tariff cannot be negative"))
      .nullable()
      .optional(),
    claimWindowDays: z.coerce
      .number()
      .int("The claim window is a whole number of days")
      .min(1, "The claim window is at least one day")
      .max(3650, "The claim window is at most 3650 days")
      .nullable()
      .optional(),
  })
  .strict();

export const interestDetails = z
  .object({
    loanAccountRef: z.string().trim().min(1, "Enter the loan account number").max(40),
    lender: z.string().trim().max(80).nullable().optional(),
    sanctionedLoan: positive("The sanctioned loan"),
    subventionPct: z.coerce
      .number({ message: "The subvention rate must be a number" })
      .gt(0, "The subvention rate must be more than zero")
      .max(15, "The subvention rate looks too high; enter it in per cent, e.g. 3"),
    annualCap: positive("The annual cap").nullable().optional(),
    balances: z
      .array(
        z
          .object({
            from: dateStr,
            principal: money("A balance").min(0, "A balance cannot be negative"),
          })
          .strict()
      )
      .max(240, "Record at most 240 balances")
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (d) => new Set((d.balances ?? []).map((b) => b.from)).size === (d.balances ?? []).length,
    {
      message: "Two balances share a date",
      path: ["balances"],
    }
  );

const noDetails = z.custom<null | Record<string, never>>(
  (v) =>
    v === null ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0),
  { message: "This kind of scheme takes no extra fields" }
);

export const DETAILS_BY_KIND: Record<SchemeKind, z.ZodTypeAny> = {
  CAPITAL_SUBSIDY: capitalDetails,
  POWER_SUBSIDY_LTPT: ltptDetails,
  INTEREST_SUBVENTION: interestDetails,
  // NEEDS is a capital subsidy for first-generation entrepreneurs; its figures are optional.
  NEEDS: capitalDetails.nullable(),
  PLI: noDetails,
  STATE_OTHER: noDetails,
  CENTRAL_OTHER: noDetails,
};

/** Kinds whose calculation needs its details before the scheme can be saved. */
export const DETAILS_REQUIRED: ReadonlySet<SchemeKind> = new Set([
  "CAPITAL_SUBSIDY",
  "POWER_SUBSIDY_LTPT",
  "INTEREST_SUBVENTION",
]);

// ── Schemes ─────────────────────────────────────────────────────────────────

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const schemeFields = {
  schemeCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Enter a scheme code")
    .max(30, "A scheme code is at most 30 characters")
    .regex(/^[A-Z0-9][A-Z0-9/_.-]*$/, "Use letters, digits and - / _ . in the scheme code"),
  kind: z.enum(SCHEME_KINDS, { message: "Pick the kind of scheme" }),
  name: z.string().trim().min(1, "Enter the scheme's name").max(150),
  authority: optionalText(80),
  sanctionOrderNo: optionalText(80),
  sanctionDate: dateStr.nullable().optional(),
  sanctionedAmount: positive("The sanctioned amount").nullable().optional(),
  eligibilityNotes: optionalText(2000),
  validFrom: dateStr.nullable().optional(),
  validTo: dateStr.nullable().optional(),
  details: z.unknown().optional(),
};

const validityOk = (b: { validFrom?: string | null; validTo?: string | null }) =>
  !b.validFrom || !b.validTo || b.validTo >= b.validFrom;
const validityMsg = { message: "The scheme cannot end before it starts", path: ["validTo"] };

export const createSchemeBody = z
  .object({ ...schemeFields, status: z.enum(["APPLIED", "SANCTIONED", "ACTIVE"]).optional() })
  .strict()
  .refine(validityOk, validityMsg);

export const updateSchemeBody = z
  .object({
    schemeCode: schemeFields.schemeCode.optional(),
    kind: schemeFields.kind.optional(),
    name: schemeFields.name.optional(),
    authority: schemeFields.authority,
    sanctionOrderNo: schemeFields.sanctionOrderNo,
    sanctionDate: schemeFields.sanctionDate,
    sanctionedAmount: schemeFields.sanctionedAmount,
    eligibilityNotes: schemeFields.eligibilityNotes,
    validFrom: schemeFields.validFrom,
    validTo: schemeFields.validTo,
    details: schemeFields.details,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" })
  .refine(validityOk, validityMsg);

export const schemeStatusBody = z
  .object({
    status: z.enum(SCHEME_STATUSES, { message: "Unknown scheme status" }),
    sanctionOrderNo: z.string().trim().min(1).max(80).optional(),
    sanctionDate: dateStr.optional(),
    sanctionedAmount: positive("The sanctioned amount").optional(),
  })
  .strict();

export const listQuery = z.object({
  status: z.enum(SCHEME_STATUSES, { message: "Unknown scheme status" }).optional(),
  kind: z.enum(SCHEME_KINDS, { message: "Unknown kind of scheme" }).optional(),
});

export const asOfQuery = z.object({ asOf: dateStr.optional() });

export const entitlementQuery = z
  .object({ from: dateStr, to: dateStr })
  .refine((q) => q.to >= q.from, {
    message: "The period cannot end before it starts",
    path: ["to"],
  });

// ── Claims ──────────────────────────────────────────────────────────────────

const claimFields = {
  periodFrom: dateStr,
  periodTo: dateStr,
  amountClaimed: positive("The amount claimed"),
  notes: z.string().trim().max(1000).nullable().optional(),
};

export const createClaimBody = z
  .object({
    claimNo: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(30, "A claim number is at most 30 characters")
      .optional(),
    ...claimFields,
  })
  .strict()
  .refine((b) => b.periodTo >= b.periodFrom, {
    message: "The claim period cannot end before it starts",
    path: ["periodTo"],
  });

export const updateClaimBody = z
  .object({
    periodFrom: claimFields.periodFrom.optional(),
    periodTo: claimFields.periodTo.optional(),
    amountClaimed: claimFields.amountClaimed.optional(),
    notes: claimFields.notes,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });

export const claimStatusBody = z
  .object({
    status: z.enum(CLAIM_STATUSES, { message: "Unknown claim status" }),
    filedOn: dateStr.optional(),
    referenceNo: z.string().trim().min(1).max(80).optional(),
    approvedOn: dateStr.optional(),
    approvedAmount: positive("The approved amount").optional(),
    disbursedAmount: positive("The amount received").optional(),
    disbursedOn: dateStr.optional(),
    bankRef: z.string().trim().min(1).max(80).optional(),
    rejectionReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((b) => b.status !== "FILED" || !!b.filedOn, {
    message: "A filed claim needs its filing date",
    path: ["filedOn"],
  })
  .refine((b) => b.status !== "DISBURSED" || (!!b.disbursedAmount && !!b.disbursedOn), {
    message: "Record the amount received and the date it reached the bank",
    path: ["disbursedAmount"],
  })
  .refine((b) => b.status !== "REJECTED" || !!b.rejectionReason, {
    message: "Say why the claim was rejected",
    path: ["rejectionReason"],
  });

export const idParam = z.string().uuid("Unknown scheme");
export const claimIdParam = z.string().uuid("Unknown claim");
