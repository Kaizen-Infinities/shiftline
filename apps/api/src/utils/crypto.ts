import crypto from "crypto";
import { env, isProduction } from "../config/env";

/**
 * AES-256-GCM helpers for credentials stored in the database (WhatsApp access
 * tokens, SMTP passwords, GSP secrets). Keyed by DATA_ENCRYPTION_KEY, which is
 * independent of the JWT signing secret so either can be rotated alone.
 */
const getKey = (): Buffer => {
  const secret = env.DATA_ENCRYPTION_KEY ?? (isProduction ? undefined : env.JWT_ACCESS_SECRET);
  if (!secret) throw new Error("DATA_ENCRYPTION_KEY is not configured");
  return crypto.createHash("sha256").update(secret).digest();
};

const PREFIX = "enc:v1:";

export const encryptText = (text: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
};

export const isEncrypted = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.startsWith(PREFIX);

export const decryptText = (payload: string): string => {
  if (!isEncrypted(payload)) return payload; // legacy plaintext, re-encrypted on next save
  const [ivHex, tagHex, dataHex] = payload.slice(PREFIX.length).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
};
