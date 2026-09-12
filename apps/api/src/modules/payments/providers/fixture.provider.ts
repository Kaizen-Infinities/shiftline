import { createHash, randomUUID } from "node:crypto";

import {
  PaymentProviderError,
  type CreateLinkRequest,
  type CreatedLink,
  type GatewayCredentials,
  type PaymentProvider,
  type ProviderLinkState,
  type ProviderPayment,
  type WebhookEnvelope,
} from "../payments.types";
import { signBody, signatureMatches } from "./signature";

/**
 * A gateway without a gateway.
 *
 * It behaves like one where behaving like one matters: it refuses a link without credentials,
 * keeps its own idea of what has been paid, charges a fee on every capture and signs its
 * callbacks the way a real gateway does. The webhook path a test exercises through this provider
 * is the same code a live gateway will drive.
 */
const FEE_PERCENT = 2;
const FEE_GST_PERCENT = 18;
const n2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const linkId = (reference: string) =>
  `plink_${createHash("sha256").update(reference).digest("hex").slice(0, 14)}`;

interface FixtureLink {
  id: string;
  amount: number;
  paid: number;
  status: ProviderLinkState["status"];
  expiresAt: Date | null;
  payments: ProviderPayment[];
}

export class FixturePaymentProvider implements PaymentProvider {
  readonly name = "FIXTURE";
  private readonly links = new Map<string, FixtureLink>();

  async createLink(request: CreateLinkRequest, creds: GatewayCredentials): Promise<CreatedLink> {
    if (!creds.keyId) throw new PaymentProviderError("BAD_KEY", "The gateway has no key id");
    if (request.amount <= 0) {
      throw new PaymentProviderError("BAD_AMOUNT", "A payment link needs a positive amount");
    }
    const id = linkId(request.reference);
    this.links.set(id, {
      id,
      amount: n2(request.amount),
      paid: 0,
      status: "CREATED",
      expiresAt: request.expiresAt,
      payments: [],
    });
    return {
      providerLinkId: id,
      shortUrl: `https://pay.example/${id}`,
      expiresAt: request.expiresAt,
    };
  }

  async fetchLink(providerLinkId: string, _creds: GatewayCredentials): Promise<ProviderLinkState> {
    const link = this.state(providerLinkId);
    return {
      providerLinkId: link.id,
      status: this.statusOf(link),
      amountPaid: link.paid,
      payments: [...link.payments],
    };
  }

  async cancelLink(providerLinkId: string, _creds: GatewayCredentials): Promise<void> {
    const link = this.state(providerLinkId);
    if (link.paid > 0) {
      throw new PaymentProviderError("PAID", "A link that has been paid cannot be cancelled");
    }
    link.status = "CANCELLED";
  }

  verifySignature(rawBody: string, signature: string | null, creds: GatewayCredentials): boolean {
    return signatureMatches(rawBody, signature, creds.webhookSecret);
  }

  parseWebhook(payload: unknown): WebhookEnvelope | null {
    const body = payload as Record<string, any>;
    const eventId = String(body?.event_id ?? "");
    const eventType = String(body?.event ?? "");
    if (!eventId || !eventType) return null;
    if (eventType.startsWith("subscription.")) {
      const s = body.subscription ?? {};
      const outcome =
        eventType === "subscription.charged"
          ? "PAID"
          : eventType === "subscription.cancelled"
            ? "CANCELLED"
            : "FAILED";
      if (!s.id) return null;
      return {
        eventId,
        eventType,
        providerLinkId: null,
        payment: null,
        subscription: {
          providerSubscriptionId: String(s.id),
          providerInvoiceId: s.invoice_id ? String(s.invoice_id) : null,
          providerPaymentId: s.payment_id ? String(s.payment_id) : null,
          amount: Number(s.amount ?? 0),
          outcome,
          reason: s.reason ? String(s.reason).slice(0, 255) : null,
        },
      };
    }
    const p = body.payment ?? {};
    if (!body.payment_link_id || !p.id) return null;
    return {
      eventId,
      eventType,
      providerLinkId: String(body.payment_link_id),
      payment: {
        providerPaymentId: String(p.id),
        amount: Number(p.amount ?? 0),
        fee: Number(p.fee ?? 0),
        feeTax: Number(p.fee_tax ?? 0),
        method: p.method ? String(p.method) : null,
        capturedAt: p.captured_at ? new Date(p.captured_at) : new Date(),
        status: eventType === "payment.failed" ? "FAILED" : "CAPTURED",
      },
      subscription: null,
    };
  }

  async verify(creds: GatewayCredentials): Promise<{ ok: boolean; detail: string }> {
    if (!creds.keyId || !creds.keySecret) {
      return { ok: false, detail: "The fixture gateway still wants a key id and secret" };
    }
    return { ok: true, detail: "Fixture gateway reachable" };
  }

  // ── Test and demonstration seam ────────────────────────────────────────────
  /**
   * What a payer doing their part looks like from the outside: the payment is recorded here and
   * the signed callback body is handed back, to be posted at the webhook exactly as the gateway
   * would post it.
   */
  simulatePayment(
    providerLinkId: string,
    amount: number,
    creds: GatewayCredentials,
    options: { method?: string; fail?: boolean } = {}
  ): { body: string; signature: string; payment: ProviderPayment } {
    const link = this.state(providerLinkId);
    if (link.status === "CANCELLED") {
      throw new PaymentProviderError("CANCELLED", "That link was cancelled");
    }
    const paid = n2(Math.min(amount, link.amount - link.paid));
    if (!options.fail && paid <= 0) {
      throw new PaymentProviderError("PAID", "That link is already paid in full");
    }
    const fee = n2((paid * FEE_PERCENT) / 100);
    const payment: ProviderPayment = {
      providerPaymentId: `pay_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
      amount: options.fail ? n2(amount) : paid,
      fee: options.fail ? 0 : fee,
      feeTax: options.fail ? 0 : n2((fee * FEE_GST_PERCENT) / 100),
      method: options.method ?? "upi",
      capturedAt: new Date(),
      status: options.fail ? "FAILED" : "CAPTURED",
    };
    if (!options.fail) {
      link.paid = n2(link.paid + paid);
      link.payments.push(payment);
      link.status = link.paid >= link.amount ? "PAID" : "PARTIALLY_PAID";
    }
    const body = JSON.stringify({
      event_id: `evt_${payment.providerPaymentId}`,
      event: options.fail ? "payment.failed" : "payment_link.paid",
      payment_link_id: link.id,
      payment: {
        id: payment.providerPaymentId,
        amount: payment.amount,
        fee: payment.fee,
        fee_tax: payment.feeTax,
        method: payment.method,
        captured_at: payment.capturedAt.toISOString(),
      },
    });
    return {
      body,
      signature: signBody(body, creds.webhookSecret ?? ""),
      payment,
    };
  }

  /** Forgets every link; the suites that share a process do not share a gateway. */
  reset(): void {
    this.links.clear();
  }

  private state(providerLinkId: string): FixtureLink {
    const link = this.links.get(providerLinkId);
    if (!link) throw new PaymentProviderError("NOT_FOUND", "No such payment link at the gateway");
    return link;
  }

  private statusOf(link: FixtureLink): ProviderLinkState["status"] {
    if (link.status === "CANCELLED" || link.status === "PAID") return link.status;
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return "EXPIRED";
    return link.status;
  }
}

export const fixturePaymentProvider = new FixturePaymentProvider();
