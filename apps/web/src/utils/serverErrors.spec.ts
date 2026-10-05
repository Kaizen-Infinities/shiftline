import { describe, expect, it, vi } from "vitest";
import { applyServerErrors, getServerErrorMessage, getServerFieldErrors } from "./serverErrors";
import { isRequiredField } from "./zodRequired";
import { z } from "zod";

const apiError = {
  message: "Validation failed",
  errors: [{ path: "body.gstin", message: "Invalid GSTIN (format, state or check digit)" }],
};

describe("serverErrors", () => {
  it("strips the body prefix and reads thunk rejections and axios errors", () => {
    expect(getServerFieldErrors(apiError)[0].path).toBe("gstin");
    expect(getServerFieldErrors({ response: { data: apiError } })).toHaveLength(1);
  });

  it("toasts the first field message, not Validation failed", () => {
    expect(getServerErrorMessage(apiError, "x")).toMatch(/Invalid GSTIN/);
    expect(getServerErrorMessage({ message: "Nope" }, "x")).toBe("Nope");
    expect(getServerErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("sets each error on its field, honouring aliases", () => {
    const setError = vi.fn();
    applyServerErrors({ errors: [{ path: "body.mobile", message: "bad" }] }, setError, "f", {
      mobile: "phones",
    });
    expect(setError).toHaveBeenCalledWith("phones", { type: "server", message: "bad" });
  });

  it("derives required markers from a zod schema", () => {
    const schema = z.object({
      email: z.string().min(1),
      note: z.string().optional(),
      limit: z
        .string()
        .optional()
        .refine(() => true),
    });
    expect(isRequiredField(schema, "email")).toBe(true);
    expect(isRequiredField(schema, "note")).toBe(false);
    expect(isRequiredField(schema, "limit")).toBe(false);
  });
});
