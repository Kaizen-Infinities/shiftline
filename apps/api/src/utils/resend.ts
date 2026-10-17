import { env, isProduction } from "../config/env";
import { logger } from "../lib/logger";

export interface ResendEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends one email through Resend (https://resend.com). Returns false without a network call when
 * RESEND_API_KEY or RESEND_FROM is unset. Never throws: failures are logged and reported as false.
 */
export const sendResendEmail = async (email: ResendEmail): Promise<boolean> => {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    // Production without Resend means reset links never arrive: say so loudly.
    if (isProduction) logger.warn("RESEND_API_KEY or RESEND_FROM is unset; email not sent");
    else logger.info("Resend email is disabled; sending skipped");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "Resend rejected the email");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Resend request failed");
    return false;
  }
};
