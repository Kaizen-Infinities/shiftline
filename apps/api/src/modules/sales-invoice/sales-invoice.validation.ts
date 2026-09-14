import { z } from "zod";

const blankToUndefined = (val: unknown) =>
  val === "" || val === null || val === "null" || val === "undefined" ? undefined : val;

const ItemSchema = z.object({
  productId: z
    .union([z.string(), z.number()])
    .refine((val) => !isNaN(Number(val)), "Product ID must be a valid number"),
  qty: z.coerce.number().min(0.001, "Qty must be > 0"),
  rate: z.coerce.number().min(0, "Rate must be ≥ 0"),
  weight: z.coerce.number().min(0).optional().default(0),
  discountAmount: z.coerce.number().min(0).optional().default(0),
  /** GST rate for the line; when absent the product's own rate or its HSN default applies. */
  taxPercent: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(100).optional()),
  hsnCode: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d{4,8}$/, "HSN must be 4–8 digits")
      .optional()
  ),
  cessRate: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(300).optional()),
  amount: z.coerce.number().min(0).optional(),
  taxAmount: z.coerce.number().min(0).optional(),
  total: z.coerce.number().min(0).optional(),
});

const PaymentSchema = z.object({
  id: z.string().optional(),
  amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
  paymentMethod: z.string().min(1, "Payment method is required"),
  referenceNumber: z.string().optional().nullable(),
  paymentDate: z.string().refine((val) => {
    const d = new Date(val);
    return !isNaN(d.getTime()) && d <= new Date(new Date().setHours(23, 59, 59, 999));
  }, "Payment date must be a valid date and not in the future"),
  /** A cheque instrument (P2-06) schedules the receipt for its own clearing rather than posting
   * today; the register row is created either way. */
  instrumentType: z.preprocess(blankToUndefined, z.enum(["CASH", "BANK", "CHEQUE"]).optional()),
  chequeNo: z.preprocess(blankToUndefined, z.string().max(20).optional()),
  chequeDate: z.preprocess(blankToUndefined, z.string().optional()),
  chequeBank: z.preprocess(blankToUndefined, z.string().max(120).optional()),
  chequeParty: z.preprocess(blankToUndefined, z.string().max(160).optional()),
  /** The settlement rate for a foreign-currency invoice; defaults to the day's rate table. */
  settlementRate: z.preprocess(blankToUndefined, z.coerce.number().positive().optional()),
});

export const CreateSalesInvoiceSchema = z.object({
  /** Left blank, the number comes from the tenant's series for the document type (P1-08). */
  invoiceNo: z.preprocess(blankToUndefined, z.string().trim().min(1).max(30).optional()),
  invoiceDate: z.string().min(1, "Invoice date is required"),
  dueDate: z.preprocess(
    (val) => (val === "" || val === "null" || val === "undefined" ? null : val),
    z.string().optional().nullable()
  ),
  customerId: z.string().uuid("Invalid Customer ID"),
  /** Issuing branch; defaults to the head office. */
  businessPlaceId: z.preprocess(blankToUndefined, z.union([z.string(), z.number()]).optional()),
  /** GST state code of the place of supply; defaults to the customer's state. */
  placeOfSupply: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d{2}$/)
      .optional()
  ),
  reverseCharge: z.preprocess((val) => val === true || val === "true", z.boolean().optional()),
  /** Exports and SEZ supplies (P1-14): under a bond, or on payment of IGST. */
  exportType: z.preprocess(blankToUndefined, z.enum(["UNDER_LUT", "WITH_TAX"]).optional()),
  lutNumber: z.preprocess(blankToUndefined, z.string().max(30).optional()),
  shippingBillNo: z.preprocess(blankToUndefined, z.string().max(20).optional()),
  shippingBillDate: z.preprocess(blankToUndefined, z.string().optional()),
  portCode: z.preprocess(blankToUndefined, z.string().max(10).optional()),
  /** A foreign-currency invoice: line rates are in this currency and convert to rupees. */
  currencyCode: z.preprocess(blankToUndefined, z.string().length(3).toUpperCase().optional()),
  exchangeRate: z.preprocess(blankToUndefined, z.coerce.number().positive().optional()),
  notes: z.string().optional().nullable(),
  storeId: z.string().optional().nullable(),
  salesOrderId: z.preprocess(
    (val) => (val === "" || val === "null" || val === "undefined" ? null : val),
    z.coerce.number().optional().nullable()
  ),
  payments: z.array(PaymentSchema).optional().default([]),
  items: z.array(ItemSchema).min(1, "At least one item is required"),
  status: z.string().optional(),
  narration: z.string().optional().nullable(),
  subTotal: z.coerce.number().optional(),
  discountType: z.string().optional().nullable(),
  discountValue: z.coerce.number().optional().default(0),
  totalDiscount: z.coerce.number().optional().default(0),
  taxTotal: z.coerce.number().optional(),
  grandTotal: z.coerce.number().optional(),

  /** P2-05: TCS (section 394) — scrap sales (206C(1)) or a buyer above the annual threshold
   * (206C(1H)). Accepting the preview collects it; the preview alone does not. */
  collectTcs: z.preprocess((val) => val === true || val === "true", z.boolean().optional()),
  tcsSectionCode: z.preprocess(blankToUndefined, z.string().max(20).optional()),
});

export const UpdateSalesInvoiceSchema = CreateSalesInvoiceSchema.partial();

export const SalesInvoiceIdSchema = z.object({
  id: z.string().uuid("Invalid Sales Invoice ID"),
});

// Request-level schemas
export const createSalesInvoiceRequestSchema = z.object({
  body: CreateSalesInvoiceSchema,
});

export const updateSalesInvoiceRequestSchema = z.object({
  params: SalesInvoiceIdSchema,
  body: UpdateSalesInvoiceSchema,
});

export const salesInvoiceIdRequestSchema = z.object({
  params: SalesInvoiceIdSchema,
});

export type CreateSalesInvoiceInput = z.infer<typeof CreateSalesInvoiceSchema>;
export type UpdateSalesInvoiceInput = z.infer<typeof UpdateSalesInvoiceSchema>;
