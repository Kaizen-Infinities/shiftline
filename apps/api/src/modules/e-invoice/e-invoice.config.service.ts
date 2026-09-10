import { z } from "zod";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { decryptText, encryptText } from "../../utils/crypto";
import type { ProviderCredentials } from "./e-invoice.types";
import { PROVIDERS, providerFor } from "./providers";

/**
 * Per-tenant e-invoice settings. Secrets are encrypted at rest and never returned; the client
 * sees whether one is set. A blank secret in an update keeps the stored one.
 */
export const configSchema = z.object({
  provider: z.enum(PROVIDERS).default("FIXTURE"),
  enabled: z.boolean().default(false),
  applicableFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  aatoCrore: z.coerce.number().min(0).max(100000).optional().nullable(),
  baseUrl: z.string().url().max(200).optional().nullable(),
  clientId: z.string().max(200).optional().nullable(),
  clientSecret: z.string().max(400).optional().nullable(),
  username: z.string().max(200).optional().nullable(),
  password: z.string().max(400).optional().nullable(),
});
export type ConfigInput = z.infer<typeof configSchema>;

const mask = (v: string | null) => (v ? true : false);

export interface PublicConfig {
  provider: string;
  enabled: boolean;
  applicableFrom: string | null;
  aatoCrore: number | null;
  baseUrl: string | null;
  clientId: string | null;
  username: string | null;
  hasClientSecret: boolean;
  hasPassword: boolean;
  lastVerifiedAt: string | null;
  /** Whether the ≥ ₹10 crore 30-day IRN window applies. */
  thirtyDayWindow: boolean;
}

export const THIRTY_DAY_WINDOW_CRORE = 10;

class EInvoiceConfigService {
  async row() {
    return prisma.eInvoiceConfig.findUnique({ where: { companyId: requireTenantId() } });
  }

  async get(): Promise<PublicConfig> {
    const c = await this.row();
    return {
      provider: c?.provider ?? "FIXTURE",
      enabled: c?.enabled ?? false,
      applicableFrom: c?.applicableFrom ? c.applicableFrom.toISOString().slice(0, 10) : null,
      aatoCrore: c?.aatoCrore ? Number(c.aatoCrore) : null,
      baseUrl: c?.baseUrl ?? null,
      clientId: c?.clientId ?? null,
      username: c?.username ?? null,
      hasClientSecret: mask(c?.clientSecret ?? null),
      hasPassword: mask(c?.password ?? null),
      lastVerifiedAt: c?.lastVerifiedAt?.toISOString() ?? null,
      thirtyDayWindow: Number(c?.aatoCrore ?? 0) >= THIRTY_DAY_WINDOW_CRORE,
    };
  }

  async update(input: ConfigInput, actor: { userId?: string }): Promise<PublicConfig> {
    const existing = await this.row();
    if (input.provider === "GSP" && input.enabled) {
      const clientSecret = input.clientSecret || existing?.clientSecret;
      const password = input.password || existing?.password;
      if (!input.baseUrl || !input.clientId || !clientSecret || !input.username || !password) {
        throw new ApiError(
          400,
          "Enabling the GSP provider needs the base URL, client id, client secret, API user and password"
        );
      }
    }
    const data = {
      provider: input.provider,
      enabled: input.enabled,
      applicableFrom: input.applicableFrom ? new Date(`${input.applicableFrom}T00:00:00Z`) : null,
      aatoCrore: input.aatoCrore ?? null,
      baseUrl: input.baseUrl ?? null,
      clientId: input.clientId ?? null,
      username: input.username ?? null,
      ...(input.clientSecret && { clientSecret: encryptText(input.clientSecret) }),
      ...(input.password && { password: encryptText(input.password) }),
      updatedBy: actor.userId?.slice(0, 36) ?? null,
    };
    if (existing) {
      await prisma.eInvoiceConfig.update({ where: { id: existing.id }, data });
    } else {
      await prisma.eInvoiceConfig.create({ data });
    }
    return this.get();
  }

  /** Decrypted credentials for a call, for the given seller GSTIN. */
  async credentials(gstin: string): Promise<{
    provider: string;
    creds: ProviderCredentials;
    enabled: boolean;
    applicableFrom: Date | null;
    aatoCrore: number;
  }> {
    const c = await this.row();
    return {
      provider: c?.provider ?? "FIXTURE",
      enabled: c?.enabled ?? false,
      applicableFrom: c?.applicableFrom ?? null,
      aatoCrore: Number(c?.aatoCrore ?? 0),
      creds: {
        baseUrl: c?.baseUrl ?? null,
        clientId: c?.clientId ?? null,
        clientSecret: c?.clientSecret ? decryptText(c.clientSecret) : null,
        username: c?.username ?? null,
        password: c?.password ? decryptText(c.password) : null,
        gstin,
      },
    };
  }

  async verify(): Promise<{ ok: boolean; detail: string }> {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: requireTenantId() } });
    if (!company.gstin) return { ok: false, detail: "The company has no GSTIN" };
    const { provider, creds } = await this.credentials(company.gstin);
    const result = await providerFor(provider).verify(creds);
    if (result.ok) {
      await prisma.eInvoiceConfig.updateMany({
        where: { companyId: requireTenantId() },
        data: { lastVerifiedAt: new Date() },
      });
    }
    return result;
  }
}

export const eInvoiceConfigService = new EInvoiceConfigService();
