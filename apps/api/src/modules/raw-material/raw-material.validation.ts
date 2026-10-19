import { z } from "zod";

/**
 * Create Raw Material Validation
 */
export const createRawMaterialSchema = z.object({
  body: z.object({
    rawMaterialId: z
      .string()
      .min(1, "Raw Material ID is required")
      .max(20, "Raw Material ID cannot exceed 20 characters"),

    materialName: z
      .string()
      .min(1, "Material Name is required")
      .max(100, "Material Name cannot exceed 100 characters"),

    categoryId: z.number().int().nonnegative().optional().nullable(),
    hsnCodeId: z.string().uuid().optional().nullable(),
    gstRate: z.number().min(0).max(100).optional().nullable(),

    minimumStock: z.number().nonnegative().optional().nullable(),

    baseUom: z
      .string()
      .min(1, "Base UOM is required")
      .max(100, "Base UOM cannot exceed 100 characters"),

    reorderLevel: z.number().nonnegative().optional().nullable(),

    rate: z.number().nonnegative().optional().nullable(),

    isActive: z.boolean().optional(),

    storeId: z
      .string()
      .min(1, "Store ID is required")
      .max(20, "Store ID cannot exceed 20 characters"),
    locationId: z.string().max(36, "Location ID cannot exceed 36 characters").optional().nullable(),

    batchNo: z.string().max(40, "Batch No cannot exceed 40 characters").optional().nullable(),

    onHandQty: z.number().nonnegative("On Hand Quantity cannot be negative").default(0).optional(),

    reservedQty: z
      .number()
      .nonnegative("Reserved Quantity cannot be negative")
      .default(0)
      .optional(),

    narration: z.string().max(255, "Narration cannot exceed 255 characters").optional().nullable(),

    lastMovementAt: z.string().datetime().optional().nullable(),

    status: z.string().max(20, "Status cannot exceed 20 characters").optional(),

    itemType: z.enum(["RAW_MATERIAL", "WASTAGE"]).optional().nullable(),
  }),
});

/**
 * Update Raw Material Validation
 *
 * Stock is not part of the master record: on-hand and reserved quantities move only through stock
 * transactions and adjustments. The create schema's `.default(0)` must not reach this schema, since
 * `.partial()` would re-apply it on every PUT and zero the stock. A PUT that tries to set stock is
 * refused with 400.
 */
const stockNotEditable = z.never({
  error: "Stock cannot be edited on the raw material. Use a stock adjustment or transaction.",
});

export const updateRawMaterialSchema = z.object({
  body: createRawMaterialSchema.shape.body
    .omit({ rawMaterialId: true, onHandQty: true, reservedQty: true })
    .partial()
    .extend({
      onHandQty: stockNotEditable.optional(),
      reservedQty: stockNotEditable.optional(),
    }),

  params: z.object({
    rawMaterialId: z.string().min(1, "Raw Material ID is required").max(20),
  }),
});

/**
 * Raw Material ID Validation
 */
export const rawMaterialIdSchema = z.object({
  params: z.object({
    rawMaterialId: z.string().min(1, "Raw Material ID is required").max(20),
  }),
});

export type CreateRawMaterialInput = z.infer<typeof createRawMaterialSchema>["body"];
export type UpdateRawMaterialInput = z.infer<typeof updateRawMaterialSchema>["body"];
