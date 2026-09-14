import { randomUUID } from "node:crypto";

import { logger } from "../../lib/logger";
import { sendEmail } from "../../utils/mailer";
import { WhatsappService } from "../whatsappservice/whatsapp.service";

/**
 * The channel a supplier follow-up (P2-10) goes out on, behind an interface — the same shape as
 * every other outbound integration in this codebase (`sms/providers`, `gst-returns/providers`).
 *
 * There is no live GSP/WhatsApp/SMTP account to test against in CI, so the fixture provider is
 * the default and simply records what it was asked to send; the live provider wraps the
 * WhatsApp and email services that already exist and is used everywhere that is not a test.
 */
export interface FollowUpSendResult {
  reference: string;
}

export interface FollowUpProvider {
  readonly name: string;
  sendWhatsapp(to: string, body: string): Promise<FollowUpSendResult>;
  sendEmail(to: string, subject: string, body: string): Promise<FollowUpSendResult>;
}

export class FixtureFollowUpProvider implements FollowUpProvider {
  readonly name = "FIXTURE";
  readonly sent: { channel: "WHATSAPP" | "EMAIL"; to: string; subject?: string; body: string }[] =
    [];

  async sendWhatsapp(to: string, body: string): Promise<FollowUpSendResult> {
    this.sent.push({ channel: "WHATSAPP", to, body });
    return { reference: `fixture_wa_${randomUUID().replace(/-/g, "").slice(0, 16)}` };
  }

  async sendEmail(to: string, subject: string, body: string): Promise<FollowUpSendResult> {
    this.sent.push({ channel: "EMAIL", to, subject, body });
    return { reference: `fixture_em_${randomUUID().replace(/-/g, "").slice(0, 16)}` };
  }

  /** The suites that share a process do not share an outbox. */
  reset(): void {
    this.sent.length = 0;
  }
}
export const fixtureFollowUpProvider = new FixtureFollowUpProvider();

class LiveFollowUpProvider implements FollowUpProvider {
  readonly name = "LIVE";

  async sendWhatsapp(to: string, body: string): Promise<FollowUpSendResult> {
    const result = await WhatsappService.sendTextMessage(to, body);
    const id = result?.messages?.[0]?.id;
    logger.info({ to }, "supplier follow-up sent over WhatsApp");
    return { reference: typeof id === "string" ? id : `wa_${Date.now()}` };
  }

  async sendEmail(to: string, subject: string, body: string): Promise<FollowUpSendResult> {
    const info = await sendEmail({ to, subject, text: body });
    logger.info({ to }, "supplier follow-up sent by email");
    return { reference: typeof info?.messageId === "string" ? info.messageId : `em_${Date.now()}` };
  }
}
export const liveFollowUpProvider = new LiveFollowUpProvider();

/** Fixture in tests, so a suite never reaches a real gateway; live everywhere else. */
export const followUpProvider = (): FollowUpProvider =>
  process.env.NODE_ENV === "test" ? fixtureFollowUpProvider : liveFollowUpProvider;
