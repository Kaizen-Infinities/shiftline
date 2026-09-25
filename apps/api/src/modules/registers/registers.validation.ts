import { z } from "zod";

/** A calendar month as the payroll period strings already use it. */
const businessPlaceId = z.string().regex(/^\d+$/, "businessPlaceId must be numeric").optional();

export const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must look like YYYY-MM"),
  businessPlaceId,
  format: z.enum(["json", "csv", "pdf"]).optional().default("json"),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must look like YYYY-MM-DD");

/** A date range, validated so `from` never lands after `to`. */
export const rangeQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    businessPlaceId,
    format: z.enum(["json", "csv", "pdf"]).optional().default("json"),
  })
  .refine((q) => q.from <= q.to, { message: "from must not be after to", path: ["from"] });

export type MonthQuery = z.infer<typeof monthQuery>;
export type RangeQuery = z.infer<typeof rangeQuery>;
