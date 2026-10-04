import { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "../../config/prisma";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { auditTrailQuerySchema } from "../audit-trail/audit-trail.types";
import { auditTrailService } from "../audit-trail/audit-trail.service";
import { entitlementService } from "../entitlements/entitlement.service";
import { mobileDeviceService } from "../mobile/mobile.device.service";
import { impersonationService } from "./impersonation.service";
import { disconnectCompany } from "../../lib/realtime";

/**
 * Platform console (P1-02): what an operator needs about a tenant without entering it —
 * usage, subscription, overrides, users, devices and the audit trail — plus suspend/activate.
 * Every read runs under the tenant's own row-level context (`runAsTenant`), never the bypass.
 */
export const tenantIdParam = z.object({ params: z.object({ id: z.string().uuid() }) });
export const updateTenantSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      isActive: z.boolean().optional(),
      suspendReason: z.string().trim().max(255).optional(),
      companyName: z.string().trim().min(2).max(160).optional(),
      legalName: z.string().trim().max(160).nullable().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().max(20).nullable().optional(),
    })
    .refine((b) => Object.keys(b).length > 0, "Nothing to change"),
});
export const tenantAuditSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query: auditTrailQuerySchema,
});
export const deviceParam = z.object({
  params: z.object({ id: z.string().uuid(), deviceId: z.string().uuid() }),
});

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

const tenantOr404 = async (id: string) => {
  const company = await withoutTenant(() => prisma.company.findUnique({ where: { id } }));
  if (!company) throw new ApiError(404, "Tenant not found");
  return company;
};

/** Activity counts a support person reads before touching a tenant. */
const usageOf = (companyId: string) =>
  runAsTenant(companyId, async () => {
    const since = new Date(Date.now() - DAYS_30);
    const [users, activeUsers, invitations, devices, invoices30, vouchers30, grns30, lastLogin] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: "active" } }),
        prisma.invitation.count({ where: { acceptedAt: null, revokedAt: null } }),
        prisma.mobileDevice.count({ where: { revokedAt: null } }),
        prisma.salesInvoice.count({ where: { invoiceDate: { gte: since } } }),
        prisma.voucher.count({ where: { date: { gte: since } } }),
        prisma.grnInvoice.count({ where: { grnDate: { gte: since } } }),
        prisma.user.aggregate({ _max: { lastLoginAt: true } }),
      ]);
    return {
      users,
      activeUsers,
      pendingInvitations: invitations,
      activeDevices: devices,
      last30Days: { salesInvoices: invoices30, vouchers: vouchers30, grns: grns30 },
      lastLoginAt: lastLogin._max.lastLoginAt,
    };
  });

export const consoleController = {
  /** Fleet-wide numbers for the console's landing page. */
  overview: async (_req: Request, res: Response) => {
    const data = await withoutTenant(async () => {
      const [tenants, active, onboarded, users, byStatus, byPlan, devices, impersonations] =
        await Promise.all([
          prisma.company.count(),
          prisma.company.count({ where: { isActive: true } }),
          prisma.company.count({ where: { isOnboarded: true } }),
          prisma.user.count({ where: { status: "active" } }),
          prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
          prisma.subscription.groupBy({ by: ["planId"], _count: { _all: true } }),
          prisma.mobileDevice.count({ where: { revokedAt: null } }),
          impersonationService.list({ active: true, limit: 20 }),
        ]);
      const plans = await prisma.plan.findMany({ select: { id: true, code: true, name: true } });
      const planName = new Map(plans.map((p) => [p.id, p]));
      return {
        tenants: { total: tenants, active, suspended: tenants - active, onboarded },
        activeUsers: users,
        activeDevices: devices,
        subscriptionsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
        subscriptionsByPlan: byPlan.map((r) => ({
          plan: planName.get(r.planId) ?? { id: r.planId, code: null, name: null },
          count: r._count._all,
        })),
        activeImpersonations: impersonations,
      };
    });
    res.json(new ApiResponse("Platform overview", data));
  },

  /** One tenant: record, subscription, overrides, entitlements and usage. */
  detail: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const [subscription, overrides, entitlements, usage, owners] = await Promise.all([
      runAsTenant(company.id, () =>
        prisma.subscription.findUnique({
          where: { companyId: company.id },
          include: { plan: true },
        })
      ),
      runAsTenant(company.id, () =>
        prisma.featureFlagOverride.findMany({ orderBy: { feature: "asc" } })
      ),
      entitlementService.resolve(company.id),
      usageOf(company.id),
      runAsTenant(company.id, () =>
        prisma.user.findMany({
          where: { role: { code: "OWNER" } },
          select: { userId: true, fullName: true, username: true, email: true, status: true },
        })
      ),
    ]);
    res.json(
      new ApiResponse("Tenant", { company, subscription, overrides, entitlements, usage, owners })
    );
  },

  /** Suspend or reactivate, or correct the record. Suspension locks every user out at once. */
  update: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const body = req.body as z.infer<typeof updateTenantSchema>["body"];
    const updated = await withoutTenant(() =>
      prisma.company.update({
        where: { id: company.id },
        data: {
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.companyName !== undefined && { companyName: body.companyName }),
          ...(body.legalName !== undefined && { legalName: body.legalName }),
          ...(body.email !== undefined && { email: body.email }),
          ...(body.phone !== undefined && { phone: body.phone }),
        },
      })
    );
    if (body.isActive === false) {
      // Live sessions end now; the refresh cookie cannot bring them back while suspended.
      await withoutTenant(() =>
        prisma.userSession.updateMany({
          where: { user: { companyId: company.id }, isActive: true },
          data: { isActive: false, logoutAt: new Date() },
        })
      );
      disconnectCompany(company.id);
    }
    entitlementService.changed(company.id);
    res.json(
      new ApiResponse(
        body.isActive === false
          ? "Tenant suspended"
          : body.isActive === true
            ? "Tenant activated"
            : "Tenant updated",
        updated
      )
    );
  },

  overrides: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const rows = await runAsTenant(company.id, () =>
      prisma.featureFlagOverride.findMany({ orderBy: { feature: "asc" } })
    );
    res.json(new ApiResponse("Overrides", rows));
  },

  users: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const rows = await runAsTenant(company.id, () =>
      prisma.user.findMany({
        select: {
          userId: true,
          fullName: true,
          username: true,
          email: true,
          status: true,
          lastLoginAt: true,
          createdOn: true,
          role: { select: { code: true, name: true } },
        },
        orderBy: [{ status: "asc" }, { fullName: "asc" }],
      })
    );
    res.json(new ApiResponse("Users", rows));
  },

  /** The tenant's audit trail, read exactly as its auditor would see it. */
  audit: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const q = auditTrailQuerySchema.parse(req.query);
    const page = await runAsTenant(company.id, () => auditTrailService.list(q));
    res.json(new ApiResponse("Audit trail", page));
  },

  devices: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const rows = await runAsTenant(company.id, () =>
      mobileDeviceService.list({ includeRevoked: true })
    );
    res.json(new ApiResponse("Devices", rows));
  },

  revokeDevice: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const row = await runAsTenant(company.id, () =>
      mobileDeviceService.revoke(String(req.params.deviceId), req.user?.userId)
    );
    res.json(new ApiResponse("Device revoked", row));
  },
};
