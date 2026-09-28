import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const optionalString = z.string().optional();

/**
 * Every environment variable the API reads, in one place. Anything not listed
 * here must not be read via process.env elsewhere.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    /** pino level; defaults to debug in development, info in production, silent in tests. */
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    /** `json` forces machine-readable logs in development. */
    LOG_FORMAT: z.enum(["pretty", "json"]).optional(),
    SERVICE_NAME: z.string().default("shiftline-api"),
    /** Optional error reporting; nothing is sent when unset. */
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_ENVIRONMENT: optionalString,

    DATABASE_URL: z.string().min(1, "Database URL is required"),

    JWT_ACCESS_SECRET: z.string().min(32, "JWT Access Secret must be at least 32 characters"),
    /** Sliding refresh-session lifetime; sessions never outlive 30 days from login. */
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    /** A rotated-away refresh token replayed within this window is treated as a race, not theft. */
    REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).max(60_000).default(10_000),
    /** Login and password-reset requests per IP per 15 minutes; browser suites raise it. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(5).max(10_000).default(30),
    GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().min(100).max(1_000_000).default(1200),
    REFRESH_COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).optional(),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    /** Key for encrypting stored credentials (WhatsApp tokens, SMTP passwords, GSP secrets). */
    DATA_ENCRYPTION_KEY: z.string().min(32).optional(),

    /**
     * The platform's own gateway webhook secret (P1-21): subscription callbacks are signed with
     * it. Absent means subscription billing is not wired up, and the callback is refused rather
     * than trusted.
     */
    PLATFORM_GATEWAY_WEBHOOK_SECRET: z.string().min(16).optional(),

    /** Run the pg-boss worker inside the API process (single-process local runs). */
    EMBED_WORKER: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** Postgres schema pg-boss owns; created on first start. */
    PGBOSS_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/)
      .default("pgboss"),
    /** Local directory for retention archives (NDJSON.gz per sweep). */
    ARCHIVE_DIR: z.string().min(1).default("./archives"),
    /** Full account exports (P1-03), one folder per tenant, files live 24 hours. */
    EXPORT_DIR: z.string().min(1).default("./exports"),
    /** Daily pg_dump destination and rotation (MCA Rule 3(5)). */
    BACKUP_DIR: z.string().min(1).default("./backups"),
    BACKUP_KEEP_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    /** pg_dump binary; must be at least the server's major version. */
    PG_DUMP_PATH: z.string().default("pg_dump"),

    FRONTEND_URL: z.string().url().default("http://localhost:5173"),
    BACKEND_URL: z.string().url().default("http://localhost:5000"),

    ADMIN_EMAIL: optionalString,
    ADMIN_USERNAME: optionalString,
    ADMIN_PASSWORD: optionalString,

    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: optionalString,
    SMTP_ENCRYPTION: optionalString,
    FROM_NAME: optionalString,

    IMAGEKIT_PUBLIC_KEY: optionalString,
    IMAGEKIT_PRIVATE_KEY: optionalString,
    IMAGEKIT_URL_ENDPOINT: optionalString,

    /** Field app: cheque OCR (optional; the app falls back to manual entry). */
    ANTHROPIC_API_KEY: optionalString,
    MOBILE_OCR_MODEL: z.string().default("claude-opus-5"),
    /** Field app attachment storage: ImageKit (default) or S3. */
    MOBILE_STORAGE_DRIVER: z.enum(["imagekit", "s3"]).optional(),
    AWS_S3_BUCKET: optionalString,
    AWS_REGION: optionalString,
    AWS_S3_PUBLIC_URL: optionalString,
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === "production") {
      for (const k of [
        "ADMIN_EMAIL",
        "ADMIN_USERNAME",
        "ADMIN_PASSWORD",
        "DATA_ENCRYPTION_KEY",
      ] as const) {
        if (!v[k])
          ctx.addIssue({ code: "custom", path: [k], message: `${k} is required in production` });
      }
      if (v.ADMIN_PASSWORD && v.ADMIN_PASSWORD.length < 12) {
        ctx.addIssue({
          code: "custom",
          path: ["ADMIN_PASSWORD"],
          message: "ADMIN_PASSWORD must be at least 12 characters",
        });
      }
    }
  });

/**
 * Validates an environment. An empty value (`LOG_LEVEL=` in a .env copied from the example)
 * means "not set", as it does for most .env tooling, so the default or `optional()` applies
 * instead of the empty string failing an enum or URL check. Required variables left empty
 * still fail, as missing.
 */
export const parseEnv = (source: Record<string, string | undefined>) => {
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const parsed = envSchema.safeParse(set);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `\n\nEnvironment validation failed:\n${lines.join("\n")}\n\nCheck apps/api/.env against apps/api/.env.example.\n`
    );
  }
  return parsed.data;
};

export const env = parseEnv(process.env);
export type Env = typeof env;

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
