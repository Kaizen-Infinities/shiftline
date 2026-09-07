import * as Sentry from "@sentry/node";

import { env } from "../config/env";
import { logger } from "./logger";
import { getRequestId } from "./request-context";
import { getTenant } from "./tenant-context";

let enabled = false;

/**
 * Optional error reporting. Nothing is sent unless SENTRY_DSN is set; with it,
 * 5xx errors from the API and failed jobs from the worker are captured with the
 * request id and tenant so they can be matched to logs and audit rows. Request
 * bodies and headers are never attached.
 */
export const initSentry = (service: string): boolean => {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: process.env.GIT_SHA,
    serverName: service,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  enabled = true;
  logger.info({ environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV }, "Sentry enabled");
  return true;
};

export const sentryEnabled = () => enabled;

export const captureError = (err: unknown, extra: Record<string, unknown> = {}): void => {
  if (!enabled) return;
  const tenant = getTenant();
  Sentry.withScope((scope) => {
    const requestId = getRequestId();
    if (requestId) scope.setTag("requestId", requestId);
    if (tenant?.companyId) scope.setTag("companyId", tenant.companyId);
    if (tenant?.userId && tenant.userId !== "system") scope.setUser({ id: tenant.userId });
    scope.setExtras(extra);
    Sentry.captureException(err);
  });
};

export const flushSentry = async (timeoutMs = 2000): Promise<void> => {
  if (!enabled) return;
  await Sentry.flush(timeoutMs);
};
