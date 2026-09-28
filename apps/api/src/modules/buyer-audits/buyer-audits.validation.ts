import { z } from "zod";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-25");

export const STANDARDS = [
  "BSCI",
  "WRAP",
  "SMETA",
  "SA8000",
  "SEDEX",
  "HIGG",
  "CUSTOMER_COC",
  "OTHER",
] as const;
export const AREAS = [
  "WORKING_HOURS",
  "WAGES",
  "HEALTH_SAFETY",
  "CHILD_LABOUR",
  "DOCUMENTATION",
  "ENVIRONMENT",
  "OTHER",
] as const;
export const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR", "OBSERVATION"] as const;
export const AUDIT_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "VERIFIED"] as const;

const standard = z.enum(STANDARDS, { message: "Pick one of the audit standards" });
const area = z.enum(AREAS, { message: "Pick the area of the finding" });
const severity = z.enum(SEVERITIES, { message: "Pick the severity" });

const optText = (max: number) => z.string().trim().max(max).optional();
const nullText = (max: number) => z.string().trim().max(max).nullable().optional();

export const listQuery = z.object({
  status: z.enum(AUDIT_STATUSES).optional(),
  standard: standard.optional(),
  customerId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const createBody = z
  .object({
    auditNo: z.string().trim().min(1).max(30).optional(),
    standard,
    customerId: z.string().uuid("Pick a buyer").optional(),
    auditorFirm: optText(120),
    auditorName: optText(80),
    scheduledDate: dateStr,
    nextAuditDue: dateStr.optional(),
    remarks: optText(500),
  })
  .refine((b) => !b.nextAuditDue || b.nextAuditDue > b.scheduledDate, {
    message: "The next audit must be due after this one",
    path: ["nextAuditDue"],
  });

/** Header edits and the forward-only status move; cancelling has its own route. */
export const updateBody = z
  .object({
    customerId: z.string().uuid("Pick a buyer").nullable().optional(),
    auditorFirm: nullText(120),
    auditorName: nullText(80),
    scheduledDate: dateStr.optional(),
    actualDate: dateStr.nullable().optional(),
    status: z
      .enum(["PLANNED", "IN_PROGRESS", "COMPLETED"], {
        message: "Status moves to IN_PROGRESS or COMPLETED; cancel an audit instead",
      })
      .optional(),
    rating: nullText(40),
    nextAuditDue: dateStr.nullable().optional(),
    remarks: nullText(500),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });

export const cancelBody = z.object({
  reason: z.string().trim().min(3, "Say why the audit is cancelled").max(300),
});

export const findingBody = z.object({
  area,
  severity,
  clauseRef: optText(40),
  description: z.string().trim().min(3, "Describe the finding").max(1000),
});

export const updateFindingBody = z
  .object({
    area: area.optional(),
    severity: severity.optional(),
    clauseRef: nullText(40),
    description: z.string().trim().min(3, "Describe the finding").max(1000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });

const employeeId = z.string().regex(/^\d{1,18}$/, "Pick an employee");

const owner = {
  ownerUserId: z.string().trim().min(1).max(36).optional(),
  ownerEmployeeId: employeeId.optional(),
};

export const actionBody = z
  .object({
    action: z.string().trim().min(3, "Describe the corrective action").max(500),
    ...owner,
    dueDate: dateStr,
  })
  .refine((b) => !(b.ownerUserId && b.ownerEmployeeId), {
    message: "The owner is a user or an employee, not both",
    path: ["ownerEmployeeId"],
  })
  .refine((b) => !!(b.ownerUserId || b.ownerEmployeeId), {
    message: "Pick who owns the action",
    path: ["ownerUserId"],
  });

export const updateActionBody = z
  .object({
    action: z.string().trim().min(3, "Describe the corrective action").max(500).optional(),
    ...owner,
    dueDate: dateStr.optional(),
    status: z.enum(ACTION_STATUSES, { message: "Pick a status" }).optional(),
    evidenceNote: nullText(1000),
    closedOn: dateStr.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" })
  .refine((b) => !(b.ownerUserId && b.ownerEmployeeId), {
    message: "The owner is a user or an employee, not both",
    path: ["ownerEmployeeId"],
  });

export const readinessQuery = z
  .object({ from: dateStr.optional(), to: dateStr.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "The start date must be on or before the end date",
    path: ["from"],
  });

export const ownersQuery = z.object({ q: z.string().trim().max(60).optional() });

export const idParam = z.string().uuid();
