/**
 * Creates ERP Sales Orders from orders captured on the Field app.
 * Delegates to the existing sales-order service so pricing (grade rates),
 * GST and the order workflow behave exactly as they do in the web app.
 *
 * The status given to field orders is a per-tenant setting
 * (`MOBILE_ORDER_STATUS`, default DRAFT so the office reviews them; CONFIRMED
 * skips review).
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { emitToTenant } from "../../lib/realtime";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import salesOrderService from "../sales-order/sales-order.service";
import { createSalesOrderSchema } from "../sales-order/sales-order.validation";
import { AgentContext, DeviceInfo, OrderRaw } from "./mobile.types";

export const MOBILE_ORDER_STATUSES = ["DRAFT", "CONFIRMED"] as const;
export type MobileOrderStatus = (typeof MOBILE_ORDER_STATUSES)[number];

/** Tenant setting: status for orders submitted from the field. */
export const mobileOrderStatus = async (): Promise<MobileOrderStatus> => {
  const setting = await prisma.systemSetting.findFirst({ where: { key: "MOBILE_ORDER_STATUS" } });
  const value = (setting?.value || "DRAFT").toUpperCase();
  return (MOBILE_ORDER_STATUSES as readonly string[]).includes(value)
    ? (value as MobileOrderStatus)
    : "DRAFT";
};

class MobileOrderService {
  async create(agent: AgentContext, raw: OrderRaw, device?: DeviceInfo | null) {
    const companyId = requireTenantId();
    const existing = await prisma.mobileSyncRecord.findUnique({
      where: { companyId_clientId: { companyId, clientId: raw.id } },
    });
    if (existing?.serverId) {
      return prisma.salesOrder.findUnique({ where: { id: Number(existing.serverId) } });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: raw.customer_id },
      select: { id: true, mobile: true, deletedAt: true, status: true },
    });
    if (!customer || customer.deletedAt) throw new ApiError(404, "Customer not found");
    if (customer.status === "Blocked") {
      throw new ApiError(400, "Customer is blocked — order not accepted");
    }

    // Merge duplicate product lines (the ERP rejects duplicates).
    const merged = new Map<
      string,
      { productId: string; quantity: number; unitPrice?: number | null }
    >();
    for (const item of raw.items) {
      const key = String(item.productId);
      const prev = merged.get(key);
      if (prev) prev.quantity += item.quantity;
      else
        merged.set(key, {
          productId: key,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? undefined,
        });
    }

    // `createdBy` must reference a real users.user_id row; admin tokens use a virtual id.
    const createdBy = agent.isSuperAdmin ? undefined : agent.userId;
    const status = await mobileOrderStatus();

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const orderNo = await salesOrderService.getNextSalesOrderCode();
      const body = {
        orderNo,
        orderDate: raw.order_date,
        customerId: raw.customer_id,
        mobile: null,
        orderType: "salesperson",
        salesPersonName: agent.fullName || agent.email || agent.userId,
        orderSource: "SALES_PERSON",
        sourceEmployeeId: agent.employeeId ? agent.employeeId.toString() : null,
        status,
        narration: raw.remarks
          ? `${raw.remarks} (mobile order ${raw.id.slice(0, 8)})`
          : `Mobile order ${raw.id.slice(0, 8)}`,
        createdBy,
        items: [...merged.values()].map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          // Only pass a manual price when the agent deliberately overrode it;
          // otherwise the ERP applies the customer-grade price list.
          unitPrice: i.unitPrice && i.unitPrice > 0 ? i.unitPrice : undefined,
        })),
      };

      try {
        const parsed = createSalesOrderSchema.parse({ body }).body;
        const order = await salesOrderService.create(parsed, agent.permissions);
        await prisma.mobileSyncRecord.upsert({
          where: { companyId_clientId: { companyId, clientId: raw.id } },
          create: {
            companyId,
            clientId: raw.id,
            entityType: "ORDER",
            serverId: String(order.id),
            agentUserId: agent.userId.slice(0, 36),
            deviceId: device?.deviceId ?? null,
            status: "OK",
            payload: {
              ...raw,
              total_amount: Number(order.netAmount),
            } as unknown as Prisma.InputJsonValue,
          },
          update: { serverId: String(order.id), status: "OK", error: null },
        });
        if (raw.visit_id) {
          const visit = await prisma.mobileVisit.findUnique({ where: { id: raw.visit_id } });
          if (visit && visit.agentUserId === agent.userId.slice(0, 36)) {
            await prisma.mobileVisit.update({
              where: { id: visit.id },
              data: { outcome: visit.outcome === "COLLECTION" ? "BOTH" : "ORDER" },
            });
          }
        }
        emitToTenant("salesOrder:created", order);
        return order;
      } catch (err: unknown) {
        lastErr = err;
        // Order number collision with a concurrent web/mobile order — regenerate.
        if (err instanceof ApiError && err.statusCode === 409) continue;
        if ((err as { code?: string })?.code === "P2002") continue;
        throw err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new ApiError(500, "Could not allocate an order number");
  }

  async recordFailure(
    agent: AgentContext,
    raw: OrderRaw,
    error: string,
    device?: DeviceInfo | null
  ) {
    const companyId = requireTenantId();
    await prisma.mobileSyncRecord.upsert({
      where: { companyId_clientId: { companyId, clientId: raw.id } },
      create: {
        companyId,
        clientId: raw.id,
        entityType: "ORDER",
        agentUserId: agent.userId.slice(0, 36),
        deviceId: device?.deviceId ?? null,
        status: "FAILED",
        error: error.slice(0, 500),
        payload: raw as unknown as Prisma.InputJsonValue,
      },
      update: {
        status: "FAILED",
        error: error.slice(0, 500),
        payload: raw as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export const mobileOrderService = new MobileOrderService();
