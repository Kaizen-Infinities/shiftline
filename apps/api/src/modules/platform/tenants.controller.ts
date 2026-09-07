import { Request, Response } from "express";
import { z } from "zod";

import { runAsTenant } from "../../lib/tenant-context";
import { ApiResponse } from "../../utils/ApiResponse";
import { invitationService } from "../users/invitation.service";
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
    owner: z.object({
      email: z.string().email(),
      fullName: z.string().min(2).max(160),
    }),
  }),
});

type CreateTenantBody = z.infer<typeof createTenantSchema>["body"];

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
        }
      )
    );
  },
};
