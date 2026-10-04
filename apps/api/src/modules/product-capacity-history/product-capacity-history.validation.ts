import { z } from "zod";

export const createCapacityHistorySchema = z.object({
  body: z.object({
    productId: z.coerce.number().min(1),
    previousCapacity: z.coerce.number().min(0),
    newCapacity: z.coerce.number().min(0),
    productionDate: z.string().min(1),
    machineId: z.string().min(1),
    shiftId: z.string().min(1),
    productionOrderId: z.string().min(1),
    targetQty: z.coerce.number().min(0),
    actualQty: z.coerce.number().min(0),
    operators: z.string().nullable().optional(),
    updatedBy: z.string().nullable().optional(),
  }),
});

/** Manual capacity change: the body the product screen sends. */
export const manualCapacitySchema = z.object({
  body: z.object({
    productId: z.coerce.number().int().min(1),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date looks like 2026-09-14")
      .refine((v) => !isNaN(Date.parse(v)), "Invalid date")
      .refine(
        (v) => Date.parse(v) <= Date.now() + 24 * 60 * 60 * 1000,
        "Date cannot be in the future"
      )
      .refine(
        (v) => Date.parse(v) >= Date.now() - 366 * 24 * 60 * 60 * 1000,
        "Date cannot be more than a year back"
      ),
    shift: z.string().max(20).optional().default("MANUAL"),
    machine: z.string().max(20).optional().default("MANUAL"),
    operators: z.string().max(255).optional().nullable(),
    newCapacity: z.coerce.number().min(0).max(1_000_000_000),
  }),
});

export const productIdSchema = z.object({
  params: z.object({
    productId: z.coerce.number().min(1),
  }),
});

export const machineIdSchema = z.object({
  params: z.object({
    machineId: z.string().min(1),
  }),
});
