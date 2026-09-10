/**
 * Daily database backup (MCA Rule 3(5): books of account backed up daily).
 * `pg_dump -Fc` of DATABASE_URL into BACKUP_DIR, sha256 recorded, dumps older
 * than BACKUP_KEEP_DAYS removed, one BackupRun row per attempt. The same
 * function backs `scripts/backup.sh` and the platform-admin trigger.
 * Restore: `scripts/restore.sh <dump> <target database url>`.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type PgBoss from "pg-boss";

import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { logger } from "../lib/logger";

const execFileAsync = promisify(execFile);

export const BACKUP_PREFIX = "shiftline-";
export const BACKUP_SUFFIX = ".dump";
const DUMP_RE = /^shiftline-(\d{8}-\d{6})\.dump$/;

export interface BackupOptions {
  /** Directory override (tests); defaults to BACKUP_DIR. */
  dir?: string;
  /** Database to dump; defaults to DATABASE_URL. */
  databaseUrl?: string;
  keepDays?: number;
  triggeredBy?: string;
  jobId?: string;
}

export interface BackupResult {
  runId: bigint;
  fileName: string;
  bytes: number;
  sha256: string;
  durationMs: number;
  removed: string[];
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

const sha256Of = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

/** Removes dumps older than `keepDays`; returns the file names removed. */
export const rotateBackups = async (dir: string, keepDays: number): Promise<string[]> => {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!DUMP_RE.test(name)) continue;
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.mtimeMs < cutoff) {
      await unlink(full);
      removed.push(name);
    }
  }
  return removed;
};

export const runBackup = async (opts: BackupOptions = {}): Promise<BackupResult> => {
  const dir = path.resolve(opts.dir ?? env.BACKUP_DIR);
  const databaseUrl = opts.databaseUrl ?? env.DATABASE_URL;
  const keepDays = opts.keepDays ?? env.BACKUP_KEEP_DAYS;
  const startedAt = new Date();
  const fileName = `${BACKUP_PREFIX}${stamp(startedAt)}${BACKUP_SUFFIX}`;
  const target = path.join(dir, fileName);

  const run = await prisma.backupRun.create({
    data: { fileName, triggeredBy: opts.triggeredBy ?? null, jobId: opts.jobId ?? null },
  });

  try {
    await mkdir(dir, { recursive: true });
    // Custom format: compressed, restorable table by table, owner/ACL-free so
    // it restores under any role. Every tenant table forces row-level
    // security, so the dump runs with the platform bypass flag and
    // --enable-row-security; without them pg_dump either fails or dumps zero rows.
    await execFileAsync(
      env.PG_DUMP_PATH,
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--enable-row-security",
        "--file",
        target,
        databaseUrl,
      ],
      {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60 * 60 * 1000,
        env: { ...process.env, PGOPTIONS: "-c app.bypass_rls=on" },
      }
    );
    const info = await stat(target);
    const sha256 = await sha256Of(target);
    const removed = await rotateBackups(dir, keepDays);
    const durationMs = Date.now() - startedAt.getTime();
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        bytes: BigInt(info.size),
        sha256,
        durationMs,
        finishedAt: new Date(),
      },
    });
    logger.info({ fileName, bytes: info.size, durationMs, removed }, "backup completed");
    return { runId: run.id, fileName, bytes: info.size, sha256, durationMs, removed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: message.slice(0, 1000),
        durationMs: Date.now() - startedAt.getTime(),
        finishedAt: new Date(),
      },
    });
    logger.error({ err, fileName }, "backup failed");
    throw err;
  }
};

/** pg-boss handler for the daily schedule. */
export const backupHandler = async (job: PgBoss.Job<{ triggeredBy?: string }>) =>
  runBackup({ triggeredBy: job.data?.triggeredBy ?? "schedule", jobId: job.id });
