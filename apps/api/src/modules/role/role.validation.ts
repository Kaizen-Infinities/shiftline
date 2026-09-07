import { z } from "zod";

export const createRoleSchema = z.object({
  body: z.object({
    code: z.string().min(2),
    name: z.string().min(2),
    description: z.string().optional(),
  }),
});

export const updateRoleSchema = z.object({
  body: z.object({
    code: z.string().min(2).optional(),
    name: z.string().min(2).optional(),
    description: z.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
    /** Days this role may post back from today; null = no limit, 0 = today only (P1-09). */
    backdateDays: z.number().int().min(0).max(3660).nullable().optional(),
  }),
});
