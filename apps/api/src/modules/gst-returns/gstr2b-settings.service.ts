import { z } from "zod";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import type { MatchTolerance } from "./gstr2b.types";

/**
 * Per-tenant GSTR-2B matching tolerances (P2-10). The package shipped with a fixed 7 days /
 * ₹1 (`DEFAULT_TOLERANCE` in `gstr2b.types.ts`); an accountant now sets their own, and the
 * reconciliation reads them instead whenever it is not told otherwise.
 */
export const gstr2bSettingsSchema = z.object({
  dateToleranceDays: z.coerce.number().int().min(0).max(60),
  valueTolerance: z.coerce.number().min(0).max(100000),
  /** FIXTURE|LIVE for supplier follow-ups (P2-18); replaces the old NODE_ENV check. */
  followUpProvider: z.enum(["FIXTURE", "LIVE"]).optional(),
  /** Days an unfollowed MISSING_IN_2B/MISMATCH record sits before the daily nudge flags it. */
  nudgeAfterDays: z.coerce.number().int().min(1).max(60).optional(),
});
export type Gstr2bSettingsInput = z.infer<typeof gstr2bSettingsSchema>;
export interface Gstr2bSettingsValues {
  dateToleranceDays: number;
  valueTolerance: number;
  followUpProvider: "FIXTURE" | "LIVE";
  nudgeAfterDays: number;
}

class Gstr2bSettingsService {
  private async ensure() {
    const existing = await prisma.gstr2bSettings.findUnique({
      where: { companyId: requireTenantId() },
    });
    return existing ?? prisma.gstr2bSettings.create({ data: {} });
  }

  async get(): Promise<Gstr2bSettingsValues> {
    const row = await this.ensure();
    return {
      dateToleranceDays: row.dateToleranceDays,
      valueTolerance: Number(row.valueTolerance),
      followUpProvider: row.followUpProvider,
      nudgeAfterDays: row.nudgeAfterDays,
    };
  }

  /** The shape `gstr2bService.reconcile` wants. */
  async tolerance(): Promise<MatchTolerance> {
    const s = await this.get();
    return { days: s.dateToleranceDays, value: s.valueTolerance };
  }

  async update(
    input: Gstr2bSettingsInput,
    actor: { userId?: string }
  ): Promise<Gstr2bSettingsValues> {
    const existing = await this.ensure();
    await prisma.gstr2bSettings.update({
      where: { id: existing.id },
      data: {
        dateToleranceDays: input.dateToleranceDays,
        valueTolerance: input.valueTolerance,
        ...(input.followUpProvider ? { followUpProvider: input.followUpProvider } : {}),
        ...(input.nudgeAfterDays ? { nudgeAfterDays: input.nudgeAfterDays } : {}),
        updatedBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
    return this.get();
  }
}

export const gstr2bSettingsService = new Gstr2bSettingsService();
