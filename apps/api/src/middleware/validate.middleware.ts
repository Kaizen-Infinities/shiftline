import { Request, Response, NextFunction } from "express";

type ParsedRequest = { body?: unknown; query?: unknown; params?: unknown };

/**
 * Validates body, query and params against a Zod schema and replaces them with
 * the parsed output, so unknown keys are stripped and coercions apply. Handlers
 * downstream see exactly what the schema allows and nothing else.
 */
export const validateMiddleware =
  (schema: { parse: (data: unknown) => unknown }) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body ?? {},
        query: req.query,
        params: req.params,
      }) as ParsedRequest;

      if (parsed && typeof parsed === "object") {
        if (parsed.body !== undefined) req.body = parsed.body;
        // Express 5 exposes query and params as getters; redefine them with the parsed values.
        if (parsed.query !== undefined) {
          Object.defineProperty(req, "query", { value: parsed.query, writable: true, configurable: true, enumerable: true });
        }
        if (parsed.params !== undefined) {
          Object.defineProperty(req, "params", { value: parsed.params, writable: true, configurable: true, enumerable: true });
        }
      }
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
