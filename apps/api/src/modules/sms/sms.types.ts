/**
 * The SMS seam (P1-22). Everything the rest of the module knows about a gateway is here; nothing
 * outside `providers/` may reach one.
 */

export interface SmsCredentials {
  authKey: string | null;
  senderId: string | null;
  principalEntityId: string | null;
}

export interface SendRequest {
  to: string;
  body: string;
  /** Required for anything but a promotional message; the operator drops it otherwise. */
  dltTemplateId: string | null;
  category: "TRANSACTIONAL" | "SERVICE_IMPLICIT" | "SERVICE_EXPLICIT" | "PROMOTIONAL";
}

export interface SendResult {
  providerMessageId: string;
  status: "SENT" | "QUEUED";
  segments: number;
}

/** What the gateway refused, in its own words. */
export class SmsProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

export interface SmsProvider {
  readonly name: string;
  send(request: SendRequest, creds: SmsCredentials): Promise<SendResult>;
  /** Proves the credentials work without sending anything. */
  verify(creds: SmsCredentials): Promise<{ ok: boolean; detail: string }>;
}
