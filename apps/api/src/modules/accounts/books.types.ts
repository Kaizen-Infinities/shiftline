import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD");
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

/** Day book, cash book, bank book (P1-10b). */
export const booksQuerySchema = z.object({
  startDate: optional(day),
  endDate: optional(day),
  type: optional(
    z.enum([
      "PAYMENT",
      "RECEIPT",
      "JOURNAL",
      "CONTRA",
      "SALES",
      "PURCHASE",
      "SALES_RETURN",
      "PURCHASE_RETURN",
      "EXPENSE",
    ])
  ),
  includeCancelled: optional(z.enum(["true", "false"]).transform((v) => v === "true")),
  ledgerId: optional(z.coerce.number().int().positive()),
  search: optional(z.string().max(120)),
});
export type BooksQuery = z.infer<typeof booksQuerySchema>;

/** Cash flow statement (P1-10b): both dates required. */
export const cashFlowQuerySchema = z.object({ startDate: day, endDate: day });
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;
