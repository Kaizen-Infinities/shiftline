import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { AccessTokenPayload } from "../types/auth.types";
import { ACCESS_TOKEN_TTL } from "../modules/auth/refresh-token";

/**
 * Generates the JWT access token for API requests. Short-lived (15 minutes);
 * the refresh cookie (modules/auth/refresh-token.ts) renews it.
 */
export const generateAccessToken = (
  payload: AccessTokenPayload,
  opts: { expiresIn?: string } = {}
): string => {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: (opts.expiresIn ?? ACCESS_TOKEN_TTL) as jwt.SignOptions["expiresIn"],
    // Unique per issue, so two tokens minted in the same second still differ.
    jwtid: randomUUID(),
  });
};
