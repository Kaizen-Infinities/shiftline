import { randomUUID } from "node:crypto";

import {
  SmsProviderError,
  type SendRequest,
  type SendResult,
  type SmsCredentials,
  type SmsProvider,
} from "../sms.types";
import { segmentsFor } from "../sms.calc";

/**
 * A gateway without a gateway.
 *
 * It refuses what a real one refuses, which is the only part worth simulating: a transactional
 * message with no DLT template id, a send with no sender id, and a promotional message to a
 * number on the DND registry. Everything it accepts, it records, so a test can read back what
 * was sent.
 */
export class FixtureSmsProvider implements SmsProvider {
  readonly name = "FIXTURE";
  /** Numbers that behave as if they were registered on the do-not-disturb list. */
  private readonly dnd = new Set<string>(["9000000001"]);
  readonly sent: { to: string; body: string; dltTemplateId: string | null }[] = [];

  async send(request: SendRequest, creds: SmsCredentials): Promise<SendResult> {
    if (!creds.authKey) throw new SmsProviderError("NO_KEY", "The SMS account has no auth key");
    if (!creds.senderId) {
      throw new SmsProviderError("NO_SENDER", "No registered sender id to send from");
    }
    if (request.category !== "PROMOTIONAL" && !request.dltTemplateId) {
      throw new SmsProviderError(
        "NO_DLT_TEMPLATE",
        "A transactional message needs its DLT template id or the operator will drop it"
      );
    }
    if (request.category === "PROMOTIONAL" && this.dnd.has(request.to)) {
      throw new SmsProviderError("DND", "That number is on the do-not-disturb registry");
    }
    this.sent.push({ to: request.to, body: request.body, dltTemplateId: request.dltTemplateId });
    return {
      providerMessageId: `sms_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      status: "SENT",
      segments: segmentsFor(request.body).segments,
    };
  }

  async verify(creds: SmsCredentials): Promise<{ ok: boolean; detail: string }> {
    if (!creds.authKey) return { ok: false, detail: "The fixture gateway still wants an auth key" };
    if (!creds.senderId) return { ok: false, detail: "No sender id is registered" };
    return { ok: true, detail: `Fixture gateway reachable as ${creds.senderId}` };
  }

  /** The suites that share a process do not share an outbox. */
  reset(): void {
    this.sent.length = 0;
  }
}

export const fixtureSmsProvider = new FixtureSmsProvider();
