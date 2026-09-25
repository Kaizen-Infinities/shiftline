import { z } from "zod";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-25");
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month looks like 2026-09");

const qty = z.coerce
  .number({ message: "Quantity must be a number" })
  .positive("Quantity must be greater than 0")
  .max(99_999_999_999, "Quantity is too large");

export const lineBody = z.object({
  customerPartNo: z
    .string()
    .trim()
    .min(1, "Customer part number is required")
    .max(40, "Customer part number is at most 40 characters"),
  description: z.string().trim().max(120).optional(),
  productId: z
    .string()
    .regex(/^\d{1,18}$/, "Product id is a number")
    .optional(),
  dueDate: dateStr,
  firmness: z.enum(["FIRM", "TENTATIVE"]).optional(),
  scheduledQty: qty,
});

export const createScheduleBody = z.object({
  scheduleNo: z.string().trim().min(1, "Schedule number is required").max(40),
  customerId: z.string().uuid("Pick a customer"),
  customerPoNo: z.string().trim().max(40).optional(),
  periodMonth: monthStr,
  receivedOn: dateStr,
  revision: z.coerce.number().int().min(0).max(999).optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(lineBody).max(500, "At most 500 lines at a time").default([]),
});

export const updateScheduleBody = z
  .object({
    scheduleNo: z.string().trim().min(1).max(40).optional(),
    customerPoNo: z.string().trim().max(40).nullable().optional(),
    receivedOn: dateStr.optional(),
    revision: z.coerce.number().int().min(0).max(999).optional(),
    status: z.enum(["OPEN", "CLOSED", "CANCELLED"]).optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

export const addLinesBody = z.object({
  lines: z.array(lineBody).min(1, "Add at least one line").max(500, "At most 500 lines at a time"),
});

export const updateLineBody = lineBody
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

export const dispatchBody = z.object({
  dispatchDate: dateStr,
  qty,
  salesInvoiceId: z.string().uuid().optional(),
  invoiceNo: z.string().trim().max(30).optional(),
  asnNo: z.string().trim().max(40).optional(),
});

export const listQuery = z.object({
  customerId: z.string().uuid().optional(),
  month: monthStr.optional(),
  status: z.enum(["OPEN", "CLOSED", "CANCELLED"]).optional(),
});

export const dueQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  asOf: dateStr.optional(),
});

export const adherenceQuery = z.object({
  from: monthStr,
  to: monthStr,
  customerId: z.string().uuid().optional(),
  asOf: dateStr.optional(),
});

export const idParam = z.string().uuid();

export type LineInput = z.infer<typeof lineBody>;
export type CreateScheduleInput = z.infer<typeof createScheduleBody>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleBody>;
export type UpdateLineInput = z.infer<typeof updateLineBody>;
export type DispatchInput = z.infer<typeof dispatchBody>;
