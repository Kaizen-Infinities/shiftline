import crypto from "node:crypto";
import type { Request, Response } from "express";

import { env, isProduction } from "../../config/env";

/**
 * Session tokens (P0-13). The access token is a 15-minute JWT kept in memory
 * by the web app. The refresh token is an opaque 256-bit secret stored only as
 * a sha256 hash on the UserSession row and carried in an httpOnly cookie; each
 * refresh rotates it and remembers the previous hash so a replayed old token
 * revokes the session (reuse detection). Native clients that identify their
 * device receive the refresh token in the response body instead of a cookie.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_COOKIE = "shiftline_rt";
/** Absolute lifetime of a session regardless of sliding refreshes. */
export const SESSION_MAX_DAYS = 30;

export const refreshTtlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
export const reuseGraceMs = () => env.REFRESH_REUSE_GRACE_MS;

export const newRefreshToken = (): string => crypto.randomBytes(32).toString("hex");
export const hashToken = (raw: string): string =>
  crypto.createHash("sha256").update(raw).digest("hex");

const sameSite = (): "lax" | "strict" | "none" =>
  env.REFRESH_COOKIE_SAMESITE ?? (isProduction ? "lax" : "none");

const cookieOptions = () => {
  const ss = sameSite();
  return {
    httpOnly: true,
    // `SameSite=None` must be Secure; browsers treat localhost as a secure context.
    secure: env.COOKIE_SECURE ?? (isProduction || ss === "none"),
    sameSite: ss,
    path: "/api/auth",
  } as const;
};

export const setRefreshCookie = (res: Response, raw: string): void => {
  res.cookie(REFRESH_COOKIE, raw, { ...cookieOptions(), maxAge: refreshTtlMs() });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
};

/** Cookie first (browsers), then body (native clients). */
export const readRefreshToken = (req: Request): string | undefined => {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (typeof fromCookie === "string" && fromCookie.length >= 32) return fromCookie;
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  if (typeof fromBody === "string" && fromBody.length >= 32) return fromBody;
  return undefined;
};

/** Native clients identify their device; they get the token in the body. */
export const wantsTokenInBody = (req: Request): boolean => Boolean(req.header("x-device-id"));
