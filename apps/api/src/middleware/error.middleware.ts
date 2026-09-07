import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

import { ApiError } from "../utils/ApiError";
import { isProduction } from "../config/env";
import { logger } from "../lib/logger";
import { getRequestId } from "../lib/request-context";
import { captureError } from "../lib/sentry";

type ErrorBody = {
  success: false;
  message: string;
  errors: unknown[];
  /** Machine-readable reason (FEATURE_NOT_IN_PLAN, SEAT_LIMIT_REACHED, ...). */
  code?: string;
  details?: Record<string, unknown>;
  /** Correlates the response with server logs and audit rows. */
  requestId?: string;
  /** Diagnostic detail, development only. Never sent in production. */
  detail?: string;
};

const send = (
  res: Response,
  status: number,
  message: string,
  errors: unknown[] = [],
  detail?: string,
  extra?: { code?: string; details?: Record<string, unknown> }
) => {
  const body: ErrorBody = { success: false, message, errors };
  if (extra?.code) body.code = extra.code;
  if (extra?.details) body.details = extra.details;
  const requestId = getRequestId();
  if (requestId) body.requestId = requestId;
  if (!isProduction && detail) body.detail = detail;
  res.status(status).json(body);
};

/**
 * Global error handler. Clients get a fixed, safe message; the full error is
 * logged server-side. Diagnostic detail is attached only outside production.
 */
export const errorMiddleware = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const bodyParser = err as { type?: string; status?: number };

  if (bodyParser?.type === "entity.too.large") {
    return send(res, 413, "Request body is too large.");
  }
  if (bodyParser?.type === "entity.parse.failed") {
    return send(res, 400, "Request body is not valid JSON.");
  }

  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error({ err, method: req.method, url: req.originalUrl }, "API error");
      captureError(err, { method: req.method, url: req.originalUrl });
    }
    return send(res, err.statusCode, err.message, [], undefined, {
      code: err.code,
      details: err.details,
    });
  }

  if (err instanceof ZodError) {
    const errors = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return send(res, 400, "Validation failed", errors);
  }

  // Bad ids, out-of-range numbers, malformed input that reached Prisma or BigInt().
  const errName = (err as { name?: string })?.name;
  if (
    err instanceof Prisma.PrismaClientValidationError ||
    errName === "PrismaClientValidationError" ||
    err instanceof RangeError ||
    err instanceof SyntaxError ||
    // Values that pass the client but the database rejects (e.g. BigInt out of range).
    (errName === "PrismaClientUnknownRequestError" &&
      /out of range|Could not convert|invalid input syntax/i.test((err as Error).message))
  ) {
    logger.warn(
      { method: req.method, url: req.originalUrl, reason: (err as Error).message.split("\n")[0] },
      "Invalid request"
    );
    return send(res, 400, "Invalid request data.", [], (err as Error).message);
  }

  if (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    errName === "PrismaClientKnownRequestError"
  ) {
    const known = err as Prisma.PrismaClientKnownRequestError;
    switch (known.code) {
      case "P2002":
        return send(res, 409, "A record with this value already exists.");
      case "P2003":
        return send(res, 409, "This record is referenced by other records and cannot be changed.");
      case "P2025":
        return send(res, 404, "Record not found.");
      default:
        logger.error(
          { code: known.code, method: req.method, url: req.originalUrl, detail: known.message },
          "Prisma error"
        );
        return send(res, 500, "Internal server error", [], `${known.code}: ${known.message}`);
    }
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, "Unhandled error");
  captureError(err, { method: req.method, url: req.originalUrl });
  return send(
    res,
    500,
    "Internal server error",
    [],
    err instanceof Error ? err.message : undefined
  );
};
