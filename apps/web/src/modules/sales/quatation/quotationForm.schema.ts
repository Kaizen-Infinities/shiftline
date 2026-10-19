import { z } from "zod";

// Schema for the quotation form. Kept apart from the component so the rules can be
// unit-tested without rendering the screen.

export const componentSchema = z.object({
  componentProductId: z.string(),
  productName: z.string(),
  perUnit: z.number(),
  included: z.boolean(),
  quantity: z.string(),
});

export type ComponentItem = z.infer<typeof componentSchema>;

export const orderItemSchema = z.object({
  salesProductId: z.string().min(1, "Sales product is required"),
  orderQuantity: z.string().min(1, "Quantity is required"),
  unitPrice: z.string().optional(),
  gstRate: z.string().optional(),
  components: z.array(componentSchema),
});

export const quotationSchema = z.object({
  id: z.number().optional(),
  quotationNo: z.string().min(1, "Quotation No is required"),
  quotationDate: z.string().min(1, "Quotation Date is required"),
  validUntil: z.string().optional(),
  customerId: z.string().min(1, "Customer is required"),
  mobile: z.string().optional().nullable(),
  orderSource: z.string().optional().nullable(),
  sourceEmployeeId: z.string().optional().nullable(),
  referredByCustomerId: z.string().optional().nullable(),
  referredByName: z.string().optional().nullable(),
  paymentTermId: z.string().optional(),
  billingAddressLine1: z.string().optional(),
  billingCity: z.string().optional(),
  billingState: z.string().optional(),
  billingPincode: z.string().optional(),
  sameAsBilling: z.boolean(),
  shippingAddressLine1: z.string().optional(),
  shippingCity: z.string().optional(),
  shippingState: z.string().optional(),
  shippingPincode: z.string().optional(),
  items: z.array(orderItemSchema).min(1, "At least one sales product is required"),
  isInterState: z.boolean(),
  remarks: z.string().optional(),
  internalNotes: z.string().optional(),
  // ── Order-level discount (the ONLY discount input in this form) ──
  orderDiscountType: z.enum(["PERCENT", "FLAT"]),
  orderDiscountValue: z.string(),
});

export type QuotationFormValues = z.infer<typeof quotationSchema>;

/**
 * Turns react-hook-form errors into one readable line per blocking field, so a failed
 * Save can say what to fix instead of doing nothing. Item-row errors are prefixed with
 * the row number. `ref` handles are skipped; they are DOM nodes, not messages.
 */
export function blockingFieldMessages(errors: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown, row: number | null) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, i));
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) {
      out.add(row === null ? record.message : `Item ${row + 1}: ${record.message}`);
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "ref" || key === "types") continue;
      walk(child, row);
    }
  };
  walk(errors, null);
  return [...out];
}
