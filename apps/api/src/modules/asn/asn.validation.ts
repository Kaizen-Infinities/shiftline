import { z } from "zod";

import { normaliseVehicleNo } from "./asn.calc";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-27");

/** `2026-09-27T10:30` (read as India time) or a full ISO timestamp with an offset. */
export const dateTimeStr = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/,
    "Dispatch time looks like 2026-09-27T10:30"
  )
  .refine((v) => !Number.isNaN(Date.parse(withOffset(v))), "That is not a valid date and time");

/** A local time without an offset is India time. */
export function withOffset(v: string): string {
  return /(Z|[+-]\d{2}:\d{2})$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}+05:30`;
}

const qty = z.coerce
  .number({ message: "Quantity must be a number" })
  .positive("Quantity must be greater than 0")
  .max(99_999_999_999, "Quantity is too large");

const packQty = z.coerce
  .number({ message: "Pack quantity must be a number" })
  .positive("Pack quantity must be greater than 0")
  .max(99_999_999_999, "Pack quantity is too large");

const partNo = z
  .string()
  .trim()
  .min(1, "Customer part number is required")
  .max(40, "Customer part number is at most 40 characters");

const productId = z.string().regex(/^\d{1,18}$/, "Product id is a number");

export const idParam = z.string().uuid();

// ── Part map ────────────────────────────────────────────────────────────────
export const partMapListQuery = z.object({
  customerId: z.string().uuid().optional(),
  productId: productId.optional(),
  q: z.string().trim().max(60).optional(),
});

export const createPartMapBody = z.object({
  customerId: z.string().uuid("Pick a customer"),
  productId,
  customerPartNo: partNo,
  description: z.string().trim().max(120).optional(),
  packQty: packQty.optional(),
  packType: z.string().trim().max(30).optional(),
  isActive: z.boolean().optional(),
});

export const updatePartMapBody = z
  .object({
    productId: productId.optional(),
    customerPartNo: partNo.optional(),
    description: z.string().trim().max(120).nullable().optional(),
    packQty: packQty.nullable().optional(),
    packType: z.string().trim().max(30).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

// ── ASN ─────────────────────────────────────────────────────────────────────
const vehicleNo = z
  .string()
  .transform(normaliseVehicleNo)
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}[0-9A-Z]{2,13}$/, "Vehicle number looks like TN09AB1234")
      .max(15, "Vehicle number looks like TN09AB1234")
  );

export const asnLineBody = z.object({
  productId,
  customerPartNo: partNo,
  description: z.string().trim().max(120).optional(),
  qty,
  packQty,
  scheduleLineId: z.string().uuid("Schedule line id is invalid").nullable().optional(),
});

const header = {
  vehicleNo: vehicleNo.optional(),
  transporterName: z.string().trim().max(100).optional(),
  lrNo: z.string().trim().max(30).optional(),
  lrDate: dateStr.optional(),
  dispatchAt: dateTimeStr,
  notes: z.string().trim().max(500).optional(),
};

export const createAsnBody = z.object({
  salesInvoiceId: z.string().uuid("Pick a sales invoice"),
  asnNo: z
    .string()
    .trim()
    .min(1)
    .max(40, "ASN number is at most 40 characters")
    .regex(/^[A-Za-z0-9/_.-]+$/, "ASN number may use letters, digits and / _ . -")
    .optional(),
  ...header,
  /** Omit to take the lines the prefill proposes. */
  lines: z
    .array(asnLineBody)
    .min(1, "Add at least one line")
    .max(200, "At most 200 lines")
    .optional(),
});

export const updateAsnBody = z
  .object({
    vehicleNo: vehicleNo.nullable().optional(),
    transporterName: z.string().trim().max(100).nullable().optional(),
    lrNo: z.string().trim().max(30).nullable().optional(),
    lrDate: dateStr.nullable().optional(),
    dispatchAt: dateTimeStr.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    lines: z.array(asnLineBody).min(1, "Add at least one line").max(200).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

export const statusBody = z
  .object({
    status: z.enum(["SENT", "ACKNOWLEDGED", "CANCELLED"]),
    ackRef: z.string().trim().max(60).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((b) => b.status !== "CANCELLED" || (b.reason?.length ?? 0) >= 3, {
    message: "Give a reason for cancelling",
    path: ["reason"],
  });

export const listQuery = z.object({
  customerId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "SENT", "ACKNOWLEDGED", "CANCELLED"]).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(40).optional(),
});

export const invoicePickerQuery = z.object({
  q: z.string().trim().max(40).optional(),
  customerId: z.string().uuid().optional(),
});

export const prefillQuery = z.object({ salesInvoiceId: z.string().uuid("Pick a sales invoice") });

export const exportQuery = z.object({
  format: z.string().trim().min(1).max(40).default("GENERIC_CSV"),
});

export const labelsQuery = z.object({
  size: z.enum(["A4", "100X150"]).default("A4"),
});

export type CreatePartMapInput = z.infer<typeof createPartMapBody>;
export type UpdatePartMapInput = z.infer<typeof updatePartMapBody>;
export type AsnLineInput = z.infer<typeof asnLineBody>;
export type CreateAsnInput = z.infer<typeof createAsnBody>;
export type UpdateAsnInput = z.infer<typeof updateAsnBody>;
export type StatusInput = z.infer<typeof statusBody>;
export type ListInput = z.infer<typeof listQuery>;
