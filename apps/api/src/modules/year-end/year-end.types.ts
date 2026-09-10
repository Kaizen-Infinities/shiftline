import { z } from "zod";

export const fyCodeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Financial year is written YYYY-YY, e.g. 2025-26");

export const previewYearEndQuerySchema = z.object({
  fyCode: z.preprocess((v) => (v === "" ? undefined : v), fyCodeSchema.optional()),
});

export const prepareYearEndSchema = z.object({
  fyCode: fyCodeSchema.optional(),
  notes: z.string().trim().max(255).optional().nullable(),
});

export const reverseYearEndSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason").max(255),
});

export type PrepareYearEndInput = z.infer<typeof prepareYearEndSchema>;
