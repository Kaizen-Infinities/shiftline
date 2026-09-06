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

    DATABASE_URL: z.string().min(1, "Database URL is required"),

    JWT_ACCESS_SECRET: z.string().min(32, "JWT Access Secret must be at least 32 characters"),
    /** Key for encrypting stored credentials (WhatsApp tokens, SMTP passwords, GSP secrets). */
    DATA_ENCRYPTION_KEY: z.string().min(32).optional(),

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
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === "production") {
      for (const k of ["ADMIN_EMAIL", "ADMIN_USERNAME", "ADMIN_PASSWORD", "DATA_ENCRYPTION_KEY"] as const) {
        if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: `${k} is required in production` });
      }
      if (v.ADMIN_PASSWORD && v.ADMIN_PASSWORD.length < 12) {
        ctx.addIssue({ code: "custom", path: ["ADMIN_PASSWORD"], message: "ADMIN_PASSWORD must be at least 12 characters" });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  throw new Error(
    `\n\nEnvironment validation failed:\n${lines.join("\n")}\n\nCheck apps/api/.env against apps/api/.env.example.\n`
  );
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
