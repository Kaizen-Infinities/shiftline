import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env";

const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_ACCESS_SECRET: "x".repeat(32),
};

describe("parseEnv", () => {
  it("treats an empty value as unset, so a .env copied from the example validates", () => {
    const env = parseEnv({
      ...base,
      LOG_LEVEL: "",
      LOG_FORMAT: "",
      SENTRY_DSN: "",
      REFRESH_COOKIE_SAMESITE: "",
      COOKIE_SECURE: "",
      MOBILE_STORAGE_DRIVER: "",
      PORT: "",
    });
    expect(env.LOG_LEVEL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.COOKIE_SECURE).toBeUndefined();
    expect(env.PORT).toBe(5000);
  });

  it("still rejects a required variable left empty", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("still rejects a value that is set but invalid", () => {
    expect(() => parseEnv({ ...base, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });

  it("keeps a value containing '#' intact once it reaches the schema", () => {
    expect(parseEnv({ ...base, ADMIN_PASSWORD: "DevAdmin#2026!!" }).ADMIN_PASSWORD).toBe(
      "DevAdmin#2026!!"
    );
  });
});
