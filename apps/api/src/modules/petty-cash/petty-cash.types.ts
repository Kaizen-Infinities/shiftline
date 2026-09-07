import { z } from "zod";
import { isValidGstin } from "@shiftline/shared";

export const createPettyCashSchema = z.object({
  entryDate: z.string().optional(),
  category: z.string().min(1, "Category is required").max(80),
  description: z.string().min(1, "Description is required").max(255),
  amount: z.number().positive("Amount must be greater than zero"),
  type: z.enum(["IN", "OUT"]),
  paidTo: z.string().max(120).optional().nullable(),
  receiptNo: z.string().max(40).optional().nullable(),
  /** GST on the bill (P1-08b): input credit is claimed only when the vendor's GSTIN is given. */
  businessPlaceId: z.union([z.string(), z.number()]).optional().nullable(),
  vendorGstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || isValidGstin(v), "Invalid GSTIN")
    .optional()
    .nullable(),
  hsnCode: z
    .string()
    .regex(/^\d{4,8}$/, "HSN/SAC must be 4–8 digits")
    .optional()
    .nullable(),
  gstRate: z.number().min(0).max(100).optional(),
  /** GST included in the amount; derived from the rate when omitted. */
  taxAmount: z.number().min(0).optional(),
  tdsAmount: z.number().min(0).optional(),
});

export const getPettyCashQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  type: z.enum(["IN", "OUT"]).optional(),
  category: z.string().optional(),
});

export type CreatePettyCashInput = z.infer<typeof createPettyCashSchema>;
export type GetPettyCashQueryInput = z.infer<typeof getPettyCashQuerySchema>;
