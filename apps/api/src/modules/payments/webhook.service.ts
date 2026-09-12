import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { decryptText } from "../../utils/crypto";
import { billingService } from "./billing.service";
import { paymentsService } from "./payments.service";
import type { WebhookEnvelope } from "./payments.types";
import { paymentProviderFor } from "./providers";
import { signatureMatches } from "./providers/signature";

export interface CallbackResult {
  status: "PROCESSED" | "IGNORED" | "DUPLICATE";
  detail: string;
}

/**
 * Callbacks (P1-21).
 *
 * Three rules hold here and each one exists because the alternative loses money. The body is
 * verified before it is believed. The event is written down before it is acted on, so a failure
 * halfway leaves a record rather than a silence. And the gateway's event id makes a redelivery
 * a no-op, because every gateway redelivers.
 */
class WebhookService {
  /**
   * A tenant's own gateway. The URL carries an opaque token, so nothing about the tenant is
   * visible in it, and the token resolves to exactly one company.
   */
  async handleTenantCallback(
    token: string,
    rawBody: string,
    signature: string | null
  ): Promise<CallbackResult> {
    const config = await withoutTenant(() =>
      prisma.paymentGatewayConfig.findUnique({ where: { webhookToken: token } })
    );
    // An unknown token is not told it is unknown: the reply is the same as a bad signature.
    if (!config) throw new ApiError(401, "Callback rejected", "BAD_CALLBACK");

    return runAsTenant(config.companyId, async () => {
      const secret = config.webhookSecret ? decryptText(config.webhookSecret) : null;
      const valid = signatureMatches(rawBody, signature, secret);
      const payload = this.parseBody(rawBody);
      const envelope = valid ? paymentProviderFor(config.provider).parseWebhook(payload) : null;
      const eventId =
        envelope?.eventId ?? `unsigned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const existing = await prisma.paymentWebhookEvent.findFirst({
        where: { providerEventId: eventId },
      });
      if (existing) return { status: "DUPLICATE" as const, detail: "Already handled" };

      const event = await prisma.paymentWebhookEvent.create({
        data: {
          providerEventId: eventId,
          eventType: String(envelope?.eventType ?? "unknown").slice(0, 60),
          signatureValid: valid,
          status: "RECEIVED",
          payload: payload as object,
        },
      });

      if (!valid) {
        await this.close(event.id, "FAILED", "Signature did not verify");
        logger.warn({ companyId: config.companyId }, "payment callback with a bad signature");
        throw new ApiError(401, "Callback rejected", "BAD_CALLBACK");
      }
      if (!envelope) {
        await this.close(event.id, "IGNORED", "Not an event we act on");
        return { status: "IGNORED" as const, detail: "Not an event we act on" };
      }
      return this.apply(event.id, envelope);
    });
  }

  /**
   * The platform's own gateway, collecting subscriptions. A separate account, a separate secret
   * and a separate URL: a tenant's gateway must never be able to mark its own subscription paid.
   */
  async handlePlatformCallback(rawBody: string, signature: string | null): Promise<CallbackResult> {
    const secret = env.PLATFORM_GATEWAY_WEBHOOK_SECRET ?? null;
    if (!secret) {
      throw new ApiError(503, "Subscription billing is not configured", "BILLING_OFF");
    }
    if (!signatureMatches(rawBody, signature, secret)) {
      logger.warn({}, "platform billing callback with a bad signature");
      throw new ApiError(401, "Callback rejected", "BAD_CALLBACK");
    }
    const envelope = paymentProviderFor("FIXTURE").parseWebhook(this.parseBody(rawBody));
    if (!envelope?.subscription) return { status: "IGNORED", detail: "Not a subscription event" };

    const companyId = await billingService.tenantForSubscription(
      envelope.subscription.providerSubscriptionId
    );
    if (!companyId) return { status: "IGNORED", detail: "No tenant holds that subscription" };

    const s = envelope.subscription;
    if (s.outcome === "PAID") {
      await billingService.recordCharge(companyId, {
        providerInvoiceId: s.providerInvoiceId,
        providerPaymentId: s.providerPaymentId,
        amount: s.amount,
      });
    } else if (s.outcome === "FAILED") {
      await billingService.recordFailure(companyId, s.reason);
    } else {
      await billingService.recordCancellation(companyId, s.reason);
    }
    return { status: "PROCESSED", detail: `Subscription ${s.outcome.toLowerCase()}` };
  }

  private async apply(eventId: string, envelope: WebhookEnvelope): Promise<CallbackResult> {
    try {
      if (!envelope.payment || !envelope.providerLinkId) {
        await this.close(eventId, "IGNORED", "Nothing to post");
        return { status: "IGNORED", detail: "Nothing to post" };
      }
      const link = await prisma.paymentLink.findFirst({
        where: { providerLinkId: envelope.providerLinkId },
      });
      if (!link) {
        await this.close(eventId, "IGNORED", "No link of ours");
        return { status: "IGNORED", detail: "No link of ours" };
      }
      if (envelope.payment.status === "FAILED") {
        await this.close(eventId, "PROCESSED", null);
        return { status: "PROCESSED", detail: "Payment failed at the gateway" };
      }
      await paymentsService.applyPayment(link.id, envelope.payment);
      await this.close(eventId, "PROCESSED", null);
      return { status: "PROCESSED", detail: "Payment posted" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not post the payment";
      await this.close(eventId, "FAILED", detail);
      // The event row holds the reason; the gateway is told nothing beyond a 500 by the handler.
      throw error;
    }
  }

  private async close(
    id: string,
    status: "PROCESSED" | "IGNORED" | "FAILED",
    error: string | null
  ) {
    await prisma.paymentWebhookEvent.update({
      where: { id },
      data: { status, error: error?.slice(0, 500) ?? null, processedAt: new Date() },
    });
  }

  private parseBody(rawBody: string): unknown {
    try {
      return JSON.parse(rawBody);
    } catch {
      return { unparsed: rawBody.slice(0, 2000) };
    }
  }
}

export const webhookService = new WebhookService();
