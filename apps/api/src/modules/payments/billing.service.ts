import { Prisma, type SubscriptionInvoiceStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";

const n2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const D = (v: number) => new Prisma.Decimal(n2(v));

/** Payment is expected this many days after the period opens before the account goes past due. */
export const GRACE_DAYS = 7;

/**
 * What a tenant owes the platform (P1-21).
 *
 * Kept apart from the tenant's own gateway: this is the platform's account collecting its
 * subscription, and the two must never share credentials or a callback URL. The invoice is the
 * record; the subscription's status follows it rather than being set by hand, which is what the
 * P1-01 note said was missing.
 */
class BillingService {
  /** The period's invoice, raised once. Called by the platform console or a scheduled job. */
  async raise(
    companyId: string,
    input: { periodStart: Date; periodEnd: Date; amount?: number | null }
  ) {
    return runAsTenant(companyId, async () => {
      const subscription = await prisma.subscription.findFirst({ include: { plan: true } });
      if (!subscription) throw new ApiError(404, "That tenant has no subscription");
      const amount = input.amount ?? Number(subscription.plan.priceInrMonthly ?? 0);
      if (amount <= 0) {
        throw new ApiError(400, "That plan has no price; give the amount explicitly", "NO_PRICE");
      }
      const existing = await prisma.subscriptionInvoice.findFirst({
        where: { periodStart: input.periodStart },
      });
      if (existing) return existing;
      const row = await prisma.subscriptionInvoice.create({
        data: {
          planCode: subscription.plan.code,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          amount: D(amount),
          dueAt: new Date(input.periodStart.getTime() + GRACE_DAYS * 86400000),
        },
      });
      logger.info(
        { companyId, planCode: subscription.plan.code, amount },
        "subscription invoice raised"
      );
      return row;
    });
  }

  /**
   * Raises the tenant's next invoice once its current period has ended (P2-T's scheduling gap).
   * Safe to call any number of times a day: it raises at most one invoice, gated on there being
   * none already outstanding, and `raise()` itself dedupes on `periodStart`.
   */
  async raiseNextIfDue(companyId: string, asOf: Date = new Date()) {
    return runAsTenant(companyId, async () => {
      const subscription = await prisma.subscription.findFirst({ include: { plan: true } });
      if (!subscription || subscription.status === "CANCELLED") return null;
      if (subscription.trialEndsAt && subscription.trialEndsAt > asOf) return null;
      const anchor =
        subscription.currentPeriodEnd ?? subscription.currentPeriodStart ?? subscription.createdAt;
      if (anchor > asOf) return null;
      const outstanding = await prisma.subscriptionInvoice.findFirst({
        where: { status: { in: ["DUE", "FAILED"] } },
      });
      if (outstanding) return null;
      const periodEnd = new Date(anchor);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      return this.raise(companyId, { periodStart: anchor, periodEnd });
    });
  }

  async list(companyId: string, status?: SubscriptionInvoiceStatus) {
    return runAsTenant(companyId, () =>
      prisma.subscriptionInvoice.findMany({
        where: { ...(status && { status }) },
        orderBy: { periodStart: "desc" },
        take: 100,
      })
    );
  }

  /**
   * Which tenant a gateway subscription belongs to. The lookup is deliberately the only place
   * that reads across tenants, and it reads one column.
   */
  async tenantForSubscription(providerSubscriptionId: string): Promise<string | null> {
    const row = await withoutTenant(() =>
      prisma.subscription.findFirst({
        where: { providerSubscriptionId },
        select: { companyId: true },
      })
    );
    return row?.companyId ?? null;
  }

  /** Bind a tenant's subscription to the gateway's ids, so callbacks can find their way home. */
  async attachProviderIds(
    companyId: string,
    ids: { providerSubscriptionId: string; providerCustomerId?: string | null }
  ) {
    return runAsTenant(companyId, async () => {
      const subscription = await prisma.subscription.findFirst();
      if (!subscription) throw new ApiError(404, "That tenant has no subscription");
      return prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          providerSubscriptionId: ids.providerSubscriptionId,
          providerCustomerId: ids.providerCustomerId ?? null,
        },
      });
    });
  }

  /**
   * A charge succeeded: the period's invoice is paid and the account is active. Idempotent on the
   * gateway's payment id, because a redelivered callback must not extend the period twice.
   */
  async recordCharge(
    companyId: string,
    input: { providerInvoiceId: string | null; providerPaymentId: string | null; amount: number }
  ) {
    return runAsTenant(companyId, async () => {
      if (input.providerPaymentId) {
        const already = await prisma.subscriptionInvoice.findFirst({
          where: { providerPaymentId: input.providerPaymentId, status: "PAID" },
        });
        if (already) return already;
      }
      const invoice =
        (await prisma.subscriptionInvoice.findFirst({
          where: { status: { in: ["DUE", "FAILED"] } },
          orderBy: { periodStart: "asc" },
        })) ?? null;
      if (!invoice) {
        // Money arrived for a period nobody raised an invoice for. Recording it as an orphan
        // would hide it; refusing it would lose it. The subscription is activated and the
        // platform is told to raise the invoice.
        logger.warn({ companyId }, "subscription charge with no open invoice");
        await this.setStatus(companyId, "ACTIVE", null);
        throw new ApiError(409, "No open subscription invoice for that charge", "NO_OPEN_INVOICE");
      }
      const paid = await prisma.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          providerInvoiceId: input.providerInvoiceId,
          providerPaymentId: input.providerPaymentId,
          failureReason: null,
        },
      });
      await this.setStatus(companyId, "ACTIVE", invoice.periodEnd);
      return paid;
    });
  }

  /** A charge failed: the account is past due, which is what gates the features. */
  async recordFailure(companyId: string, reason: string | null) {
    return runAsTenant(companyId, async () => {
      const invoice = await prisma.subscriptionInvoice.findFirst({
        where: { status: "DUE" },
        orderBy: { periodStart: "asc" },
      });
      if (invoice) {
        await prisma.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: { status: "FAILED", failureReason: reason?.slice(0, 255) ?? null },
        });
      }
      await this.setStatus(companyId, "PAST_DUE", null);
      return invoice;
    });
  }

  async recordCancellation(companyId: string, reason: string | null) {
    return runAsTenant(companyId, async () => {
      const subscription = await prisma.subscription.findFirst();
      if (!subscription) return null;
      return prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          notes: reason?.slice(0, 500) ?? subscription.notes,
        },
      });
    });
  }

  private async setStatus(
    companyId: string,
    status: "ACTIVE" | "PAST_DUE",
    periodEnd: Date | null
  ) {
    const subscription = await prisma.subscription.findFirst();
    if (!subscription) return;
    if (subscription.status === "CANCELLED") return;
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status,
        ...(periodEnd && { currentPeriodEnd: periodEnd }),
      },
    });
    logger.info({ companyId, status }, "subscription status moved by billing");
  }
}

export const billingService = new BillingService();
