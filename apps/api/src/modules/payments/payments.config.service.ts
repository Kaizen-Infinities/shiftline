import { randomBytes } from "node:crypto";

import { z } from "zod";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { decryptText, encryptText } from "../../utils/crypto";
import type { GatewayCredentials } from "./payments.types";
import { PAYMENT_PROVIDERS, paymentProviderFor } from "./providers";

/**
 * Per-tenant gateway settings (P1-21). Secrets are encrypted at rest and never returned — the
 * client is told only whether one is set — and a blank secret in an update keeps the stored one,
 * so saving the form does not wipe credentials nobody retyped.
 */
export const gatewayConfigSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS).default("FIXTURE"),
  enabled: z.boolean().default(false),
  keyId: z.string().max(120).optional().nullable(),
  keySecret: z.string().max(400).optional().nullable(),
  webhookSecret: z.string().max(400).optional().nullable(),
  bankLedgerCode: z.string().max(20).default("BANK-001"),
  feeLedgerCode: z.string().max(20).default("PG-FEE-001"),
  expiryHours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(72),
});
export type GatewayConfigInput = z.infer<typeof gatewayConfigSchema>;

export interface PublicGatewayConfig {
  provider: string;
  enabled: boolean;
  keyId: string | null;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  bankLedgerCode: string;
  feeLedgerCode: string;
  expiryHours: number;
  /** The path the gateway is given; it carries a token rather than a company id. */
  webhookPath: string;
  lastVerifiedAt: string | null;
}

class PaymentsConfigService {
  async row() {
    return prisma.paymentGatewayConfig.findUnique({ where: { companyId: requireTenantId() } });
  }

  /** The row, created with a fresh webhook token the first time anybody asks. */
  async ensure() {
    const existing = await this.row();
    if (existing) return existing;
    return prisma.paymentGatewayConfig.create({
      data: { webhookToken: randomBytes(24).toString("hex") },
    });
  }

  async get(): Promise<PublicGatewayConfig> {
    const c = await this.ensure();
    return {
      provider: c.provider,
      enabled: c.enabled,
      keyId: c.keyId,
      hasKeySecret: Boolean(c.keySecret),
      hasWebhookSecret: Boolean(c.webhookSecret),
      bankLedgerCode: c.bankLedgerCode,
      feeLedgerCode: c.feeLedgerCode,
      expiryHours: c.expiryHours,
      webhookPath: `/api/payments/webhook/${c.webhookToken}`,
      lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
    };
  }

  async update(
    input: GatewayConfigInput,
    actor: { userId?: string }
  ): Promise<PublicGatewayConfig> {
    const existing = await this.ensure();
    const keySecret = input.keySecret || existing.keySecret;
    const webhookSecret = input.webhookSecret || existing.webhookSecret;
    if (input.enabled && (!input.keyId || !keySecret || !webhookSecret)) {
      throw new ApiError(
        400,
        "Turning the gateway on needs the key id, the key secret and the webhook secret"
      );
    }
    await prisma.paymentGatewayConfig.update({
      where: { id: existing.id },
      data: {
        provider: input.provider,
        enabled: input.enabled,
        keyId: input.keyId ?? null,
        bankLedgerCode: input.bankLedgerCode,
        feeLedgerCode: input.feeLedgerCode,
        expiryHours: input.expiryHours,
        ...(input.keySecret && { keySecret: encryptText(input.keySecret) }),
        ...(input.webhookSecret && { webhookSecret: encryptText(input.webhookSecret) }),
        updatedBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
    return this.get();
  }

  /** A new token; the old callback URL stops working the moment this returns. */
  async rotateWebhookToken(actor: { userId?: string }): Promise<PublicGatewayConfig> {
    const existing = await this.ensure();
    await prisma.paymentGatewayConfig.update({
      where: { id: existing.id },
      data: {
        webhookToken: randomBytes(24).toString("hex"),
        updatedBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
    return this.get();
  }

  /** Decrypted credentials for one call. Nothing else may read the secret columns. */
  async credentials(): Promise<{ provider: string; enabled: boolean; creds: GatewayCredentials }> {
    const c = await this.ensure();
    return {
      provider: c.provider,
      enabled: c.enabled,
      creds: {
        keyId: c.keyId,
        keySecret: c.keySecret ? decryptText(c.keySecret) : null,
        webhookSecret: c.webhookSecret ? decryptText(c.webhookSecret) : null,
      },
    };
  }

  async verify(): Promise<{ ok: boolean; detail: string }> {
    const { provider, creds } = await this.credentials();
    const result = await paymentProviderFor(provider).verify(creds);
    if (result.ok) {
      await prisma.paymentGatewayConfig.updateMany({
        where: { companyId: requireTenantId() },
        data: { lastVerifiedAt: new Date() },
      });
    }
    return result;
  }
}

export const paymentsConfigService = new PaymentsConfigService();
