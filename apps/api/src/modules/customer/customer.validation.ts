import { CUSTOMER_LIST_MAX_LIMIT, GST_STATE_BY_CODE, isValidGstin } from "@shiftline/shared";
import { z } from "zod";

/** Customer list page size: digits only, at most CUSTOMER_LIST_MAX_LIMIT rows per page. */
export const customerListLimitSchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/, "Limit must be a valid integer")
    .refine(
      (v) => Number(v) >= 1 && Number(v) <= CUSTOMER_LIST_MAX_LIMIT,
      `Limit must be between 1 and ${CUSTOMER_LIST_MAX_LIMIT}`
    )
    .optional(),
});

export const createCustomerSchema = z.object({
  // companyId and createdBy are NOT accepted from the client —
  // both are injected server-side from the authenticated user (req.user)

  customerCode: z.string().min(1, "Customer Code is required"),

  firmName: z.string().min(1, "Firm Name is required"),

  displayName: z.string().optional(),

  customerTypeId: z.number().nullable().optional(),
  customerGradeId: z.number().nullable().optional(),

  mobile: z.any().optional().nullable(),

  phones: z.any().optional().nullable(),

  // accepts "", undefined, or a valid email — only rejects a malformed non-empty string
  email: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.string().email("Invalid email").optional()
  ),

  gstin: z.preprocess(
    (val) => (typeof val === "string" ? val.trim().toUpperCase() : val),
    z
      .string()
      .refine((v) => !v || isValidGstin(v), "Invalid GSTIN (format, state or check digit)")
      .optional()
      .nullable()
  ),
  gstRegType: z
    .enum(["REGULAR", "COMPOSITION", "UNREGISTERED", "SEZ", "OVERSEAS", "UIN"])
    .optional(),
  stateCode: z
    .string()
    .regex(/^\d{2}$/, "State code is two digits")
    .refine((c) => GST_STATE_BY_CODE.has(c), "Unknown GST state code")
    .optional()
    .nullable(),
  //pan: z.string().optional(),

  creditLimit: z.number().optional(),
  creditDays: z.number().nullable().optional(),
  /** Annual % on overdue balances (P1-10); blank means no interest is charged. */
  overdueInterestRate: z.number().min(0).max(100).nullable().optional(),

  transports: z
    .array(
      z.object({
        name: z.string().min(1),
        address: z.string().optional().default(""),
        phone: z.string().optional().default(""),
      })
    )
    .nullable()
    .optional(),

  // Opening balance — set once at creation, never editable
  openingBalance: z.number().min(0, "Opening balance cannot be negative").optional().default(0),
  openingBalanceType: z.enum(["DEBIT", "CREDIT"]).optional().default("DEBIT"),

  addresses: z
    .array(
      z.object({
        addressLine1: z.string().min(1, "Address Line 1 is required"),
        addressLine2: z.string().optional(),
        city: z.string().min(1, "City is required"),
        state: z.string().min(1, "State is required"),
        pincode: z.string().min(6, "Pincode is required"),
        _label: z.string().optional(),
      })
    )
    .optional(),

  status: z.enum(["Active", "OnHold", "Blocked", "Lead", "Inactive"]).optional(),
});

// openingBalance is intentionally excluded from updates — it is immutable after creation
export const updateCustomerSchema = createCustomerSchema.omit({ openingBalance: true }).partial();

export const createCustomerRequestSchema = z.object({
  body: createCustomerSchema,
});

export const updateCustomerRequestSchema = z.object({
  params: z.object({
    id: z.string().uuid("Customer ID must be a valid UUID"),
  }),
  body: updateCustomerSchema,
});

export const customerIdRequestSchema = z.object({
  params: z.object({
    id: z.string().uuid("Customer ID must be a valid UUID"),
  }),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
