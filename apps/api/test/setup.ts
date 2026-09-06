/**
 * Runs in every worker before test files load. Points DATABASE_URL at this worker's
 * clone of the template database so tests in different files never share state.
 */
import { PrismaClient } from "@prisma/client";
import { adminUrl, templateDbName, workerDbName, withDatabase, TEST_DATABASE_URL } from "./db-urls";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-secret-test-secret-test-secret-0000";
process.env.DATA_ENCRYPTION_KEY = "test-encryption-key-test-encryption-key-00";
process.env.ADMIN_EMAIL = "admin@test.shiftline.local";
process.env.ADMIN_USERNAME = "testadmin";
process.env.ADMIN_PASSWORD = "TestAdmin#2026!!";
process.env.FRONTEND_URL = "http://localhost:5173";

const workerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? "1";
const dbName = workerDbName(workerId);
process.env.DATABASE_URL = withDatabase(TEST_DATABASE_URL, dbName);

const admin = new PrismaClient({ datasourceUrl: adminUrl() });
try {
  const exists = await admin.$queryRawUnsafe<{ n: number }[]>(
    `SELECT 1 AS n FROM pg_database WHERE datname = '${dbName}'`
  );
  if (exists.length === 0) {
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}" TEMPLATE "${templateDbName()}"`);
    } catch (err: any) {
      // Another process in the same pool slot won the race; the database exists now.
      if (!String(err?.message).includes("23505")) throw err;
    }
  }
} finally {
  await admin.$disconnect();
}
