/**
 * Shiftline Field app (sales executive) module — wire formats and validation.
 *
 * The mobile app uses WatermelonDB; records travel over the wire in
 * WatermelonDB "raw" form (snake_case column names, JSON columns as strings,
 * timestamps as epoch milliseconds, dates as YYYY-MM-DD strings). These
 * schemas describe exactly that shape so both sides stay in lock-step.
 *
 * Conflict policy (A2), enforced server-side in mobile.sync.service.ts:
 *   - server-owned tables (customers, invoices, products, routes,
 *     route_customers) are pull-only; pushed changes are rejected per table;
 *   - device-created documents (collections, orders) are append-only: only
 *     `created` is honoured, the server assigns numbers, the office cancels;
 *   - visits merge field by field: the office owns planning fields, the agent
 *     owns execution fields;
 *   - tombstones are echoed for 30 days (retention class SYNC_TOMBSTONES);
 *   - every push and position call carries `x-device-id` and `x-app-version`;
 *     revoked devices are refused with 403 DEVICE_REVOKED;
 *   - `x-device-time` more than five minutes off server time yields a
 *     CLOCK_SKEW warning in the response.
 */
import { z } from "zod";

export const PAYMENT_MODES = ["Cash", "Cheque", "UPI", "NEFT"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const VISIT_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "SKIPPED"] as const;
export const VISIT_OUTCOMES = ["COLLECTION", "ORDER", "BOTH", "NO_ACTION"] as const;
export const ATTACHMENT_KINDS = [
  "CASH_RECEIPT",
  "CHEQUE_FRONT",
  "CHEQUE_BACK",
  "UPI_SCREENSHOT",
  "OTHER",
] as const;

/** Tables the server owns; the device never pushes them. */
export const SERVER_OWNED_TABLES = [
  "customers",
  "invoices",
  "products",
  "routes",
  "route_customers",
] as const;

/** Device-created documents the device may only append. */
export const APPEND_ONLY_TABLES = ["collections", "orders"] as const;

/** Visit fields the office owns (planning); the device's copy loses on conflict. */
export const VISIT_PLANNING_FIELDS = [
  "customer_id",
  "route_id",
  "planned_date",
  "planned_time",
  "sequence",
] as const;

/** Visit fields the agent owns (execution); the device's copy wins. */
export const VISIT_EXECUTION_FIELDS = [
  "status",
  "outcome",
  "check_in_at",
  "check_out_at",
  "latitude",
  "longitude",
  "notes",
] as const;

export const TOMBSTONE_DAYS = 30;
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const nullableStr = (max = 500) => z.string().max(max).nullable().optional();
const nullableNum = () => z.coerce.number().nullable().optional();
const epochMs = z.coerce.number().int().nonnegative();

/** JSON columns arrive as strings from WatermelonDB; accept either form. */
const jsonArray = <T extends z.ZodTypeAny>(arraySchema: T) =>
  z.preprocess((v) => {
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return [];
      }
    }
    return v ?? [];
  }, arraySchema);

// ─── Device identity (headers) ───────────────────────────────────────────────

export const deviceHeadersSchema = z.object({
  "x-device-id": z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9._:-]+$/, "Invalid device id")
    .optional(),
  "x-app-version": z.string().max(20).optional(),
  "x-device-platform": z.string().max(20).optional(),
  "x-device-model": z.string().max(80).optional(),
  "x-device-time": z.coerce.number().int().positive().optional(),
});

export interface DeviceInfo {
  deviceId: string;
  appVersion?: string;
  platform?: string;
  model?: string;
  /** Device wall clock at send time (epoch ms). */
  deviceTime?: number;
}

// ─── Collections ─────────────────────────────────────────────────────────────

export const allocationSchema = z.object({
  invoiceId: uuid,
  invoiceNo: z.string().optional(),
  amount: z.coerce.number().positive(),
});
export type Allocation = z.infer<typeof allocationSchema>;

export const attachmentRefSchema = z.object({
  kind: z.enum(ATTACHMENT_KINDS),
  url: z.string().min(1),
  fileId: z.string().nullable().optional(),
  localId: z.string().nullable().optional(),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

export const collectionRawSchema = z.object({
  id: uuid,
  customer_id: uuid,
  visit_id: uuid.nullable().optional(),
  amount: z.coerce.number().positive(),
  payment_mode: z.enum(PAYMENT_MODES),
  reference_no: nullableStr(100),
  bank_name: nullableStr(120),
  cheque_date: isoDate.nullable().optional(),
  drawer_name: nullableStr(160),
  collected_at: epochMs,
  notes: nullableStr(1000),
  allocations: jsonArray(z.array(allocationSchema)).default([]),
  attachments: jsonArray(z.array(attachmentRefSchema)).default([]),
});
export type CollectionRaw = z.infer<typeof collectionRawSchema>;

// ─── Orders ──────────────────────────────────────────────────────────────────

export const orderItemSchema = z.object({
  productId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  productName: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative().nullable().optional(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderRawSchema = z.object({
  id: uuid,
  customer_id: uuid,
  visit_id: uuid.nullable().optional(),
  order_date: isoDate,
  remarks: nullableStr(1000),
  items: jsonArray(z.array(orderItemSchema).min(1, "At least one item is required")),
});
export type OrderRaw = z.infer<typeof orderRawSchema>;

// ─── Visits ──────────────────────────────────────────────────────────────────

export const visitRawSchema = z.object({
  id: uuid,
  customer_id: uuid,
  route_id: uuid.nullable().optional(),
  planned_date: isoDate,
  planned_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  sequence: z.coerce.number().int().default(0),
  status: z.enum(VISIT_STATUSES).default("PLANNED"),
  outcome: z.enum(VISIT_OUTCOMES).nullable().optional(),
  check_in_at: epochMs.nullable().optional(),
  check_out_at: epochMs.nullable().optional(),
  latitude: nullableNum(),
  longitude: nullableNum(),
  notes: nullableStr(1000),
  /** Device-side last modification (epoch ms); drives the field-level merge. */
  updated_at: epochMs.nullable().optional(),
});
export type VisitRaw = z.infer<typeof visitRawSchema>;

// ─── Sync envelope (WatermelonDB protocol) ───────────────────────────────────

const tableChanges = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    created: z.array(item).default([]),
    updated: z.array(item).default([]),
    deleted: z.array(z.string()).default([]),
  });

/** Loose shape used to detect pushes against server-owned tables. */
const anyTableChanges = z
  .object({
    created: z.array(z.unknown()).default([]),
    updated: z.array(z.unknown()).default([]),
    deleted: z.array(z.unknown()).default([]),
  })
  .partial();

/**
 * A device cursor: epoch milliseconds, never in the future beyond clock skew. It orders pulls
 * only; it no longer decides who owns a visit's planning fields.
 */
const deviceCursor = z.coerce
  .number()
  .finite("lastPulledAt must be a timestamp")
  .nonnegative("lastPulledAt must be a timestamp")
  .refine((v) => v <= Date.now() + CLOCK_SKEW_TOLERANCE_MS, "lastPulledAt is in the future");

export const pushBodySchema = z.object({
  lastPulledAt: deviceCursor.nullable().optional(),
  changes: z
    .object({
      visits: tableChanges(visitRawSchema).optional(),
      collections: tableChanges(collectionRawSchema).optional(),
      orders: tableChanges(orderRawSchema).optional(),
      customers: anyTableChanges.optional(),
      invoices: anyTableChanges.optional(),
      products: anyTableChanges.optional(),
      routes: anyTableChanges.optional(),
      route_customers: anyTableChanges.optional(),
    })
    // Tables the server does not know (e.g. local attachments) are ignored.
    .passthrough(),
});
export type PushBody = z.infer<typeof pushBodySchema>;

export const pullQuerySchema = z.object({
  lastPulledAt: z
    .string()
    .optional()
    .transform((v) =>
      v && v !== "null" && v !== "undefined" && !isNaN(Number(v)) ? Number(v) : null
    ),
  full: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

// ─── Positions (A5) ──────────────────────────────────────────────────────────

export const positionSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy_m: z.coerce.number().nonnegative().max(99999).nullable().optional(),
  speed_kmh: z.coerce.number().nonnegative().max(999).nullable().optional(),
  heading: z.coerce.number().min(0).max(360).nullable().optional(),
  battery_pct: z.coerce.number().int().min(0).max(100).nullable().optional(),
  recorded_at: epochMs,
});
export type PositionRaw = z.infer<typeof positionSchema>;

export const positionsBodySchema = z.object({
  positions: z.array(positionSchema).min(1).max(500),
});

export const positionsQuerySchema = z.object({
  /** Only agents seen within this many minutes (default 24 hours). */
  withinMinutes: z.coerce
    .number()
    .int()
    .positive()
    .max(7 * 24 * 60)
    .default(24 * 60),
});

// ─── Admin ───────────────────────────────────────────────────────────────────

export const createRouteSchema = z.object({
  routeCode: z.string().min(1).max(20),
  routeName: z.string().min(1).max(120),
});

export const setRouteCustomersSchema = z.object({
  customers: z.array(
    z.object({
      customerId: uuid,
      sequence: z.coerce.number().int().nonnegative().default(0),
      plannedTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullable()
        .optional(),
    })
  ),
});

export const setRouteAssignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      agentUserId: z.string().min(1).max(36),
      dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
    })
  ),
});

export const planVisitsSchema = z.object({
  agentUserId: z.string().min(1).max(36),
  plannedDate: isoDate,
  visits: z
    .array(
      z.object({
        customerId: uuid,
        plannedTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        sequence: z.coerce.number().int().nonnegative().optional(),
        notes: nullableStr(1000),
      })
    )
    .min(1),
});

export const listVisitsQuerySchema = z.object({
  agentUserId: z.string().optional(),
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const listCollectionsQuerySchema = z.object({
  agentUserId: z.string().optional(),
  customerId: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(50),
});

export const listDevicesQuerySchema = z.object({
  userId: z.string().max(36).optional(),
  includeRevoked: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export const uuidParamSchema = z.object({ id: uuid });

// ─── Agent context (derived from the JWT + user table) ───────────────────────

export interface AgentContext {
  userId: string;
  fullName: string;
  email?: string | null;
  employeeId?: bigint | null;
  isSuperAdmin: boolean;
  permissions: string[];
}

/** Wire record shapes returned by pull (WatermelonDB raw). */
export interface CustomerRaw {
  id: string;
  customer_code: string;
  firm_name: string;
  display_name: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  credit_limit: number;
  credit_days: number | null;
  outstanding: number;
  grade_name: string | null;
  type_name: string | null;
  status: string;
  updated_at: number;
}

export interface InvoiceRaw {
  id: string;
  invoice_no: string;
  customer_id: string;
  invoice_date: string;
  due_date: string | null;
  grand_total: number;
  paid_amount: number;
  balance: number;
  status: string;
  updated_at: number;
}

export interface ProductRaw {
  id: string;
  product_code: string;
  product_name: string;
  uom: string | null;
  rate: number;
  grade_rates: string; // JSON
  category: string | null;
  is_active: boolean;
  updated_at: number;
}

export interface RouteRaw {
  id: string;
  route_code: string;
  route_name: string;
}

export interface RouteCustomerRaw {
  id: string;
  route_id: string;
  customer_id: string;
  sequence: number;
  planned_time: string | null;
}

export interface VisitWire extends Required<
  Omit<VisitRaw, "latitude" | "longitude" | "updated_at">
> {
  latitude: number | null;
  longitude: number | null;
  updated_at: number;
}

export interface CollectionWire {
  id: string;
  receipt_no: string;
  customer_id: string;
  visit_id: string | null;
  amount: number;
  payment_mode: string;
  reference_no: string | null;
  bank_name: string | null;
  cheque_date: string | null;
  drawer_name: string | null;
  collected_at: number;
  notes: string | null;
  allocations: string; // JSON
  attachments: string; // JSON
  status: string;
  sync_error: string | null;
  updated_at: number;
}

export interface OrderWire {
  id: string;
  order_no: string | null;
  sales_order_id: string | null;
  customer_id: string;
  visit_id: string | null;
  order_date: string;
  items: string; // JSON
  total_amount: number;
  remarks: string | null;
  status: string;
  sync_error: string | null;
  updated_at: number;
}

export interface TableChanges<T> {
  created: T[];
  updated: T[];
  deleted: string[];
}

export interface PullResponse {
  changes: {
    customers: TableChanges<CustomerRaw>;
    invoices: TableChanges<InvoiceRaw>;
    products: TableChanges<ProductRaw>;
    routes: TableChanges<RouteRaw>;
    route_customers: TableChanges<RouteCustomerRaw>;
    visits: TableChanges<VisitWire>;
    collections: TableChanges<CollectionWire>;
    orders: TableChanges<OrderWire>;
  };
  timestamp: number;
  full: boolean;
}

export interface SyncWarning {
  code: "CLOCK_SKEW" | "STALE_APP";
  message: string;
  skewMs?: number;
}

export interface SyncRejection {
  table: string;
  reason: "server-owned" | "append-only" | "not-owner";
  ids: string[];
}

export interface PushResults {
  visits: { ok: number; merged: string[]; failed: { id: string; error: string }[] };
  collections: {
    id: string;
    status: "POSTED" | "FAILED" | "SKIPPED";
    receiptNo?: string;
    error?: string;
  }[];
  orders: {
    id: string;
    status: "CREATED" | "FAILED" | "SKIPPED";
    orderNo?: string;
    error?: string;
  }[];
  rejected: SyncRejection[];
  warnings: SyncWarning[];
  serverTime: number;
}
