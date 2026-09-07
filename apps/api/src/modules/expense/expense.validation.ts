import { z } from "zod";
import { isValidGstin } from "@shiftline/shared";

const numberish = z.union([z.number(), z.string()]).transform((val) => Number(val));
const optionalNumber = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((val) => (val === undefined || val === null || val === "" ? undefined : Number(val)));
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || isValidGstin(v), "Invalid GSTIN")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** GST and TDS on an expense (P1-08b). `amount` is the bill total; the rest is derived when omitted. */
const gstFields = {
  businessPlaceId: z.union([z.number(), z.string()]).optional().nullable(),
  vendorGstin: gstin,
  hsnCode: z
    .string()
    .regex(/^\d{4,8}$/, "HSN/SAC must be 4–8 digits")
    .optional()
    .nullable(),
  /** Value before GST; defaults to the amount net of GST (or the full amount under reverse charge). */
  taxableAmount: optionalNumber,
  gstRate: optionalNumber,
  reverseCharge: z.boolean().optional(),
  /** False for blocked credits under section 17(5), e.g. food, personal vehicles. */
  itcEligible: z.boolean().optional(),
  tdsSection: z.string().max(10).optional().nullable(),
  tdsRate: optionalNumber,
  tdsAmount: optionalNumber,
};

export const createExpenseSchema = z.object({
  body: z.object({
    expenseNumber: z.string().min(1, "Expense number is required").max(30),
    expenseCategory: z.string().min(1, "Expense category is required").max(60),
    date: z.preprocess((val) => new Date(val as string), z.date()),
    expense: z.string().min(1, "Expense name is required").max(120),
    amount: numberish,
    description: z.string().optional().nullable(),
    paymentMethod: z.string().min(1, "Payment method is required").max(50),
    status: z.enum(["Draft", "Pending", "Approved"]).optional().default("Draft"),
    notes: z.string().optional().nullable(),
    receiptInvoice: z.string().optional().nullable(),
    supplierId: z
      .union([z.number(), z.string()])
      .optional()
      .nullable()
      .transform((val) => (val ? Number(val) : null)),
    ...gstFields,
  }),
});

export const updateExpenseSchema = z.object({
  body: z.object({
    expenseNumber: z.string().max(30).optional(),
    expenseCategory: z.string().max(60).optional(),
    date: z.preprocess((val) => (val ? new Date(val as string) : undefined), z.date().optional()),
    expense: z.string().max(120).optional(),
    amount: optionalNumber,
    description: z.string().optional().nullable(),
    paymentMethod: z.string().max(50).optional(),
    status: z.enum(["Draft", "Pending", "Approved", "Rejected"]).optional(),
    notes: z.string().optional().nullable(),
    receiptInvoice: z.string().optional().nullable(),
    supplierId: z
      .union([z.number(), z.string()])
      .optional()
      .nullable()
      .transform((val) => (val ? Number(val) : null)),
    ...gstFields,
  }),
});

export const expenseIdRequestSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid expense ID format"),
  }),
});

export const rejectExpenseSchema = z.object({
  body: z.object({
    reason: z.string().trim().min(3, "Say why the claim is rejected").max(255),
  }),
});
