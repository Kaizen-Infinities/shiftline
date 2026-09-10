import { z } from "zod";

/** Blank query-string values mean "no filter". */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD");

export const auditTrailQuerySchema = z.object({
  /** Table name as recorded by the trigger, e.g. `vouchers`. */
  entity: optional(z.string().min(1).max(64)),
  entityId: optional(z.string().min(1).max(64)),
  action: optional(z.enum(["CREATE", "UPDATE", "DELETE"])),
  userId: optional(z.string().min(1).max(64)),
  requestId: optional(z.string().min(1).max(64)),
  from: optional(day),
  to: optional(day),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type AuditTrailQuery = z.infer<typeof auditTrailQuerySchema>;
