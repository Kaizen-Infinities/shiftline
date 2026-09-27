import { z } from "zod";

import {
  BILLING_KINDS,
  COST_TYPES,
  JOB_STATUSES,
  STAGE_PLAN_KEYS,
  STAGE_STATUSES,
  type StagePlanKey,
} from "./project-jobs.calc";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-27");
const money = (msg: string) => z.coerce.number().finite().gt(0, msg).lt(1e12);
const optText = (max: number) => z.string().trim().max(max).optional();
const nullText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Numeric ids (Employee, stock issue) arrive as a number or a digit string. */
const bigId = z
  .union([z.number().int().positive(), z.string().regex(/^\d{1,18}$/, "That id is not valid")])
  .transform((v) => BigInt(v));

export const listQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().trim().max(60).optional(),
});

export const createBody = z
  .object({
    jobNo: z.string().trim().min(1, "Enter the job number").max(30),
    customerId: z.string().uuid("Pick a customer"),
    title: z.string().trim().min(1, "Give the job a title").max(120),
    description: optText(500),
    quotedAmount: z.coerce.number().finite().min(0, "The quote cannot be negative").lt(1e12),
    quoteDate: dateStr,
    targetDate: dateStr.optional(),
    chassisNo: optText(40),
    chassisMake: optText(80),
    chassisReceivedOn: dateStr.optional(),
    conditionNotes: optText(500),
    stagePlan: z
      .enum(STAGE_PLAN_KEYS as [StagePlanKey, ...StagePlanKey[]], {
        message: "Pick a stage plan",
      })
      .default("BODY_BUILDING"),
  })
  .refine((b) => !b.targetDate || b.targetDate >= b.quoteDate, {
    message: "The target date must be on or after the quote date",
    path: ["targetDate"],
  });

export const updateBody = z
  .object({
    title: z.string().trim().min(1, "Give the job a title").max(120).optional(),
    description: nullText(500),
    quotedAmount: z.coerce
      .number()
      .finite()
      .min(0, "The quote cannot be negative")
      .lt(1e12)
      .optional(),
    quoteDate: dateStr.optional(),
    targetDate: dateStr.nullable().optional(),
    chassisNo: nullText(40),
    chassisMake: nullText(80),
    chassisReceivedOn: dateStr.nullable().optional(),
    conditionNotes: nullText(500),
    status: z.enum(JOB_STATUSES).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });

export const addStageBody = z
  .object({
    name: z.string().trim().min(1, "Name the stage").max(80),
    weight: z.coerce.number().int().min(1).max(100).optional(),
    plannedStart: dateStr.optional(),
    plannedEnd: dateStr.optional(),
    remarks: optText(300),
  })
  .refine((b) => !b.plannedStart || !b.plannedEnd || b.plannedEnd >= b.plannedStart, {
    message: "The planned end must be on or after the planned start",
    path: ["plannedEnd"],
  });

export const updateStageBody = z
  .object({
    name: z.string().trim().min(1, "Name the stage").max(80).optional(),
    weight: z.coerce.number().int().min(1).max(100).optional(),
    plannedStart: dateStr.nullable().optional(),
    plannedEnd: dateStr.nullable().optional(),
    actualStart: dateStr.nullable().optional(),
    actualEnd: dateStr.nullable().optional(),
    status: z.enum(STAGE_STATUSES).optional(),
    remarks: nullText(300),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" })
  .refine((b) => b.status !== "DONE" || !!b.actualEnd, {
    message: "A finished stage needs its actual end date",
    path: ["actualEnd"],
  });

export const reorderBody = z.object({
  stageIds: z.array(z.string().uuid()).min(1, "Send the stages in their new order").max(50),
});

export const addCostBody = z
  .object({
    type: z.enum(COST_TYPES, { message: "Pick a cost type" }),
    costDate: dateStr,
    description: z.string().trim().min(1, "Describe the cost").max(200),
    /** Quantity; for LABOUR the hours worked. */
    qty: z.coerce.number().finite().gt(0, "Quantity must be more than zero").lt(1e9).optional(),
    uom: optText(20),
    /** Rate; for LABOUR the rate per hour. Defaults from the raw material for MATERIAL. */
    rate: z.coerce.number().finite().min(0, "The rate cannot be negative").lt(1e10).optional(),
    rawMaterialId: z.string().uuid("That raw material id is not valid").optional(),
    stockIssueId: bigId.optional(),
    employeeId: bigId.optional(),
    vendorName: optText(120),
    post: z.boolean().optional(),
  })
  .refine((b) => b.type === "MATERIAL" || (!b.rawMaterialId && b.stockIssueId === undefined), {
    message: "Only a material cost can point to a raw material or a stock issue",
    path: ["rawMaterialId"],
  })
  .refine((b) => b.type === "LABOUR" || b.employeeId === undefined, {
    message: "Only a labour cost can name an employee",
    path: ["employeeId"],
  })
  .refine((b) => b.type !== "LABOUR" || b.qty !== undefined, {
    message: "Enter the hours worked",
    path: ["qty"],
  })
  .refine((b) => b.rate !== undefined || b.rawMaterialId !== undefined, {
    message: "Enter the rate",
    path: ["rate"],
  });

export const postCostsBody = z.object({
  costIds: z.array(z.string().uuid()).max(500).optional(),
});

export const addBillingBody = z
  .object({
    kind: z.enum(BILLING_KINDS, { message: "Pick advance, stage invoice or final invoice" }),
    billDate: dateStr,
    amount: money("The amount must be more than zero"),
    advanceAdjusted: z.coerce
      .number()
      .finite()
      .min(0, "The advance adjusted cannot be negative")
      .optional(),
    stageId: z.string().uuid().optional(),
    salesInvoiceId: z.string().uuid("That invoice id is not valid").optional(),
    reference: optText(60),
    remarks: optText(300),
  })
  .refine((b) => b.kind !== "ADVANCE" || !b.advanceAdjusted, {
    message: "An advance cannot adjust another advance",
    path: ["advanceAdjusted"],
  })
  .refine((b) => (b.advanceAdjusted ?? 0) <= b.amount, {
    message: "The advance adjusted cannot exceed the invoice amount",
    path: ["advanceAdjusted"],
  });

export const idParam = z.string().uuid();
