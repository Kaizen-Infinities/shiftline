/**
 * Runs once per `vitest run`: builds a template database (schema + seed) that each
 * worker clones. Cloning a template takes ~100 ms; running the seed takes seconds.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { adminUrl, templateDbName, withDatabase, TEST_DATABASE_URL, baseDbName } from "./db-urls";

const apiRoot = path.resolve(__dirname, "..");
const TEST_ENV = {
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-0000",
  DATA_ENCRYPTION_KEY: "test-encryption-key-test-encryption-key-00",
  ADMIN_EMAIL: "admin@test.shiftline.local",
  ADMIN_USERNAME: "testadmin",
  ADMIN_PASSWORD: "TestAdmin#2026!!",
  SEED_PASSWORD: "Test@12345678",
  PLATFORM_GATEWAY_WEBHOOK_SECRET: "test-platform-billing-secret-0000",
};

const hasMigrations = () => {
  const dir = path.join(apiRoot, "prisma", "migrations");
  return (
    existsSync(dir) &&
    readdirSync(dir).some((f) => /^\d{14}_/.test(f) || f === "migration_lock.toml")
  );
};

export default async function setup() {
  const admin = new PrismaClient({ datasourceUrl: adminUrl() });
  const template = templateDbName();
  try {
    // Drop stale worker databases and the old template.
    const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname LIKE '${baseDbName()}_%'`
    );
    for (const { datname } of rows) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await admin.$executeRawUnsafe(`CREATE DATABASE "${template}"`);
  } finally {
    await admin.$disconnect();
  }

  const env = {
    ...process.env,
    ...TEST_ENV,
    DATABASE_URL: withDatabase(TEST_DATABASE_URL, template),
  };
  const schemaCmd = hasMigrations()
    ? "npx prisma migrate deploy"
    : "npx prisma db push --skip-generate --accept-data-loss"; // until P0-06 lands the initial migration
  execSync(schemaCmd, { cwd: apiRoot, env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { cwd: apiRoot, env, stdio: "pipe" });

  return async () => {
    const admin2 = new PrismaClient({ datasourceUrl: adminUrl() });
    try {
      const rows = await admin2.$queryRawUnsafe<{ datname: string }[]>(
        `SELECT datname FROM pg_database WHERE datname LIKE '${baseDbName()}_w%'`
      );
      for (const { datname } of rows)
        await admin2.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    } finally {
      await admin2.$disconnect();
    }
  };
}
