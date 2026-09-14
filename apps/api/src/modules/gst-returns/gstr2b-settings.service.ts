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
});
export type Gstr2bSettingsInput = z.infer<typeof gstr2bSettingsSchema>;

class Gstr2bSettingsService {
  private async ensure() {
    const existing = await prisma.gstr2bSettings.findUnique({
      where: { companyId: requireTenantId() },
    });
    return existing ?? prisma.gstr2bSettings.create({ data: {} });
  }

  async get(): Promise<Gstr2bSettingsInput> {
    const row = await this.ensure();
    return { dateToleranceDays: row.dateToleranceDays, valueTolerance: Number(row.valueTolerance) };
  }

  /** The shape `gstr2bService.reconcile` wants. */
  async tolerance(): Promise<MatchTolerance> {
    const s = await this.get();
    return { days: s.dateToleranceDays, value: s.valueTolerance };
  }

  async update(
    input: Gstr2bSettingsInput,
    actor: { userId?: string }
  ): Promise<Gstr2bSettingsInput> {
    const existing = await this.ensure();
    await prisma.gstr2bSettings.update({
      where: { id: existing.id },
      data: {
        dateToleranceDays: input.dateToleranceDays,
        valueTolerance: input.valueTolerance,
        updatedBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
    return this.get();
  }
}

export const gstr2bSettingsService = new Gstr2bSettingsService();
