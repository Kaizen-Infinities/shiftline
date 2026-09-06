import { z } from "zod";
import { RetentionAction, RetentionDataClass } from "@prisma/client";

const dataClassParam = z.object({
  dataClass: z.nativeEnum(RetentionDataClass),
});

export const upsertPolicySchema = z.object({
  params: dataClassParam,
  body: z.object({
    retentionDays: z.coerce.number().int().min(1).max(36525),
    action: z.nativeEnum(RetentionAction),
    isActive: z.boolean().optional(),
  }),
});

export const runSweepSchema = z.object({
  body: z.object({
    dryRun: z.boolean().default(true),
    dataClasses: z.array(z.nativeEnum(RetentionDataClass)).min(1).optional(),
  }),
});

export const listSweepsSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    dataClass: z.nativeEnum(RetentionDataClass).optional(),
  }),
});

export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>["body"];
export type RunSweepInput = z.infer<typeof runSweepSchema>["body"];
