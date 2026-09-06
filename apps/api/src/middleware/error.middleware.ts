import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

import { ApiError } from "../utils/ApiError";
import { isProduction } from "../config/env";

type ErrorBody = {
  success: false;
  message: string;
  errors: unknown[];
  /** Diagnostic detail, development only. Never sent in production. */
  detail?: string;
};

const send = (
  res: Response,
  status: number,
  message: string,
  errors: unknown[] = [],
  detail?: string
) => {
  const body: ErrorBody = { success: false, message, errors };
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
    if (err.statusCode >= 500) console.error("[API ERROR]", req.method, req.originalUrl, err);
    return send(res, err.statusCode, err.message);
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
    console.warn(
      "[Invalid request]",
      req.method,
      req.originalUrl,
      (err as Error).message.split("\n")[0]
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
        console.error("[Prisma ERROR]", known.code, req.method, req.originalUrl, known.message);
        return send(res, 500, "Internal server error", [], `${known.code}: ${known.message}`);
    }
  }

  console.error("[UNHANDLED ERROR]", req.method, req.originalUrl, err);
  return send(
    res,
    500,
    "Internal server error",
    [],
    err instanceof Error ? err.message : undefined
  );
};
