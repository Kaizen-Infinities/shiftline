/**
 * The gateway seam (P1-21).
 *
 * Everything the rest of the module knows about a payment gateway is in this file. A provider
 * turns an amount into a link somebody can pay, tells us what has been paid against it, and
 * proves a callback came from the gateway rather than from whoever guessed the URL. Nothing
 * else in the codebase may reach a gateway directly.
 */

export interface GatewayCredentials {
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
}

export interface CreateLinkRequest {
  /** Our own link number; the gateway shows it to the payer and echoes it back. */
  reference: string;
  amount: number;
  currency: string;
  description: string;
  expiresAt: Date | null;
  customer: { name: string | null; email: string | null; phone: string | null };
}

export interface CreatedLink {
  providerLinkId: string;
  shortUrl: string;
  expiresAt: Date | null;
}

/** One payment the gateway reports. Fees are the gateway's numbers; the books never guess them. */
export interface ProviderPayment {
  providerPaymentId: string;
  amount: number;
  fee: number;
  feeTax: number;
  method: string | null;
  capturedAt: Date;
  status: "CAPTURED" | "FAILED";
}

export interface ProviderLinkState {
  providerLinkId: string;
  status: "CREATED" | "PARTIALLY_PAID" | "PAID" | "EXPIRED" | "CANCELLED";
  amountPaid: number;
  payments: ProviderPayment[];
}

/**
 * A callback, reduced to what we act on. `eventId` is the gateway's own id for the delivery and
 * is what makes replay harmless.
 */
export interface WebhookEnvelope {
  eventId: string;
  eventType: string;
  providerLinkId: string | null;
  payment: ProviderPayment | null;
  /** Subscription callbacks carry the platform's own ids instead of a link. */
  subscription: {
    providerSubscriptionId: string;
    providerInvoiceId: string | null;
    providerPaymentId: string | null;
    amount: number;
    outcome: "PAID" | "FAILED" | "CANCELLED";
    reason: string | null;
  } | null;
}

/** What the gateway refused, in its own words. The code is theirs; the message is the user's. */
export class PaymentProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** Whether trying again can help (network, rate limit) rather than a bad request. */
    public readonly retryable = false
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export interface PaymentProvider {
  readonly name: string;
  createLink(request: CreateLinkRequest, creds: GatewayCredentials): Promise<CreatedLink>;
  fetchLink(providerLinkId: string, creds: GatewayCredentials): Promise<ProviderLinkState>;
  cancelLink(providerLinkId: string, creds: GatewayCredentials): Promise<void>;
  /** Constant-time check that the body was signed with the webhook secret. */
  verifySignature(rawBody: string, signature: string | null, creds: GatewayCredentials): boolean;
  /** null when the callback is one we do not act on; the caller records it and moves on. */
  parseWebhook(payload: unknown): WebhookEnvelope | null;
  /** Proves the credentials work without taking any money. */
  verify(creds: GatewayCredentials): Promise<{ ok: boolean; detail: string }>;
}
