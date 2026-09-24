import { z } from "zod";

import { TNA_TEMPLATE_KEYS, type TnaTemplateKey } from "./order-tna.calc";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-25");

const templateKey = z.enum(TNA_TEMPLATE_KEYS as [TnaTemplateKey, ...TnaTemplateKey[]], {
  message: "Pick one of the T&A templates",
});

export const listQuery = z.object({
  status: z.enum(["ACTIVE", "SHIPPED", "CANCELLED"]).optional(),
  customerId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const createBody = z
  .object({
    tnaNo: z.string().trim().min(1).max(30).optional(),
    customerId: z.string().uuid("Pick a buyer"),
    salesOrderId: z.number().int().positive().optional(),
    buyerPoNo: z.string().trim().min(1, "Enter the buyer's PO number").max(40),
    styleRef: z.string().trim().min(1, "Enter the style reference").max(60),
    description: z.string().max(200).optional(),
    orderQty: z.coerce.number().gt(0, "Order quantity must be more than zero"),
    uom: z.string().max(10).optional(),
    orderDate: dateStr,
    exFactoryDate: dateStr,
    template: templateKey,
    merchandiser: z.string().max(80).optional(),
  })
  .refine((b) => b.exFactoryDate >= b.orderDate, {
    message: "The ex-factory date must be on or after the order date",
    path: ["exFactoryDate"],
  });

export const updateBody = z
  .object({
    description: z.string().max(200).nullable().optional(),
    orderQty: z.coerce.number().gt(0, "Order quantity must be more than zero").optional(),
    uom: z.string().max(10).nullable().optional(),
    exFactoryDate: dateStr.optional(),
    merchandiser: z.string().max(80).nullable().optional(),
    status: z.enum(["ACTIVE", "SHIPPED", "CANCELLED"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });

export const addMilestoneBody = z.object({
  name: z.string().trim().min(1, "Name the milestone").max(80),
  plannedDate: dateStr,
  owner: z.string().max(80).optional(),
  remarks: z.string().max(300).optional(),
});

export const updateMilestoneBody = z
  .object({
    status: z.enum(["PENDING", "DONE", "SKIPPED"]).optional(),
    actualDate: dateStr.nullable().optional(),
    plannedDate: dateStr.optional(),
    owner: z.string().max(80).nullable().optional(),
    remarks: z.string().max(300).nullable().optional(),
  })
  .refine((b) => b.status !== "DONE" || !!b.actualDate, {
    message: "A done milestone needs its actual date",
    path: ["actualDate"],
  });

export const alertsQuery = z.object({
  days: z.coerce.number().int().min(0).max(60).default(3),
});

export const idParam = z.string().uuid();
