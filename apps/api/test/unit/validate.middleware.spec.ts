import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateMiddleware } from "../../src/middleware/validate.middleware";

describe("validateMiddleware", () => {
  const schema = z.object({
    body: z.object({ name: z.string() }),
    query: z.object({ page: z.coerce.number().default(1) }),
    params: z.object({}),
  });

  it("replaces body and query with parsed output, stripping unknown keys", () => {
    const req: any = {
      body: { name: "A", companyId: "attacker-supplied" },
      query: { page: "2" },
      params: {},
    };
    let err: unknown = "not called";
    validateMiddleware(schema)(req, {} as any, (e?: unknown) => (err = e));
    expect(err).toBeUndefined();
    expect(req.body).toEqual({ name: "A" });
    expect(req.query).toEqual({ page: 2 });
  });

  it("forwards validation errors", () => {
    const req: any = { body: {}, query: {}, params: {} };
    let err: unknown;
    validateMiddleware(schema)(req, {} as any, (e?: unknown) => (err = e));
    expect(err).toBeInstanceOf(z.ZodError);
  });
});
