import { z } from "zod";

import { CLAIM_STATUSES } from "./msme-claim.calc";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-27");

const FORUMS = ["SAMADHAAN", "MSEFC", "DIRECT"] as const;
const UDYAM = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

export const settingsBody = z
  .object({
    bankRate: z.coerce
      .number()
      .gt(0, "The bank rate must be more than zero")
      .max(25, "The bank rate looks too high; enter it in per cent, e.g. 6.75"),
    bankRateNote: z.string().trim().max(200).nullable().optional(),
    udyamNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(UDYAM, "A Udyam number looks like UDYAM-TN-02-0012345")
      .nullable()
      .optional(),
    enterpriseCategory: z
      .enum(["MICRO", "SMALL", "MEDIUM"], { message: "Pick micro, small or medium" })
      .nullable()
      .optional(),
  })
  .strict();

export const eligibleQuery = z.object({
  customerId: z.string().uuid("Pick a buyer").optional(),
  asOf: dateStr.optional(),
});

export const listQuery = z.object({
  status: z.enum(CLAIM_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
});

export const createBody = z
  .object({
    claimNo: z.string().trim().min(1).max(30).optional(),
    customerId: z.string().uuid("Pick a buyer"),
    invoiceIds: z
      .array(z.string().uuid("Pick invoices from the list"))
      .min(1, "Pick at least one invoice")
      .max(200, "A claim can carry at most 200 invoices"),
    forum: z.enum(FORUMS, { message: "Pick Samadhaan, MSEFC or a direct demand" }).optional(),
    asOf: dateStr.optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((b) => new Set(b.invoiceIds).size === b.invoiceIds.length, {
    message: "An invoice is listed twice",
    path: ["invoiceIds"],
  });

export const statusBody = z
  .object({
    status: z.enum(CLAIM_STATUSES, { message: "Unknown claim status" }),
    filedOn: dateStr.optional(),
    referenceNo: z.string().trim().min(1).max(60).optional(),
    hearingOn: dateStr.optional(),
    settledOn: dateStr.optional(),
    settledAmount: z.coerce.number().min(0, "The settled amount cannot be negative").optional(),
    notes: z.string().max(1000).optional(),
  })
  .refine((b) => b.status !== "FILED" || (!!b.filedOn && !!b.referenceNo), {
    message: "A filed claim needs its filing date and reference number",
    path: ["referenceNo"],
  })
  .refine((b) => b.status !== "SETTLED" || !!b.settledOn, {
    message: "A settled claim needs its settlement date",
    path: ["settledOn"],
  });

export const recomputeBody = z.object({ asOf: dateStr });

export const idParam = z.string().uuid("Unknown claim");
