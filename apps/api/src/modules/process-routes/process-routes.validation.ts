import { z } from "zod";

import { DIRECTIONS, LOT_STATUSES, STEP_MODES } from "./process-route.calc";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-27");
const optText = (max: number) => z.string().trim().max(max).optional();
const nullText = (max: number) => z.string().trim().max(max).nullable().optional();
const uom = z
  .string()
  .trim()
  .min(1, "Enter the unit")
  .max(20)
  .transform((v) => v.toUpperCase());

/** Product ids are numeric; they arrive as a number or a digit string. */
const productId = z
  .union([
    z.number().int().positive(),
    z.string().regex(/^\d{1,18}$/, "That product id is not valid"),
  ])
  .transform((v) => BigInt(v));

export const idParam = z.string().uuid();

export const stepBody = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the step")
    .max(60)
    .transform((v) => v.toUpperCase()),
  mode: z.enum(STEP_MODES, { message: "Pick in-house or job work" }),
  defaultJobWorkerId: z.string().uuid("That job worker id is not valid").nullable().optional(),
  lossNormPct: z.coerce
    .number()
    .finite()
    .min(0, "The loss norm cannot be negative")
    .lt(100, "The loss norm must be under 100%")
    .default(0),
  uomIn: uom,
  uomOut: uom,
  conversionFactor: z.coerce
    .number()
    .finite()
    .gt(0, "The conversion factor must be more than zero")
    .lt(1e6)
    .nullable()
    .optional(),
  remarks: optText(300),
});

export const routeListQuery = z.object({
  active: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(60).optional(),
});

export const createRouteBody = z.object({
  routeCode: z.string().trim().min(1, "Enter the route code").max(30),
  name: z.string().trim().min(1, "Name the route").max(120),
  description: optText(500),
  productId: productId.optional(),
  steps: z.array(stepBody).min(1, "A route needs at least one step").max(20, "At most 20 steps"),
});

export const updateRouteBody = z
  .object({
    name: z.string().trim().min(1, "Name the route").max(120).optional(),
    description: nullText(500),
    productId: productId.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });

export const replaceStepsBody = z.object({
  steps: z.array(stepBody).min(1, "A route needs at least one step").max(20, "At most 20 steps"),
});

export const lotListQuery = z.object({
  status: z.enum(LOT_STATUSES).optional(),
  routeId: z.string().uuid().optional(),
  q: z.string().trim().max(60).optional(),
});

export const createLotBody = z.object({
  lotNo: z.string().trim().min(1, "Enter the lot number").max(30),
  routeId: z.string().uuid("Pick a route"),
  productId: productId.optional(),
  inputQty: z.coerce.number().finite().gt(0, "The input quantity must be more than zero").lt(1e10),
  inputUom: uom.optional(),
  startDate: dateStr,
  remarks: optText(300),
});

export const movementBody = z.object({
  stepSeq: z.coerce.number().int().min(1, "Pick the step"),
  direction: z.enum(DIRECTIONS, { message: "Pick out or in" }),
  qty: z.coerce.number().finite().gt(0, "The quantity must be more than zero").lt(1e10),
  /** Must match the step's unit (in for OUT, out for IN) when sent. */
  uom: uom.optional(),
  movementDate: dateStr,
  jobWorkerId: z.string().uuid("That job worker id is not valid").optional(),
  challanId: z.string().uuid("That challan id is not valid").optional(),
  closesStep: z.boolean().optional(),
  remarks: optText(300),
});

export const cancelLotBody = z.object({
  reason: z.string().trim().min(3, "Say why the lot is cancelled").max(255),
});

export const challanOptionsQuery = z.object({
  jobWorkerId: z.string().uuid().optional(),
  kind: z.enum(["JOB_WORK_OUT", "JOB_WORK_RETURN"]).optional(),
});
