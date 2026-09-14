import { z } from "zod";

/** A payroll period, either "YYYY-MM" (monthly) or "YYYY-Www" (weekly) — same shape the payroll
 *  module already uses for `PayrollRun.period`. */
export const wagePeriod = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2]|W\d{2})$/, "wagePeriod must look like YYYY-MM or YYYY-Www");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must look like YYYY-MM-DD");

export const createFineSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  kind: z.enum(["FINE", "DEDUCTION"]),
  occurredOn: isoDate,
  cause: z.string().trim().min(1, "A cause is required").max(2000),
  amount: z.coerce.number().positive(),
  wagePeriod,
});
export type CreateFineInput = z.infer<typeof createFineSchema>;

export const showCauseSchema = z.object({
  showCauseDate: isoDate,
  showCauseRemarks: z.string().trim().min(1, "Remarks are required").max(2000),
});
export type ShowCauseInput = z.infer<typeof showCauseSchema>;

export const cancelFineSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});
export type CancelFineInput = z.infer<typeof cancelFineSchema>;

export const listFinesQuery = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
  kind: z.enum(["FINE", "DEDUCTION"]).optional(),
  status: z.enum(["PENDING", "APPROVED", "CANCELLED"]).optional(),
  wagePeriod: wagePeriod.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListFinesQuery = z.infer<typeof listFinesQuery>;
