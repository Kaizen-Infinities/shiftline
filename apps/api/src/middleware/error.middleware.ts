import { NextFunction, Request, Response } from "express";
import { redactUrl } from "../lib/redact-url";
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

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * The model field a failed foreign key belongs to. Prisma reports the database constraint name
 * (`<table>_<column>[_<column>]_fkey`, sometimes with " (index)"; the driver-adapter path nests
 * it). The field is the model scalar whose column ends that name, longest match first, so a
 * composite key (companyId, x) resolves to x. Undefined when no field matches.
 */
const foreignKeyField = (meta: unknown): string | undefined => {
  const m = (meta ?? {}) as {
    modelName?: string;
    field_name?: string;
    driverAdapterError?: { cause?: { constraint?: { index?: string } } };
  };
  const constraint = (m.field_name ?? m.driverAdapterError?.cause?.constraint?.index ?? "").replace(
    /\s*\(index\)$/,
    ""
  );
  const model = Prisma.dmmf.datamodel.models.find((x) => x.name === m.modelName);
  if (!constraint || !model) return undefined;

  let best: { field: string; length: number } | undefined;
  for (const f of model.fields) {
    if (f.kind !== "scalar") continue;
    for (const column of new Set([f.dbName ?? f.name, f.name])) {
      if (!constraint.endsWith(`_${column}_fkey`)) continue;
      if (!best || column.length > best.length) best = { field: f.name, length: column.length };
    }
  }
  return best?.field;
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
      logger.error({ err, method: req.method, url: redactUrl(req.originalUrl) }, "API error");
      captureError(err, { method: req.method, url: redactUrl(req.originalUrl) });
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
      {
        method: req.method,
        url: redactUrl(req.originalUrl),
        reason: (err as Error).message.split("\n")[0],
      },
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
      case "P2003": {
        // A write that names a reference which does not exist is a client error, and the field says which.
        // Deletes keep the 409: there the record itself is what is referenced.
        if (WRITE_METHODS.has(req.method)) {
          const field = foreignKeyField(known.meta);
          if (field) {
            const message = `Invalid ${field}: no matching record exists.`;
            return send(res, 400, message, [{ path: field, message }]);
          }
          return send(res, 400, "A referenced record does not exist.");
        }
        return send(res, 409, "This record is referenced by other records and cannot be changed.");
      }
      case "P2000":
        return send(res, 400, "A value is too long for its field.");
      case "P2020":
        return send(res, 400, "A number is outside the allowed range.");
      case "P2025":
        return send(res, 404, "Record not found.");
      default:
        logger.error(
          {
            code: known.code,
            method: req.method,
            url: redactUrl(req.originalUrl),
            detail: known.message,
          },
          "Prisma error"
        );
        return send(res, 500, "Internal server error", [], `${known.code}: ${known.message}`);
    }
  }

  logger.error({ err, method: req.method, url: redactUrl(req.originalUrl) }, "Unhandled error");
  captureError(err, { method: req.method, url: redactUrl(req.originalUrl) });
  return send(
    res,
    500,
    "Internal server error",
    [],
    err instanceof Error ? err.message : undefined
  );
};
