import { z } from "zod";

import { prisma } from "../../config/prisma";
import { QUEUES, isJobsStarted, sendTenantJob } from "../../lib/jobs";
import { logger } from "../../lib/logger";
import { getRequestId } from "../../lib/request-context";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { decryptText, encryptText } from "../../utils/crypto";
import {
  TemplateError,
  normaliseMobile,
  renderTemplate,
  segmentsFor,
  variablesIn,
} from "./sms.calc";
import type { SendRequest, SmsCredentials } from "./sms.types";
import { SMS_PROVIDERS, smsProviderFor } from "./providers";

/** The `SMS_SEND` job's data shape (P2-T); the job handler lives in `jobs/sms-send.job.ts`. */
export interface SmsSendJobData {
  companyId: string;
  smsMessageId: string;
}

export const smsConfigSchema = z.object({
  provider: z.enum(SMS_PROVIDERS).default("FIXTURE"),
  enabled: z.boolean().default(false),
  senderId: z
    .string()
    .regex(/^[A-Z]{6}$/, "A DLT sender id is exactly six capital letters")
    .optional()
    .nullable(),
  principalEntityId: z.string().max(30).optional().nullable(),
  authKey: z.string().max(400).optional().nullable(),
  dailyCap: z.coerce.number().int().min(1).max(100000).default(2000),
});
export type SmsConfigInput = z.infer<typeof smsConfigSchema>;

export const smsTemplateSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  category: z
    .enum(["TRANSACTIONAL", "SERVICE_IMPLICIT", "SERVICE_EXPLICIT", "PROMOTIONAL"])
    .default("TRANSACTIONAL"),
  dltTemplateId: z.string().max(30).optional().nullable(),
  body: z.string().min(1).max(1000),
  isActive: z.boolean().default(true),
});
export type SmsTemplateInput = z.infer<typeof smsTemplateSchema>;

/**
 * What every tenant needs on day one. The OTP body is the shape DLT approves — a code, a purpose
 * and nothing else; a body with a link in it does not get registered.
 */
export const DEFAULT_SMS_TEMPLATES: SmsTemplateInput[] = [
  {
    code: "OTP",
    name: "One-time password",
    category: "TRANSACTIONAL",
    // Filled in once the tenant registers the template on the DLT platform.
    dltTemplateId: null,
    body: "{{code}} is your verification code. It is valid for {{minutes}} minutes. Do not share it.",
    isActive: true,
  },
  {
    code: "PAYMENT_LINK",
    name: "Payment link",
    category: "TRANSACTIONAL",
    dltTemplateId: null,
    body: "Dear {{name}}, Rs {{amount}} is due against invoice {{invoiceNo}}. Pay at {{link}}.",
    isActive: true,
  },
  {
    code: "PAYMENT_RECEIVED",
    name: "Payment received",
    category: "TRANSACTIONAL",
    dltTemplateId: null,
    body: "Dear {{name}}, we have received Rs {{amount}} against invoice {{invoiceNo}}. Thank you.",
    isActive: true,
  },
];

export interface PublicSmsConfig {
  provider: string;
  enabled: boolean;
  senderId: string | null;
  principalEntityId: string | null;
  hasAuthKey: boolean;
  dailyCap: number;
  sentToday: number;
  lastVerifiedAt: string | null;
}

/**
 * Sending an SMS in India (P1-22).
 *
 * The service's job is to refuse everything the operator would silently drop — an unregistered
 * template, a missing variable, a number that is not a number — before a message is paid for and
 * lost. Every send is logged whatever happens to it, because "did they get the code" is the
 * question this module exists to answer.
 */
class SmsService {
  // ── Settings ───────────────────────────────────────────────────────────────
  async ensureConfig() {
    const existing = await prisma.smsConfig.findUnique({ where: { companyId: requireTenantId() } });
    return existing ?? prisma.smsConfig.create({ data: {} });
  }

  async config(): Promise<PublicSmsConfig> {
    const c = await this.ensureConfig();
    return {
      provider: c.provider,
      enabled: c.enabled,
      senderId: c.senderId,
      principalEntityId: c.principalEntityId,
      hasAuthKey: Boolean(c.authKey),
      dailyCap: c.dailyCap,
      sentToday: await this.sentToday(),
      lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
    };
  }

  async updateConfig(input: SmsConfigInput, actor: { userId?: string }): Promise<PublicSmsConfig> {
    const existing = await this.ensureConfig();
    const authKey = input.authKey || existing.authKey;
    if (input.enabled && (!authKey || !input.senderId)) {
      throw new ApiError(400, "Turning SMS on needs the auth key and the registered sender id");
    }
    await prisma.smsConfig.update({
      where: { id: existing.id },
      data: {
        provider: input.provider,
        enabled: input.enabled,
        senderId: input.senderId ?? null,
        principalEntityId: input.principalEntityId ?? null,
        dailyCap: input.dailyCap,
        ...(input.authKey && { authKey: encryptText(input.authKey) }),
        updatedBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
    return this.config();
  }

  async verifyConfig(): Promise<{ ok: boolean; detail: string }> {
    const { provider, creds } = await this.credentials();
    const result = await smsProviderFor(provider).verify(creds);
    if (result.ok) {
      await prisma.smsConfig.updateMany({
        where: { companyId: requireTenantId() },
        data: { lastVerifiedAt: new Date() },
      });
    }
    return result;
  }

  async credentials(): Promise<{ provider: string; enabled: boolean; creds: SmsCredentials }> {
    const c = await this.ensureConfig();
    return {
      provider: c.provider,
      enabled: c.enabled,
      creds: {
        authKey: c.authKey ? decryptText(c.authKey) : null,
        senderId: c.senderId,
        principalEntityId: c.principalEntityId,
      },
    };
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  async templates(includeInactive = false) {
    await this.ensureDefaultTemplates();
    return prisma.smsTemplate.findMany({
      where: { ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { code: "asc" },
    });
  }

  /**
   * The default templates, once. They arrive without a DLT id — that is the tenant's to fill in
   * after registering them — so nothing can be sent against one until somebody has.
   */
  private async ensureDefaultTemplates() {
    if ((await prisma.smsTemplate.count()) > 0) return;
    await prisma.smsTemplate.createMany({
      data: DEFAULT_SMS_TEMPLATES.map((t) => ({
        companyId: requireTenantId(),
        code: t.code,
        name: t.name,
        category: t.category,
        dltTemplateId: t.dltTemplateId ?? null,
        body: t.body,
        variables: variablesIn(t.body),
        isActive: t.isActive,
      })),
      skipDuplicates: true,
    });
  }

  async saveTemplate(input: SmsTemplateInput, actor: { userId?: string }) {
    if (input.category !== "PROMOTIONAL" && !input.dltTemplateId) {
      throw new ApiError(
        400,
        "A transactional or service template needs its DLT template id",
        "NO_DLT_TEMPLATE"
      );
    }
    const variables = variablesIn(input.body);
    const existing = await prisma.smsTemplate.findFirst({ where: { code: input.code } });
    const data = {
      code: input.code,
      name: input.name,
      category: input.category,
      dltTemplateId: input.dltTemplateId ?? null,
      body: input.body,
      variables,
      isActive: input.isActive,
      updatedBy: actor.userId?.slice(0, 36) ?? null,
    };
    return existing
      ? prisma.smsTemplate.update({ where: { id: existing.id }, data })
      : prisma.smsTemplate.create({
          data: { ...data, createdBy: actor.userId?.slice(0, 36) ?? null },
        });
  }

  /** What a body will cost before anybody commits to it. */
  preview(body: string, values: Record<string, string | number>) {
    const rendered = renderTemplate(body, values);
    return { body: rendered, ...segmentsFor(rendered) };
  }

  // ── Sending ────────────────────────────────────────────────────────────────
  /**
   * Send against a stored template. Everything that can be refused is refused before the
   * provider is called; what the provider then refuses is written to the message row, because a
   * failure nobody can see is the failure mode of this whole channel.
   */
  async sendTemplate(input: {
    to: string;
    templateCode: string;
    values?: Record<string, string | number>;
    purpose?: string;
    /** An already-rendered body, used by the OTP path so the code never reaches a caller. */
    bodyOverride?: string;
    /** What is written to the log in place of the body. */
    logBody?: string;
  }) {
    const mobile = normaliseMobile(input.to);
    if (!mobile) throw new ApiError(400, "That is not an Indian mobile number", "BAD_MOBILE");

    const { provider, enabled, creds } = await this.credentials();
    if (!enabled) throw new ApiError(409, "SMS is off; turn it on in settings first", "SMS_OFF");

    await this.ensureDefaultTemplates();
    const template = await prisma.smsTemplate.findFirst({
      where: { code: input.templateCode, isActive: true },
    });
    if (!template) throw new ApiError(404, "No such SMS template", "NO_TEMPLATE");

    const config = await this.ensureConfig();
    if ((await this.sentToday()) >= config.dailyCap) {
      throw new ApiError(429, "The day's SMS cap has been reached", "DAILY_CAP");
    }

    let body: string;
    try {
      body = input.bodyOverride ?? renderTemplate(template.body, input.values ?? {});
    } catch (error) {
      if (error instanceof TemplateError) throw new ApiError(400, error.message, error.code);
      throw error;
    }

    const { segments } = segmentsFor(body);
    const row = await prisma.smsMessage.create({
      data: {
        toMobile: mobile,
        templateCode: template.code,
        dltTemplateId: template.dltTemplateId,
        body: (input.logBody ?? body).slice(0, 1000),
        segments,
        status: "QUEUED",
        purpose: input.purpose?.slice(0, 30) ?? null,
        requestId: getRequestId()?.slice(0, 64) ?? null,
      },
    });

    // A caller that supplies its own logBody (the OTP path) is asking for a different body to be
    // sent than what was persisted — a one-time secret that must never sit in a queue row for a
    // worker to read back later. That send can only happen here, inline, while the real body is
    // still in memory. Everything else goes through the send queue so a slow gateway never blocks
    // a request; the worker reads the row back, and for those the row already holds the real body.
    if (input.logBody === undefined && isJobsStarted()) {
      const companyId = requireTenantId();
      await sendTenantJob<SmsSendJobData>(
        QUEUES.SMS_SEND,
        { companyId, smsMessageId: row.id },
        {
          singletonKey: `${companyId}:${row.id}`,
          retryLimit: 2,
          retryDelay: 15,
          retryBackoff: true,
        }
      );
      return row;
    }
    return this.deliver(row.id, {
      provider,
      creds,
      body,
      dltTemplateId: template.dltTemplateId,
      category: template.category,
      templateCode: template.code,
      mobile,
    });
  }

  /**
   * Sends a previously-queued message and records the outcome. Called inline by `sendTemplate`
   * when there is no queue to defer to (or the body carries a secret that must not be queued),
   * and by the `SMS_SEND` job handler for everything else.
   */
  private async deliver(
    messageId: string,
    ctx: {
      provider: string;
      creds: SmsCredentials;
      body: string;
      dltTemplateId: string | null;
      category: SendRequest["category"];
      templateCode: string | null;
      mobile: string;
    }
  ) {
    try {
      const result = await smsProviderFor(ctx.provider).send(
        {
          to: ctx.mobile,
          body: ctx.body,
          dltTemplateId: ctx.dltTemplateId,
          category: ctx.category,
        },
        ctx.creds
      );
      logger.info({ templateCode: ctx.templateCode }, "sms sent");
      return await prisma.smsMessage.update({
        where: { id: messageId },
        data: {
          status: result.status === "SENT" ? "SENT" : "QUEUED",
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The gateway refused the message";
      await prisma.smsMessage.update({
        where: { id: messageId },
        data: { status: "FAILED", error: detail.slice(0, 255) },
      });
      logger.warn({ templateCode: ctx.templateCode }, "sms refused by the gateway");
      throw new ApiError(502, "The SMS gateway refused the message", "SMS_REFUSED");
    }
  }

  /**
   * The `SMS_SEND` job's body (P2-T): looks up the queued row and its template, then delivers.
   * Idempotent — a message that already left `QUEUED` (a retried job racing a first success) is
   * left alone.
   */
  async sendQueuedMessage(messageId: string) {
    const row = await prisma.smsMessage.findUnique({ where: { id: messageId } });
    if (!row) return { skipped: "missing" as const };
    if (row.status !== "QUEUED") return { skipped: row.status };
    const { provider, creds } = await this.credentials();
    const template = row.templateCode
      ? await prisma.smsTemplate.findFirst({ where: { code: row.templateCode } })
      : null;
    return this.deliver(row.id, {
      provider,
      creds,
      body: row.body,
      dltTemplateId: row.dltTemplateId,
      category: template?.category ?? "TRANSACTIONAL",
      templateCode: row.templateCode,
      mobile: row.toMobile,
    });
  }

  async messages(query: { to?: string; status?: string; take?: number }) {
    const mobile = query.to ? normaliseMobile(query.to) : null;
    return prisma.smsMessage.findMany({
      where: {
        ...(mobile && { toMobile: mobile }),
        ...(query.status && { status: query.status as never }),
      },
      orderBy: { queuedAt: "desc" },
      take: Math.min(query.take ?? 100, 500),
    });
  }

  private async sentToday(): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return prisma.smsMessage.count({
      where: { queuedAt: { gte: start }, status: { in: ["SENT", "QUEUED", "DELIVERED"] } },
    });
  }
}

export const smsService = new SmsService();
