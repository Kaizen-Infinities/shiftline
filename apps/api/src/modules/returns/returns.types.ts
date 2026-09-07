import { z } from "zod";

const hsn = z
  .string()
  .regex(/^\d{4,8}$/, "HSN must be 4–8 digits")
  .optional()
  .nullable();
const stateCode = z
  .string()
  .regex(/^\d{2}$/)
  .optional()
  .nullable();
const placeId = z.union([z.string(), z.number()]).optional().nullable();

/** A return moves goods back; a price adjustment only corrects value (credit/debit note, no stock). */
export const returnKindSchema = z.enum(["GOODS_RETURN", "PRICE_ADJUSTMENT"]);

export const salesReturnItemSchema = z.object({
  productId: z.number().int(),
  salesInvoiceItemId: z.string().uuid().optional().nullable(),
  quantity: z.number().positive(),
  weight: z.number().nonnegative().optional().nullable(),
  uom: z.string().optional().nullable(),
  unitPrice: z.number().nonnegative(),
  /** GST rate; when absent the original invoice line's rate, else the product's, applies. */
  taxRate: z.number().nonnegative().max(100).optional(),
  hsnCode: hsn,
  reason: z.string().optional(),
});

export const createSalesReturnSchema = z.object({
  customerId: z.string().uuid(),
  salesInvoiceId: z.string().uuid().optional().nullable(),
  kind: returnKindSchema.optional().default("GOODS_RETURN"),
  returnDate: z.string().optional().nullable(),
  reason: z.string().max(255).optional(),
  narration: z.string().max(500).optional(),
  refundMode: z.enum(["CREDIT_NOTE", "CASH", "BANK"]).optional(),
  /** Branch issuing the credit note; defaults to the original invoice's, else the head office. */
  businessPlaceId: placeId,
  placeOfSupply: stateCode,
  /** Ignored: the tenant comes from the session. Accepted so older clients keep working. */
  companyId: z.string().uuid().optional(),
  items: z.array(salesReturnItemSchema).min(1, "At least one item is required"),
});

export const purchaseReturnItemSchema = z.object({
  rawMaterialId: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  /** GST rate; when absent the original GRN line's rate, else the material's, applies. */
  taxRate: z.number().nonnegative().max(100).optional(),
  hsnCode: hsn,
  reason: z.string().optional(),
});

export const createPurchaseReturnSchema = z.object({
  supplierId: z.number().int(),
  grnInvoiceId: z.string().uuid().optional().nullable(),
  kind: returnKindSchema.optional().default("GOODS_RETURN"),
  returnDate: z.string().optional().nullable(),
  storeId: z.string().optional().nullable(),
  reason: z.string().max(255).optional(),
  narration: z.string().max(500).optional(),
  businessPlaceId: placeId,
  companyId: z.string().uuid().optional(),
  items: z.array(purchaseReturnItemSchema).min(1, "At least one item is required"),
});

/** P1-10d: a purchase return's lines move stock, so only the header is editable in place. */
export const updatePurchaseReturnSchema = z.object({
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD")
    .optional(),
  reason: z.string().max(255).optional().nullable(),
  narration: z.string().max(500).optional().nullable(),
});
export type UpdatePurchaseReturnInput = z.infer<typeof updatePurchaseReturnSchema>;

export type CreateSalesReturnInput = z.infer<typeof createSalesReturnSchema>;
export type CreatePurchaseReturnInput = z.infer<typeof createPurchaseReturnSchema>;
