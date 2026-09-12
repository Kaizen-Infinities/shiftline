import { randomInt } from "node:crypto";

import type { OtpPurpose } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { ApiError } from "../../utils/ApiError";
import { comparePassword, hashPassword } from "../../utils/hashPassword";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_WINDOW,
  OTP_TTL_MINUTES,
  OTP_WINDOW_MINUTES,
  maskCode,
  normaliseMobile,
} from "./sms.calc";
import { smsService } from "./sms.service";

/** The template a tenant must have for codes to go out at all. */
export const OTP_TEMPLATE_CODE = "OTP";

/**
 * One-time passwords (P1-22).
 *
 * Four things make this safe and each is here because leaving it out is a known way to lose an
 * account: the code is stored only as a hash, it expires, it counts its attempts, and a number
 * can only ask for so many inside a window. The code is never returned by any endpoint and never
 * written to the message log in the clear.
 */
class OtpService {
  /** Ask for a code. Returns the challenge to quote back, never the code. */
  async request(input: {
    purpose: OtpPurpose;
    mobile: string;
    requestedBy?: string;
  }): Promise<{ challengeId: string; expiresAt: Date; mobile: string }> {
    const mobile = normaliseMobile(input.mobile);
    if (!mobile) throw new ApiError(400, "That is not an Indian mobile number", "BAD_MOBILE");

    const windowStart = new Date(Date.now() - OTP_WINDOW_MINUTES * 60000);
    const recent = await prisma.otpChallenge.count({
      where: { mobile, purpose: input.purpose, createdAt: { gte: windowStart } },
    });
    if (recent >= OTP_MAX_PER_WINDOW) {
      throw new ApiError(
        429,
        `Too many codes asked for; wait ${OTP_WINDOW_MINUTES} minutes`,
        "TOO_MANY_REQUESTS"
      );
    }

    // Any code still live for this number and purpose is spent: one live code at a time.
    await prisma.otpChallenge.updateMany({
      where: { mobile, purpose: input.purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60000);
    const challenge = await prisma.otpChallenge.create({
      data: {
        purpose: input.purpose,
        mobile,
        codeHash: await hashPassword(code),
        expiresAt,
        maxAttempts: OTP_MAX_ATTEMPTS,
        requestedBy: input.requestedBy?.slice(0, 36) ?? null,
      },
    });

    const message = await smsService.sendTemplate({
      to: mobile,
      templateCode: OTP_TEMPLATE_CODE,
      values: { code, minutes: OTP_TTL_MINUTES },
      purpose: input.purpose,
      // The log keeps the message that was sent, with the code masked out of it.
      logBody: `OTP ${maskCode(code)} (${input.purpose})`,
    });
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { smsMessageId: message.id },
    });

    logger.info({ purpose: input.purpose }, "otp issued");
    return { challengeId: challenge.id, expiresAt, mobile };
  }

  /**
   * Check a code. Every refusal counts an attempt except the ones that cannot be brute-forced —
   * an expired or already-used challenge — because counting those would let somebody burn a
   * challenge's attempts without ever guessing.
   */
  async verify(
    challengeId: string,
    code: string
  ): Promise<{ mobile: string; purpose: OtpPurpose }> {
    const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) throw new ApiError(404, "No such code request", "NO_CHALLENGE");
    if (challenge.consumedAt) {
      throw new ApiError(409, "That code has already been used", "CONSUMED");
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new ApiError(410, "That code has expired; ask for another", "EXPIRED");
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      throw new ApiError(429, "Too many wrong attempts; ask for another code", "TOO_MANY_ATTEMPTS");
    }

    const ok = await comparePassword(code, challenge.codeHash);
    if (!ok) {
      const after = await prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { attempts: { increment: 1 } },
      });
      // The last attempt spends the challenge: the next request must be a new code.
      if (after.attempts >= after.maxAttempts) {
        await prisma.otpChallenge.update({
          where: { id: challengeId },
          data: { consumedAt: new Date() },
        });
      }
      throw new ApiError(401, "That code is wrong", "BAD_CODE");
    }

    await prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    });
    return { mobile: challenge.mobile, purpose: challenge.purpose };
  }
}

export const otpService = new OtpService();
