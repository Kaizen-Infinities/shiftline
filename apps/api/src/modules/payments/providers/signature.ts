import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 over the raw request body, hex-encoded — the scheme every Indian gateway uses and
 * the reason `req.rawBody` is kept in `app.ts`. Compared in constant time, because a comparison
 * that returns early tells an attacker how much of a forged signature was right.
 */
export const signBody = (rawBody: string, secret: string): string =>
  createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

export const signatureMatches = (
  rawBody: string,
  signature: string | null,
  secret: string | null
): boolean => {
  if (!signature || !secret) return false;
  const expected = Buffer.from(signBody(rawBody, secret), "utf8");
  const given = Buffer.from(signature.trim(), "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself a mismatch.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
};
