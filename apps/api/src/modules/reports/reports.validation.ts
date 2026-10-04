import { z } from "zod";

import { SalesOrderStatusEnum } from "../sales-order/sales-order.validation";

/** Empty strings from a cleared filter are treated as "not set", as the screens send them. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const dateParam = (name: string) =>
  optional(z.string().refine((v) => !Number.isNaN(Date.parse(v)), `${name} must be a valid date`));

const positiveInt = (name: string, max: number) =>
  optional(
    z
      .string()
      .regex(/^\d+$/, `${name} must be a whole number`)
      .refine((v) => Number(v) >= 1 && Number(v) <= max, `${name} must be between 1 and ${max}`)
  );

const range = {
  startDate: dateParam("startDate"),
  endDate: dateParam("endDate"),
};

export const dateRangeQuerySchema = z.object({ query: z.object(range) });

export const productionOrderReportSchema = z.object({
  params: z.object({ productionOrderId: z.string().min(1).max(20) }),
});

export const salesOrderReportQuerySchema = z.object({
  query: z.object({
    ...range,
    orderNo: optional(z.string().max(30)),
    customerId: optional(z.string().uuid("customerId must be a valid UUID")),
    status: optional(SalesOrderStatusEnum),
    salesPersonName: optional(z.string().max(100)),
    orderType: optional(z.string().max(30)),
    page: positiveInt("page", 1_000_000),
    limit: positiveInt("limit", 500),
  }),
});

export const purchaseOrderReportQuerySchema = z.object({
  query: z.object({
    ...range,
    poNumber: optional(z.string().max(60)),
    supplierId: positiveInt("supplierId", 2_000_000_000),
    status: optional(z.string().max(30)),
    page: positiveInt("page", 1_000_000),
    limit: positiveInt("limit", 500),
  }),
});
