import { mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { api, authed, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";

describe("database backups", () => {
  it("dumps the database, records the run and rotates old dumps", async () => {
    const { runBackup } = await import("../../src/jobs/backup.job");
    const dir = await mkdtemp(path.join(os.tmpdir(), "shiftline-backup-"));

    // An old dump that rotation must remove, and a foreign file it must leave alone.
    const old = path.join(dir, "shiftline-20200101-000000.dump");
    await writeFile(old, "old");
    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await utimes(old, past, past);
    await writeFile(path.join(dir, "notes.txt"), "keep me");

    const result = await runBackup({ dir, keepDays: 30, triggeredBy: "test" });
    expect(result.fileName).toMatch(/^shiftline-\d{8}-\d{6}\.dump$/);
    expect(result.bytes).toBeGreaterThan(1000);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.removed).toEqual(["shiftline-20200101-000000.dump"]);

    const files = (await readdir(dir)).sort();
    expect(files).toEqual([result.fileName, "notes.txt"].sort());
    expect((await stat(path.join(dir, result.fileName))).size).toBe(result.bytes);

    const prisma = await getPrisma();
    const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({
      status: "SUCCESS",
      fileName: result.fileName,
      triggeredBy: "test",
    });
    expect(Number(run.bytes)).toBe(result.bytes);
    expect(run.finishedAt).toBeTruthy();
  });

  it("records a failed run when pg_dump cannot reach the database", async () => {
    const { runBackup } = await import("../../src/jobs/backup.job");
    const dir = await mkdtemp(path.join(os.tmpdir(), "shiftline-backup-"));
    await expect(
      runBackup({
        dir,
        databaseUrl: "postgresql://nobody:nothing@127.0.0.1:1/nope",
        triggeredBy: "test",
      })
    ).rejects.toThrow();
    const prisma = await getPrisma();
    const failed = await prisma.backupRun.findFirst({
      where: { status: "FAILED", triggeredBy: "test" },
      orderBy: { startedAt: "desc" },
    });
    expect(failed?.error).toBeTruthy();
  });

  it("only platform admins see backup history", async () => {
    const tenant = await authed("demo.owner");
    const denied = await (await api()).get("/api/platform/backups").set(tenant.auth);
    expect(denied.status).toBe(403);

    const login = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: ADMIN.email, password: ADMIN.password });
    expect(login.status).toBe(200);
    const res = await (
      await api()
    )
      .get("/api/platform/backups")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.settings.keepDays).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.runs)).toBe(true);
  });
});
