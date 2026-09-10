import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Per-request context: the request id travels through logs, audit rows and
 * error responses so one field ties a user report to the server side.
 * Incoming `x-request-id` values are honoured when they look sane (proxies,
 * the mobile app's retry loop); otherwise a uuid is minted.
 */
export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
  startedAt: number;
}

export const requestStorage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = () => requestStorage.getStore();
export const getRequestId = (): string | undefined => requestStorage.getStore()?.requestId;

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header("x-request-id");
  const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", requestId);
  requestStorage.run(
    { requestId, method: req.method, path: req.originalUrl, startedAt: Date.now() },
    () => next()
  );
};

/** Runs `fn` with a synthetic request id (jobs, scripts) so their logs correlate too. */
export const withRequestContext = <T>(label: string, fn: () => Promise<T>): Promise<T> =>
  requestStorage.run(
    { requestId: `${label}:${randomUUID().slice(0, 8)}`, startedAt: Date.now() },
    async () => await fn()
  );
