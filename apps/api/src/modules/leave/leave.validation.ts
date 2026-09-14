import { z } from "zod";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-14");
export const monthStr = z.string().regex(/^\d{4}-\d{2}$/, "A month looks like 2026-09");

export const listRequestsQuery = z.object({
  employeeId: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  fyCode: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const createRequestBody = z.object({
  employeeId: z.string().min(1),
  leaveTypeCode: z.string().min(1).max(20),
  fromDate: dateStr,
  toDate: dateStr,
  halfDayStart: z.boolean().optional(),
  halfDayEnd: z.boolean().optional(),
  reason: z.string().max(255).optional(),
});

export const decisionBody = z.object({
  comments: z.string().max(255).optional(),
});

export const calendarQuery = z.object({
  month: monthStr,
  departmentId: z.coerce.number().int().optional(),
});

export const idParam = z.string().uuid();
