/**
 * Converts Prisma rows into the WatermelonDB raw records the app stores.
 */
import { Prisma } from "@prisma/client";
import {
  CollectionWire,
  CustomerRaw,
  InvoiceRaw,
  OrderWire,
  ProductRaw,
  RouteCustomerRaw,
  RouteRaw,
  VisitWire,
} from "./mobile.types";

export const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (v instanceof Prisma.Decimal) return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const ms = (d: Date | null | undefined): number => (d ? new Date(d).getTime() : 0);
export const msOrNull = (d: Date | null | undefined): number | null =>
  d ? new Date(d).getTime() : null;
export const ymd = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

export const extractPaymentsArray = (raw: unknown): any[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** Customer.mobile is a free-form JSON column in the ERP — normalise to one string. */
export const primaryMobile = (raw: unknown): string | null => {
  if (!raw) return null;
  if (typeof raw === "string") return raw || null;
  if (Array.isArray(raw)) {
    const first = raw.find((x) => x && (typeof x === "string" || typeof x === "object"));
    if (!first) return null;
    return typeof first === "string" ? first : primaryMobile(first);
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["primary", "mobile", "number", "phone", "value"]) {
      if (typeof o[key] === "string" && (o[key] as string).trim()) return o[key] as string;
    }
    const firstStr = Object.values(o).find((v) => typeof v === "string" && (v as string).trim());
    return (firstStr as string) || null;
  }
  return null;
};

export function customerToRaw(c: any, outstanding: number): CustomerRaw {
  const addr = (c.addresses || []).find((a: any) => a.is_default) || (c.addresses || [])[0] || null;
  const a = (addr?.address || {}) as Record<string, any>;
  const line = [a.addressLine1, a.addressLine2].filter(Boolean).join(", ");
  return {
    id: c.id,
    customer_code: c.customerCode,
    firm_name: c.firmName,
    display_name: c.displayName ?? null,
    mobile: primaryMobile(c.mobile),
    email: c.email ?? null,
    gstin: c.gstin ?? null,
    address_line: line || null,
    city: a.city ?? null,
    state: a.state ?? addr?.state_code ?? null,
    pincode: a.pincode ?? null,
    credit_limit: num(c.creditLimit),
    credit_days: c.creditDays ?? null,
    outstanding: Math.round(outstanding * 100) / 100,
    grade_name: c.customerGrade?.name ?? null,
    type_name: c.customerType?.name ?? null,
    status: c.status,
    updated_at: ms(c.updatedAt),
  };
}

export function invoiceBalance(inv: any) {
  const amount = num(inv.grandTotal ?? inv.subTotal);
  const paid = extractPaymentsArray(inv.payments).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = Math.max(0, Math.round((amount - paid) * 100) / 100);
  let status = "UNPAID";
  if (balance <= 0 && amount > 0) status = "PAID";
  else if (paid > 0) status = "PARTIAL";
  return { amount, paid: Math.round(paid * 100) / 100, balance, status };
}

export function invoiceToRaw(inv: any): InvoiceRaw {
  const { amount, paid, balance, status } = invoiceBalance(inv);
  return {
    id: inv.id,
    invoice_no: inv.invoiceNo,
    customer_id: inv.customerId,
    invoice_date: ymd(inv.invoiceDate) || ymd(inv.createdAt) || "",
    due_date: ymd(inv.dueDate),
    grand_total: amount,
    paid_amount: paid,
    balance,
    status,
    updated_at: ms(inv.updatedAt),
  };
}

export function productToRaw(p: any): ProductRaw {
  return {
    id: String(p.id),
    product_code: p.productCode,
    product_name: p.productName,
    uom: p.uom?.uomName ?? p.uom?.uomCode ?? null,
    rate: num(p.rate),
    grade_rates: JSON.stringify(p.gradeRates ?? {}),
    category: p.category?.name ?? null,
    is_active: !!p.isActive,
    updated_at: ms(p.updatedAt),
  };
}

export function routeToRaw(r: any): RouteRaw {
  return { id: r.id, route_code: r.routeCode, route_name: r.routeName };
}

export function routeCustomerToRaw(rc: any): RouteCustomerRaw {
  return {
    id: rc.id,
    route_id: rc.routeId,
    customer_id: rc.customerId,
    sequence: rc.sequence ?? 0,
    planned_time: rc.plannedTime ?? null,
  };
}

export function visitToRaw(v: any): VisitWire {
  return {
    id: v.id,
    customer_id: v.customerId,
    route_id: v.routeId ?? null,
    planned_date: ymd(v.plannedDate) || "",
    planned_time: v.plannedTime ?? null,
    sequence: v.sequence ?? 0,
    status: v.status,
    outcome: v.outcome ?? null,
    check_in_at: msOrNull(v.checkInAt),
    check_out_at: msOrNull(v.checkOutAt),
    latitude: v.latitude === null || v.latitude === undefined ? null : num(v.latitude),
    longitude: v.longitude === null || v.longitude === undefined ? null : num(v.longitude),
    notes: v.notes ?? null,
    updated_at: ms(v.updatedAt),
  };
}

export function collectionToRaw(c: any): CollectionWire {
  return {
    id: c.id,
    receipt_no: c.receiptNo,
    customer_id: c.customerId,
    visit_id: c.visitId ?? null,
    amount: num(c.amount),
    payment_mode: c.paymentMode,
    reference_no: c.referenceNo ?? null,
    bank_name: c.bankName ?? null,
    cheque_date: ymd(c.chequeDate),
    drawer_name: c.drawerName ?? null,
    collected_at: ms(c.collectedAt),
    notes: c.notes ?? null,
    allocations: JSON.stringify(c.allocations ?? []),
    attachments: JSON.stringify(c.attachments ?? []),
    status: c.status,
    sync_error: c.syncError ?? null,
    updated_at: ms(c.updatedAt),
  };
}

/**
 * Orders live in the ERP's sales_orders table; the device-side record is
 * rebuilt from the sync map (client id + original payload) and the order row.
 */
export function orderToRaw(record: any, order: any | null): OrderWire {
  const payload = (record.payload || {}) as Record<string, any>;
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    id: record.clientId,
    order_no: order?.orderNo ?? null,
    sales_order_id: order ? String(order.id) : null,
    customer_id: payload.customer_id || order?.customerId || "",
    visit_id: payload.visit_id ?? null,
    order_date: payload.order_date || ymd(order?.orderDate) || ymd(record.createdAt) || "",
    items: JSON.stringify(items),
    total_amount: order ? num(order.netAmount) : num(payload.total_amount),
    remarks: payload.remarks ?? null,
    status: record.status === "FAILED" ? "FAILED" : order?.status || "SYNCED",
    sync_error: record.error ?? null,
    updated_at: Math.max(ms(record.updatedAt), ms(order?.updatedAt)),
  };
}

/**
 * A collection that failed before a row could be stored (e.g. unknown
 * customer) is echoed from its sync record so the device shows the error.
 */
export function failedCollectionToRaw(record: any): CollectionWire {
  const p = (record.payload || {}) as Record<string, any>;
  return {
    id: record.clientId,
    receipt_no: `MC-FAILED-${String(record.clientId).slice(0, 8)}`,
    customer_id: p.customer_id || "",
    visit_id: p.visit_id ?? null,
    amount: num(p.amount),
    payment_mode: p.payment_mode || "",
    reference_no: p.reference_no ?? null,
    bank_name: p.bank_name ?? null,
    cheque_date: p.cheque_date ?? null,
    drawer_name: p.drawer_name ?? null,
    collected_at: num(p.collected_at),
    notes: p.notes ?? null,
    allocations: JSON.stringify(p.allocations ?? []),
    attachments: JSON.stringify(p.attachments ?? []),
    status: "FAILED",
    sync_error: record.error ?? null,
    updated_at: ms(record.updatedAt),
  };
}
