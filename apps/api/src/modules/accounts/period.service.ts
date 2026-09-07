import { prisma } from "../../config/prisma";
import type { Db } from "../../lib/prisma";
import { getTenant, requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";

/**
 * Period control (P1-09): three gates decide whether a posting date is allowed.
 *  1. a closed accounting period refuses every date inside it;
 *  2. the company's freeze date (set after a month is filed) refuses that date and earlier;
 *  3. a role's backdating allowance refuses dates too far before today for that user.
 * Platform admins pass the third gate; nothing passes the first two.
 */
export interface PostingActor {
  userId?: string | null;
  isSuperAdmin?: boolean;
}

const dayStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

class PeriodService {
  async createPeriod(data: {
    periodName: string;
    startDate: string;
    endDate: string;
    companyId?: string;
  }) {
    return prisma.accountingPeriod.create({
      data: {
        periodName: data.periodName,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
      },
    });
  }

  async listPeriods(_companyId?: string) {
    return prisma.accountingPeriod.findMany({ orderBy: { startDate: "desc" } });
  }

  async closePeriod(id: number, closedBy?: string) {
    const period = await prisma.accountingPeriod.findUnique({ where: { id } });
    if (!period) throw new ApiError(404, "Accounting period not found");
    if (period.isClosed) throw new ApiError(400, "Period is already closed");
    return prisma.accountingPeriod.update({
      where: { id },
      data: { isClosed: true, closedAt: new Date(), closedBy: closedBy || null },
    });
  }

  async reopenPeriod(id: number) {
    const period = await prisma.accountingPeriod.findUnique({ where: { id } });
    if (!period) throw new ApiError(404, "Accounting period not found");
    // A period behind the freeze date stays closed: move the freeze date first.
    const frozen = await this.freezeDate();
    if (frozen && period.startDate <= frozen) {
      throw new ApiError(
        409,
        `Books are frozen up to ${isoDay(frozen)}; move the freeze date before reopening "${period.periodName}"`,
        "BOOKS_FROZEN"
      );
    }
    return prisma.accountingPeriod.update({
      where: { id },
      data: { isClosed: false, closedAt: null, closedBy: null },
    });
  }

  /** The company's freeze date, or null. */
  async freezeDate(db: Db = prisma): Promise<Date | null> {
    const company = await db.company.findUnique({
      where: { id: requireTenantId() },
      select: { booksFrozenUpTo: true },
    });
    return company?.booksFrozenUpTo ?? null;
  }

  async periodControl() {
    const [frozen, periods, roles] = await Promise.all([
      this.freezeDate(),
      this.listPeriods(),
      prisma.role.findMany({
        select: { id: true, code: true, name: true, backdateDays: true },
        orderBy: { code: "asc" },
      }),
    ]);
    return { booksFrozenUpTo: frozen ? isoDay(frozen) : null, periods, roles };
  }

  /** Sets (or clears) the freeze date. It may only move forward unless `allowBack` is set. */
  async setFreezeDate(date: string | null, opts: { allowBack?: boolean } = {}) {
    const current = await this.freezeDate();
    const next = date ? dayStart(new Date(date)) : null;
    if (next && Number.isNaN(next.getTime())) throw new ApiError(400, "Invalid freeze date");
    if (next && next > dayStart(new Date())) {
      throw new ApiError(400, "The freeze date cannot be in the future");
    }
    if (current && (!next || next < current) && !opts.allowBack) {
      throw new ApiError(
        409,
        `Books are frozen up to ${isoDay(current)}; pass allowBack to move the freeze date back`,
        "BOOKS_FROZEN"
      );
    }
    await prisma.company.update({
      where: { id: requireTenantId() },
      data: { booksFrozenUpTo: next },
    });
    return { booksFrozenUpTo: next ? isoDay(next) : null };
  }

  /**
   * Refuses a posting date that falls in a closed period, on or before the freeze date, or
   * beyond the actor's backdating allowance. Works inside a transaction when `db` is passed.
   */
  async assertPostingAllowed(date: Date, actor?: PostingActor, db: Db = prisma): Promise<void> {
    const day = dayStart(date);
    if (Number.isNaN(day.getTime())) throw new ApiError(400, "Invalid posting date");

    const closedPeriod = await db.accountingPeriod.findFirst({
      where: { isClosed: true, startDate: { lte: day }, endDate: { gte: day } },
    });
    if (closedPeriod) {
      throw new ApiError(
        403,
        `${isoDay(day)} falls in the closed accounting period "${closedPeriod.periodName}"; reopen it before posting`,
        "PERIOD_CLOSED",
        { periodId: closedPeriod.id, periodName: closedPeriod.periodName }
      );
    }

    const frozen = await this.freezeDate(db);
    if (frozen && day <= frozen) {
      throw new ApiError(
        403,
        `Books are frozen up to ${isoDay(frozen)}; ${isoDay(day)} cannot be posted`,
        "BOOKS_FROZEN",
        { booksFrozenUpTo: isoDay(frozen) }
      );
    }

    const who = actor ?? { userId: getTenant()?.userId, isSuperAdmin: getTenant()?.isSuperAdmin };
    if (
      who.isSuperAdmin ||
      !who.userId ||
      who.userId === "system" ||
      who.userId.startsWith("admin_")
    )
      return;
    const user = await db.user.findUnique({
      where: { userId: who.userId },
      select: { role: { select: { backdateDays: true, name: true } } },
    });
    const limit = user?.role?.backdateDays;
    if (limit === null || limit === undefined) return;
    const earliest = dayStart(new Date());
    earliest.setUTCDate(earliest.getUTCDate() - limit);
    if (day < earliest) {
      throw new ApiError(
        403,
        limit === 0
          ? `Your role (${user?.role?.name}) may only post today's date`
          : `Your role (${user?.role?.name}) may post at most ${limit} day${limit === 1 ? "" : "s"} back; ${isoDay(day)} is too early`,
        "BACKDATE_LIMIT",
        { backdateDays: limit, earliestAllowed: isoDay(earliest) }
      );
    }
  }

  /** Kept for callers that only know the company: same as assertPostingAllowed without an actor. */
  async assertDateIsOpen(date: Date, _companyId?: string) {
    return this.assertPostingAllowed(date);
  }
}

export const periodService = new PeriodService();
