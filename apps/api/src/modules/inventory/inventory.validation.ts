import { z } from "zod";

/** Manual EOD rerun: an optional past (or current) calendar day, at most a year back. */
export const runEodStockSchema = z.object({
  query: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Date looks like 2026-09-14")
      .refine((v) => !isNaN(Date.parse(v.slice(0, 10))), "Invalid date format")
      .refine(
        (v) => Date.parse(v.slice(0, 10)) <= Date.now() + 24 * 60 * 60 * 1000,
        "Date cannot be in the future"
      )
      .refine(
        (v) => Date.parse(v.slice(0, 10)) >= Date.now() - 366 * 24 * 60 * 60 * 1000,
        "Date cannot be more than a year back"
      )
      .optional(),
  }),
});

/**
 * Validation schema for EOD Stock query parameters
 */
export const getEodStockSchema = z.object({
  query: z.object({
    date: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), "Invalid date format")
      .optional(),
    category: z.enum(["RAW_MATERIAL", "FINISHED_PRODUCT", "WASTAGE"]).optional(),
    storeId: z.string().optional(),
    search: z.string().optional(),
    page: z
      .string()
      .regex(/^\d+$/, "Page must be a valid number")
      .optional()
      .or(z.number().optional()),
    limit: z
      .string()
      .regex(/^\d+$/, "Limit must be a valid number")
      .optional()
      .or(z.number().optional()),
  }),
});
