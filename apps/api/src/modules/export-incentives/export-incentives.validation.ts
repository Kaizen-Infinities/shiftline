import { z } from "zod";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-25");
const shippingBillNo = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{5,20}$/, "A shipping bill number is 5 to 20 letters or digits");
const money = z.coerce.number().finite();
const positive = money.positive("The FOB value must be more than zero");

export const SCHEMES = ["RODTEP", "ROSCTL", "DRAWBACK"] as const;
export const CLAIM_STATUSES = [
  "DECLARED",
  "SCROLLED",
  "SCRIP_GENERATED",
  "UTILISED",
  "TRANSFERRED",
  "CREDITED",
  "REJECTED",
] as const;
export const AUTH_TYPES = ["EPCG", "ADVANCE_AUTHORISATION"] as const;
export const AUTH_STATUSES = [
  "ACTIVE",
  "EO_FULFILLED",
  "REDEEMED",
  "EXPIRED",
  "CANCELLED",
] as const;

export const listClaimsQuery = z.object({
  scheme: z.enum(SCHEMES).optional(),
  status: z.enum(CLAIM_STATUSES).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

const rate = z.coerce
  .number()
  .min(0, "The rate is between 0 and 25 percent")
  .max(25, "The rate is between 0 and 25 percent");

export const createClaimBody = z
  .object({
    scheme: z.enum(SCHEMES),
    shippingBillNo,
    shippingBillDate: dateStr,
    portCode: z.string().trim().max(10).optional(),
    salesInvoiceId: z.string().uuid().optional(),
    fobValueInr: positive,
    ratePercent: rate.optional(),
    expectedAmount: money.min(0).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((b) => b.ratePercent !== undefined || b.expectedAmount !== undefined, {
    message: "Give either the rate or the expected amount",
    path: ["expectedAmount"],
  });

export const updateClaimBody = z.object({
  status: z.enum(CLAIM_STATUSES).optional(),
  portCode: z.string().trim().max(10).nullable().optional(),
  fobValueInr: positive.optional(),
  ratePercent: rate.nullable().optional(),
  expectedAmount: money.min(0).optional(),
  scrolledAmount: money.min(0).nullable().optional(),
  scrolledOn: dateStr.nullable().optional(),
  scripNo: z.string().trim().max(30).nullable().optional(),
  scripDate: dateStr.nullable().optional(),
  utilisedAmount: money.min(0).optional(),
  transferredTo: z.string().trim().max(120).nullable().optional(),
  realisedInr: money.min(0).nullable().optional(),
  creditedOn: dateStr.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const fromInvoiceBody = z.object({
  scheme: z.enum(SCHEMES),
  fobValueInr: positive.optional(),
  ratePercent: rate.optional(),
  expectedAmount: money.min(0).optional(),
});

const authNo = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{6,30}$/, "An authorisation number is 6 to 30 letters or digits");
const eoPeriod = z.coerce
  .number()
  .int()
  .min(1, "The obligation period is 1 to 120 months")
  .max(120, "The obligation period is 1 to 120 months");

export const createAuthorisationBody = z.object({
  authType: z.enum(AUTH_TYPES),
  authNo,
  issueDate: dateStr,
  rlaOffice: z.string().trim().max(60).optional(),
  dutySaved: money.min(0),
  eoMultiple: z.coerce.number().positive().max(999).optional(),
  exportObligationAmount: money.positive().optional(),
  eoPeriodMonths: eoPeriod.optional(),
  notes: z.string().max(500).optional(),
});

export const updateAuthorisationBody = z.object({
  status: z.enum(AUTH_STATUSES).optional(),
  rlaOffice: z.string().trim().max(60).nullable().optional(),
  exportObligationAmount: money.positive().optional(),
  eoPeriodMonths: eoPeriod.optional(),
  eodcNo: z.string().trim().max(30).nullable().optional(),
  eodcDate: dateStr.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const createEntryBody = z.object({
  shippingBillNo,
  shippingBillDate: dateStr,
  salesInvoiceId: z.string().uuid().optional(),
  fobValueInr: positive,
  realisedOn: dateStr.optional(),
  brcNo: z.string().trim().max(40).optional(),
});

export const idParam = z.string().uuid();

export type CreateClaimInput = z.infer<typeof createClaimBody>;
export type UpdateClaimInput = z.infer<typeof updateClaimBody>;
export type FromInvoiceInput = z.infer<typeof fromInvoiceBody>;
export type CreateAuthorisationInput = z.infer<typeof createAuthorisationBody>;
export type UpdateAuthorisationInput = z.infer<typeof updateAuthorisationBody>;
export type CreateEntryInput = z.infer<typeof createEntryBody>;
export type ListClaimsQuery = z.infer<typeof listClaimsQuery>;
