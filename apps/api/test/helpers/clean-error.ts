import { expect } from "vitest";

/**
 * Asserts an error response has the safe body shape: `success: false`, a short message and no
 * leaked internals (Prisma text, stack frames, SQL, file paths) in `message` or `errors`.
 * `detail` is a development-only field and is deliberately not inspected.
 */
export const expectCleanError = (
  res: { status: number; body: any },
  status: number,
  message?: string | RegExp
) => {
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(status);
  expect(res.body.success).toBe(false);
  expect(typeof res.body.message).toBe("string");
  const surface = JSON.stringify({ message: res.body.message, errors: res.body.errors });
  expect(surface).not.toMatch(
    /prisma|invocation|\.ts:\d|node_modules|violates|P20\d\d|constraint/i
  );
  expect(surface).not.toMatch(
    /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b.*\b(FROM|SET|VALUES|WHERE)\b/
  );
  if (typeof message === "string") expect(res.body.message).toBe(message);
  else if (message) expect(res.body.message).toMatch(message);
};
