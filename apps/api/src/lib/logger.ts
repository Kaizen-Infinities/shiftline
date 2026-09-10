import pino, { type Logger } from "pino";

import { env, isProduction, isTest } from "../config/env";
import { getRequestContext } from "./request-context";
import { getTenant } from "./tenant-context";

/**
 * One structured logger for the API and the worker. Every line carries the
 * request id, tenant and user from the async context, so a support ticket's
 * request id finds every log line and audit row it produced. Pretty output in
 * development, JSON elsewhere, quiet in tests unless LOG_LEVEL says otherwise.
 *
 * Usage: `logger.info({ orderId }, "order confirmed")`,
 *        `logger.error({ err }, "voucher posting failed")`.
 * Never log secrets; the redaction list below is a backstop, not a licence.
 */
const level = env.LOG_LEVEL ?? (isTest ? "silent" : isProduction ? "info" : "debug");

export const logger: Logger = pino({
  level,
  base: { service: env.SERVICE_NAME },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
      "*.password",
      "*.passwordHash",
      "*.newPassword",
      "*.oldPassword",
      "*.accessToken",
      "*.refreshToken",
      "*.token",
      "*.apiKey",
      "*.secret",
    ],
    censor: "[redacted]",
  },
  mixin() {
    const req = getRequestContext();
    const tenant = getTenant();
    return {
      ...(req?.requestId ? { requestId: req.requestId } : {}),
      ...(tenant?.companyId ? { companyId: tenant.companyId } : {}),
      ...(tenant?.userId && tenant.userId !== "system" ? { userId: tenant.userId } : {}),
    };
  },
  ...(isProduction || isTest || env.LOG_FORMAT === "json"
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" },
        },
      }),
});

/** Child logger with a fixed module tag, e.g. `log("voucherPosting")`. */
export const log = (module: string): Logger => logger.child({ module });
