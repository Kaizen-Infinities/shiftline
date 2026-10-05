import { beforeAll, describe, expect, it } from "vitest";

import { createHmac } from "node:crypto";

import { api } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";

/**
 * What a tenant owes the platform (P1-21).
 *
 * The point of proving this separately is that it is a different gateway account with a
 * different secret: a tenant's own webhook must never be able to mark that tenant's
 * subscription paid.
 */
const PLATFORM_SECRET = "test-platform-billing-secret-0000";
const SUB_ID = `sub_${Date.now().toString(36)}`;

const sign = (body: string) => createHmac("sha256", PLATFORM_SECRET).update(body).digest("hex");

const platformCallback = async (payload: Record<string, unknown>) => {
  const body = JSON.stringify(payload);
  return (await api())
    .post("/api/payments/webhook/platform")
    .set("Content-Type", "application/json")
    .set("x-payment-signature", sign(body))
    .send(body);
};

let COMPANY_ID: string;

describe("subscription billing", () => {
  beforeAll(async () => {
    COMPANY_ID = (await demoCompany()).id;
    const { billingService } = await import("../../src/modules/payments/billing.service");
    await billingService.attachProviderIds(COMPANY_ID, { providerSubscriptionId: SUB_ID });
  });

  it("raises one invoice for a period however many times it is asked", async () => {
    const { billingService } = await import("../../src/modules/payments/billing.service");
    const periodStart = new Date("2031-04-01T00:00:00Z");
    const periodEnd = new Date("2031-04-30T00:00:00Z");
    const first = await billingService.raise(COMPANY_ID, { periodStart, periodEnd, amount: 4999 });
    const second = await billingService.raise(COMPANY_ID, { periodStart, periodEnd, amount: 4999 });
    expect(second.id).toBe(first.id);
    expect(first.status).toBe("DUE");
    expect(Number(first.amount)).toBe(4999);
    // The due date is the grace period after the month opens, not the day it opens.
    expect(first.dueAt.getTime()).toBeGreaterThan(periodStart.getTime());
  });

  it("a charge pays the oldest open invoice and makes the account active, once", async () => {
    const paid = await platformCallback({
      event_id: `evt_charge_${SUB_ID}`,
      event: "subscription.charged",
      subscription: { id: SUB_ID, invoice_id: "inv_1", payment_id: "pay_1", amount: 4999 },
    });
    expect(paid.status, JSON.stringify(paid.body).slice(0, 300)).toBe(200);
    expect(paid.body.data.status).toBe("PROCESSED");

    const prisma = await getPrisma();
    const invoice = await asDemoTenant(() =>
      prisma.subscriptionInvoice.findFirstOrThrow({ where: { providerPaymentId: "pay_1" } })
    );
    expect(invoice.status).toBe("PAID");
    const subscription = await asDemoTenant(() => prisma.subscription.findFirstOrThrow());
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.currentPeriodEnd?.toISOString().slice(0, 10)).toBe("2031-04-30");

    // Redelivered: the period must not be extended twice.
    const again = await platformCallback({
      event_id: `evt_charge_${SUB_ID}_again`,
      event: "subscription.charged",
      subscription: { id: SUB_ID, invoice_id: "inv_1", payment_id: "pay_1", amount: 4999 },
    });
    expect(again.status).toBe(200);
    expect(
      await asDemoTenant(() =>
        prisma.subscriptionInvoice.count({ where: { status: "PAID", providerPaymentId: "pay_1" } })
      )
    ).toBe(1);
  });

  it("a failed charge puts the account past due", async () => {
    const { billingService } = await import("../../src/modules/payments/billing.service");
    await billingService.raise(COMPANY_ID, {
      periodStart: new Date("2031-05-01T00:00:00Z"),
      periodEnd: new Date("2031-05-31T00:00:00Z"),
      amount: 4999,
    });
    const failed = await platformCallback({
      event_id: `evt_fail_${SUB_ID}`,
      event: "subscription.halted",
      subscription: { id: SUB_ID, amount: 4999, reason: "Mandate revoked by the bank" },
    });
    expect(failed.status).toBe(200);

    const prisma = await getPrisma();
    const subscription = await asDemoTenant(() => prisma.subscription.findFirstOrThrow());
    expect(subscription.status).toBe("PAST_DUE");
    const invoice = await asDemoTenant(() =>
      prisma.subscriptionInvoice.findFirstOrThrow({ where: { status: "FAILED" } })
    );
    expect(invoice.failureReason).toContain("Mandate revoked");
  });

  it("refuses a billing callback that is not signed by the platform", async () => {
    const body = JSON.stringify({
      event_id: "evt_forged",
      event: "subscription.charged",
      subscription: { id: SUB_ID, amount: 4999 },
    });
    const res = await (
      await api()
    )
      .post("/api/payments/webhook/platform")
      .set("Content-Type", "application/json")
      .set(
        "x-payment-signature",
        sign(body).replace(/^./, (c) => (c === "0" ? "1" : "0"))
      )
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("BAD_CALLBACK");
  });

  it("ignores a subscription no tenant holds", async () => {
    const res = await platformCallback({
      event_id: "evt_orphan",
      event: "subscription.charged",
      subscription: { id: "sub_nobody", amount: 100 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("IGNORED");
  });
});
