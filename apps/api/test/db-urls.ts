/** Test database naming shared by global setup and per-worker setup. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://shiftline_migrator:shiftline_migrator@localhost:5432/shiftline_test";

export const withDatabase = (url: string, dbName: string): string => {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
};

export const baseDbName = (): string => new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
export const templateDbName = (): string => `${baseDbName()}_template`;
export const workerDbName = (workerId: string): string => `${baseDbName()}_w${workerId}`;
export const adminUrl = (): string => withDatabase(TEST_DATABASE_URL, "postgres");
