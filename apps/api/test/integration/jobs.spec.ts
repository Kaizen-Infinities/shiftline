import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany, demoOwner } from "../factories";

const todayIst = async () => (await import("../../src/utils/dateUtils")).getISTDateString();

const waitForJob = async (queue: string, id: string, ms = 20_000) => {
  const { getBoss } = await import("../../src/lib/jobs");
  const deadline = Date.now() + ms;
  for (;;) {
    const job = await getBoss().getJobById(queue, id, { includeArchive: true });
    if (job && (job.state === "completed" || job.state === "failed")) return job;
    if (Date.now() > deadline) throw new Error(`job ${id} still ${job?.state ?? "missing"}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

describe("background jobs (pg-boss)", () => {
  beforeAll(async () => {
    const { startJobs } = await import("../../src/lib/jobs");
    await startJobs({ schedule: false });
  });

  afterAll(async () => {
    const { stopJobs } = await import("../../src/lib/jobs");
    await stopJobs();
  });

  it("creates every queue and de-duplicates by singleton key", async () => {
    const { QUEUES, getBoss, sendTenantJob } = await import("../../src/lib/jobs");
    const boss = getBoss();
    for (const name of Object.values(QUEUES)) {
      expect(await boss.getQueue(name), name).not.toBeNull();
    }
    const companyId = randomUUID();
    const first = await sendTenantJob(QUEUES.RETENTION_SWEEP, { companyId, dryRun: true });
    const second = await sendTenantJob(QUEUES.RETENTION_SWEEP, { companyId, dryRun: true });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    // Leave nothing behind for the worker to pick up.
    await boss.deleteJob(QUEUES.RETENTION_SWEEP, first!);
  });

  it("runs the EOD snapshot for one tenant end to end", async () => {
    const { QUEUES, getBoss } = await import("../../src/lib/jobs");
    const { registerWorkers } = await import("../../src/jobs");
    const { enqueueEodSnapshots } = await import("../../src/jobs/eod-snapshot.job");
    await registerWorkers({ pollingIntervalSeconds: 0.5 });

    const date = await todayIst();
    const sent = await enqueueEodSnapshots([date], true);
    expect(sent).toBeGreaterThanOrEqual(1);

    // Find the demo tenant's job and wait for it.
    const company = await demoCompany();
    const boss = getBoss();
    const rows = await boss.getQueueSize(QUEUES.EOD_SNAPSHOT);
    expect(rows).toBeGreaterThanOrEqual(0);
    const prisma = await getPrisma();
    const jobs = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text FROM pgboss.job WHERE name = $1 AND singleton_key = $2`,
      QUEUES.EOD_SNAPSHOT,
      `${company.id}:${date}`
    );
    expect(jobs.length).toBe(1);
    const job = await waitForJob(QUEUES.EOD_SNAPSHOT, jobs[0].id);
    expect(job.state, JSON.stringify(job.output)).toBe("completed");
    expect(job.output).toMatchObject({ snapshotDate: date });

    const [y, m, d] = date.split("-").map(Number);
    const count = await asDemoTenant(() =>
      prisma.eodStockSnapshot.count({ where: { snapshotDate: new Date(Date.UTC(y, m - 1, d)) } })
    );
    expect(count).toBeGreaterThan(0);

    // Second run for the same date is skipped (idempotent), not duplicated.
    const { eodSnapshotHandler } = await import("../../src/jobs/eod-snapshot.job");
    const again = await eodSnapshotHandler({
      id: randomUUID(),
      name: QUEUES.EOD_SNAPSHOT,
      data: { companyId: company.id, date },
    } as never);
    expect(again).toEqual({ skipped: "exists" });
  });
});

describe("retention sweep job", () => {
  it("dry run reports every class and touches nothing", async () => {
    const { retentionSweepHandler } = await import("../../src/jobs/retention.job");
    const company = await demoCompany();
    const prisma = await getPrisma();
    const before = await asDemoTenant(() => prisma.retentionSweep.count());

    const out = await retentionSweepHandler({
      id: "job-dry",
      name: "platform.retention.sweep",
      data: { companyId: company.id, dryRun: true },
    } as never);
    expect(out.map((r) => r.dataClass).sort()).toEqual(
      [
        "AGENT_POSITIONS",
        "AUDIT_LOGS",
        "BOOKS",
        "EOD_SNAPSHOTS",
        "FILINGS",
        "LOGIN_ATTEMPTS",
        "NOTIFICATIONS",
        "PAYROLL",
        "SESSIONS",
        "SYNC_TOMBSTONES",
      ].sort()
    );
    expect(out.every((r) => r.affected === 0 && r.error === null)).toBe(true);
    const after = await asDemoTenant(() => prisma.retentionSweep.count());
    expect(after - before).toBe(10);
  });

  it("purges only this tenant's expired sessions", async () => {
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const { retentionService } = await import("../../src/modules/retention/retention.service");

    const owner = await demoOwner();
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const fresh = new Date(Date.now() + 60 * 60 * 1000);
    const mk = (userId: string, expiresAt: Date) =>
      prisma.userSession.create({
        data: { userId, sessionToken: randomUUID(), expiresAt, loginAt: expiresAt },
      });
    const expiredA = await asDemoTenant(() => mk(owner.userId, old));
    const liveA = await asDemoTenant(() => mk(owner.userId, fresh));

    // A second tenant with an equally old session.
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyCode: `RT${randomUUID().slice(0, 6).toUpperCase()}`,
          companyName: "Retention Other Co",
        },
      })
    );
    const otherUser = await runAsTenant(other.id, () =>
      prisma.user.create({
        data: {
          companyId: other.id,
          username: `rt.${randomUUID().slice(0, 8)}`,
          email: `rt.${randomUUID().slice(0, 8)}@test.shiftline.local`,
          fullName: "Other Tenant User",
          passwordHash: "x",
        },
      })
    );
    const expiredB = await runAsTenant(other.id, () => mk(otherUser.userId, old));

    const results = await asDemoTenant(async () => {
      await retentionService.upsertPolicy("SESSIONS", { retentionDays: 30, action: "PURGE" });
      return retentionService.runSweep({ dryRun: false, dataClasses: ["SESSIONS"] });
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ dataClass: "SESSIONS", matched: 1, affected: 1 });

    const remaining = await withoutTenant(() =>
      prisma.userSession.findMany({
        where: { id: { in: [expiredA.id, liveA.id, expiredB.id] } },
        select: { id: true },
      })
    );
    expect(remaining.map((r) => r.id).sort()).toEqual([liveA.id, expiredB.id].sort());
  });

  it("rejects policies below the statutory floor and purges of books", async () => {
    const { retentionService } = await import("../../src/modules/retention/retention.service");
    await asDemoTenant(async () => {
      await expect(
        retentionService.upsertPolicy("SESSIONS", { retentionDays: 7, action: "PURGE" })
      ).rejects.toThrow(/at least 30 days/);
      await expect(
        retentionService.upsertPolicy("BOOKS", { retentionDays: 3000, action: "PURGE" })
      ).rejects.toThrow(/cannot be archived or purged/);
      await expect(
        retentionService.upsertPolicy("AUDIT_LOGS", { retentionDays: 365, action: "RETAIN" })
      ).rejects.toThrow(/at least 2922 days/);
    });
  });
});
