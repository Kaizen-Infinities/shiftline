import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";

describe("retention API", () => {
  it("lists effective policies with statutory floors", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (await api()).get("/api/retention/policies").set(auth);
    expect(res.status).toBe(200);
    const byClass = Object.fromEntries(
      res.body.data.map((p: { dataClass: string }) => [p.dataClass, p])
    );
    expect(Object.keys(byClass).sort()).toEqual(
      [
        "AGENT_POSITIONS",
        "AUDIT_LOGS",
        "BOOKS",
        "EOD_SNAPSHOTS",
        "FILINGS",
        "LOGIN_ATTEMPTS",
        "MACHINE_TELEMETRY",
        "NOTIFICATIONS",
        "PAYROLL",
        "SESSIONS",
        "SYNC_TOMBSTONES",
      ].sort()
    );
    expect(byClass.BOOKS).toMatchObject({
      minDays: 2922,
      action: "RETAIN",
      purgeable: false,
      source: "default",
    });
    expect(byClass.SESSIONS).toMatchObject({ minDays: 30, action: "PURGE", purgeable: true });
  });

  it("validates policy edits", async () => {
    const { auth } = await authed("demo.owner");
    const client = await api();

    const tooShort = await client
      .put("/api/retention/policies/SESSIONS")
      .set(auth)
      .send({ retentionDays: 3, action: "PURGE" });
    expect(tooShort.status).toBe(400);

    const booksPurge = await client
      .put("/api/retention/policies/BOOKS")
      .set(auth)
      .send({ retentionDays: 3650, action: "PURGE" });
    expect(booksPurge.status).toBe(400);

    const unknown = await client
      .put("/api/retention/policies/NOT_A_CLASS")
      .set(auth)
      .send({ retentionDays: 3650, action: "RETAIN" });
    expect(unknown.status).toBe(400);

    const ok = await client
      .put("/api/retention/policies/LOGIN_ATTEMPTS")
      .set(auth)
      .send({ retentionDays: 180, action: "ARCHIVE" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      dataClass: "LOGIN_ATTEMPTS",
      retentionDays: 180,
      action: "ARCHIVE",
    });

    const list = await client.get("/api/retention/policies").set(auth);
    const row = list.body.data.find((p: { dataClass: string }) => p.dataClass === "LOGIN_ATTEMPTS");
    expect(row).toMatchObject({ retentionDays: 180, action: "ARCHIVE", source: "custom" });
  });

  it("runs a dry-run sweep and lists it", async () => {
    const { auth } = await authed("demo.owner");
    const client = await api();
    const run = await client.post("/api/retention/sweeps").set(auth).send({ dryRun: true });
    expect(run.status).toBe(200);
    expect(run.body.data).toHaveLength(11);
    expect(run.body.data.every((r: { affected: number }) => r.affected === 0)).toBe(true);

    const list = await client.get("/api/retention/sweeps?limit=10&dataClass=SESSIONS").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    expect(list.body.data[0]).toMatchObject({ dataClass: "SESSIONS", dryRun: true });
  });

  it("needs the retention permission", async () => {
    const { auth } = await authed("demo.sales");
    const res = await (await api()).get("/api/retention/policies").set(auth);
    expect(res.status).toBe(403);
  });
});
