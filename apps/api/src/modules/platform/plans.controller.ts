import { Request, Response } from "express";
import { FEATURES } from "@shiftline/shared";
import { z } from "zod";

import { prisma } from "../../config/prisma";
import { ApiResponse } from "../../utils/ApiResponse";
import { entitlementService } from "../entitlements/entitlement.service";
import { provisioningService } from "./provisioning.service";

export const updatePlanSchema = z.object({
  params: z.object({ code: z.string().regex(/^[A-Z_]{2,30}$/) }),
  body: z.object({
    name: z.string().min(2).max(80).optional(),
    description: z.string().max(255).optional().nullable(),
    features: z.array(z.enum(FEATURES.map((f) => f.key) as [string, ...string[]])).optional(),
    seatLimit: z.number().int().positive().nullable().optional(),
    apiLimit: z.number().int().positive().nullable().optional(),
    priceInrMonthly: z.number().min(0).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
});

/** Platform catalogue: the plans tenants can be put on and the feature registry behind them. */
export const plansController = {
  list: async (_req: Request, res: Response) => {
    await provisioningService.ensurePlans();
    const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
    res.json(new ApiResponse("Plans", { plans, features: FEATURES }));
  },

  update: async (req: Request, res: Response) => {
    const { code } = req.params as { code: string };
    const body = req.body as z.infer<typeof updatePlanSchema>["body"];
    const plan = await prisma.plan.update({
      where: { code },
      data: {
        ...body,
        features: body.features ? [...new Set(["core", ...body.features])] : undefined,
      },
    });
    // Every tenant on this plan sees the change on their next request.
    entitlementService.invalidate();
    res.json(new ApiResponse("Plan updated", plan));
  },
};
