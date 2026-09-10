import { Request, Response } from "express";
import { z } from "zod";

import { FEATURE_KEYS } from "@shiftline/shared";

import { prisma } from "../../config/prisma";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { entitlementService } from "../entitlements/entitlement.service";
import { ApiResponse } from "../../utils/ApiResponse";
import { invitationService } from "../users/invitation.service";
import { impersonationService } from "./impersonation.service";
import { provisioningService } from "./provisioning.service";

export const createTenantSchema = z.object({
  body: z.object({
    companyCode: z
      .string()
      .min(2)
      .max(20)
      .regex(/^[A-Z0-9-]+$/, "companyCode is upper-case letters, digits and hyphens"),
    companyName: z.string().min(2).max(160),
    legalName: z.string().max(160).optional(),
    slug: z.string().min(2).max(40),
    email: z.string().email().optional(),
    phone: z.string().max(20).optional(),
    gstin: z
      .string()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN")
      .optional(),
    stateCode: z
      .string()
      .regex(/^\d{2}$/)
      .optional(),
    addressLine1: z.string().max(255).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    zipcode: z.string().max(20).optional(),
    fyStart: z.coerce.date().optional(),
    planCode: z
      .string()
      .regex(/^[A-Z_]{2,30}$/)
      .optional(),
    subscriptionStatus: z.enum(["TRIALING", "ACTIVE"]).optional(),
    owner: z.object({
      email: z.string().email(),
      fullName: z.string().min(2).max(160),
    }),
  }),
});

type CreateTenantBody = z.infer<typeof createTenantSchema>["body"];

export const tenantIdSchema = z.object({ params: z.object({ id: z.string().uuid() }) });

export const updateSubscriptionSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    planCode: z
      .string()
      .regex(/^[A-Z_]{2,30}$/)
      .optional(),
    status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]).optional(),
    seats: z.number().int().positive().nullable().optional(),
    apiLimit: z.number().int().positive().nullable().optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    currentPeriodEnd: z.coerce.date().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }),
});

export const overrideSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    feature: z.enum(FEATURE_KEYS as [string, ...string[]]),
  }),
  body: z.object({
    enabled: z.boolean(),
    reason: z.string().max(255).optional().nullable(),
    expiresAt: z.coerce.date().nullable().optional(),
  }),
});

export const overrideDeleteSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    feature: z.enum(FEATURE_KEYS as [string, ...string[]]),
  }),
});

const tenantOr404 = async (id: string) => {
  const company = await withoutTenant(() => prisma.company.findUnique({ where: { id } }));
  if (!company) throw new ApiError(404, "Tenant not found");
  return company;
};

/** Platform administration: provision tenants and invite their owners. */
export const tenantsController = {
  list: async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Tenants", await provisioningService.listTenants()));
  },

  create: async (req: Request, res: Response) => {
    const body = req.body as CreateTenantBody;
    const { owner, ...company } = body;
    const result = await provisioningService.provisionTenant({
      ...company,
      createdBy: undefined,
    });
    const invitation = await runAsTenant(result.company.id, () =>
      invitationService.create(
        {
          email: owner.email,
          fullName: owner.fullName,
          roleId: result.roles.OWNER,
          invitedBy: req.user?.userId,
        },
        { companyName: result.company.companyName }
      )
    );
    res.status(result.created ? 201 : 200).json(
      new ApiResponse(
        result.created ? "Tenant provisioned" : "Tenant already existed; defaults ensured",
        {
          company: result.company,
          roles: result.roles,
          fyCode: result.fyCode,
          ownerInvitation: {
            id: invitation.invitation.id,
            email: invitation.invitation.email,
            expiresAt: invitation.invitation.expiresAt,
            emailed: invitation.emailed,
            acceptUrl: invitation.acceptUrl,
          },
          entitlements: await entitlementService.resolve(result.company.id),
        }
      )
    );
  },

  /** Act as one of the tenant's users for up to thirty minutes (P1-02). */
  impersonate: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const { userId, reason } = req.body as { userId?: string; reason: string };
    const result = await impersonationService.start({
      adminUserId: req.user!.userId,
      adminSessionId: req.user!.sessionId,
      companyId: company.id,
      userId,
      reason,
      ipAddress: req.ip,
    });
    res.json(new ApiResponse("Impersonation started", result));
  },

  /** A tenant's plan, status, seats and effective entitlements. */
  subscription: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const subscription = await runAsTenant(company.id, () =>
      prisma.subscription.findUnique({ where: { companyId: company.id }, include: { plan: true } })
    );
    const overrides = await runAsTenant(company.id, () => prisma.featureFlagOverride.findMany());
    res.json(
      new ApiResponse("Subscription", {
        subscription,
        overrides,
        entitlements: await entitlementService.resolve(company.id),
      })
    );
  },

  /** Change plan, status, seats or the API cap; creates the subscription when a legacy tenant has none. */
  updateSubscription: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const body = req.body as z.infer<typeof updateSubscriptionSchema>["body"];
    const plan = body.planCode
      ? await prisma.plan.findUnique({ where: { code: body.planCode } })
      : null;
    if (body.planCode && (!plan || !plan.isActive))
      throw new ApiError(400, `Unknown plan ${body.planCode}`);
    const actor = req.user?.userId;
    const subscription = await runAsTenant(company.id, async () => {
      const existing = await prisma.subscription.findUnique({ where: { companyId: company.id } });
      const data = {
        ...(plan ? { planId: plan.id } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.seats !== undefined ? { seats: body.seats } : {}),
        ...(body.apiLimit !== undefined ? { apiLimit: body.apiLimit } : {}),
        ...(body.trialEndsAt !== undefined ? { trialEndsAt: body.trialEndsAt } : {}),
        ...(body.currentPeriodEnd !== undefined ? { currentPeriodEnd: body.currentPeriodEnd } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.status === "CANCELLED" ? { cancelledAt: new Date() } : {}),
        updatedBy: actor,
      };
      if (existing) {
        return prisma.subscription.update({
          where: { companyId: company.id },
          data,
          include: { plan: true },
        });
      }
      if (!plan)
        throw new ApiError(400, "planCode is required for a tenant without a subscription");
      return prisma.subscription.create({
        data: {
          planId: plan.id,
          status: body.status ?? "ACTIVE",
          seats: body.seats ?? null,
          createdBy: actor,
        },
        include: { plan: true },
      });
    });
    entitlementService.changed(company.id);
    res.json(
      new ApiResponse("Subscription updated", {
        subscription,
        entitlements: await entitlementService.resolve(company.id),
      })
    );
  },

  /** Turn one feature on or off for a tenant regardless of plan. */
  setOverride: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const feature = String(req.params.feature);
    const body = req.body as z.infer<typeof overrideSchema>["body"];
    if (feature === "core") throw new ApiError(400, "core cannot be overridden");
    const row = await runAsTenant(company.id, () =>
      prisma.featureFlagOverride.upsert({
        where: { companyId_feature: { companyId: company.id, feature } },
        update: {
          enabled: body.enabled,
          reason: body.reason ?? null,
          expiresAt: body.expiresAt ?? null,
        },
        create: {
          feature,
          enabled: body.enabled,
          reason: body.reason ?? null,
          expiresAt: body.expiresAt ?? null,
          createdBy: req.user?.userId,
        },
      })
    );
    entitlementService.changed(company.id);
    res.json(
      new ApiResponse("Override saved", {
        override: row,
        entitlements: await entitlementService.resolve(company.id),
      })
    );
  },

  removeOverride: async (req: Request, res: Response) => {
    const company = await tenantOr404(String(req.params.id));
    const feature = String(req.params.feature);
    await runAsTenant(company.id, () =>
      prisma.featureFlagOverride.deleteMany({ where: { feature } })
    );
    entitlementService.changed(company.id);
    res.json(
      new ApiResponse("Override removed", {
        entitlements: await entitlementService.resolve(company.id),
      })
    );
  },
};
