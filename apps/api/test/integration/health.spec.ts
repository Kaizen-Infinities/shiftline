import { describe, expect, it } from "vitest";

import { api } from "../helpers/app";

describe("health and readiness", () => {
  it("GET /health answers without touching the database or auth", async () => {
    const res = await (await api()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: expect.any(String) });
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });

  it("GET /ready reports the database and migrations, and the worker without failing", async () => {
    const res = await (await api()).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.checks).toMatchObject({ db: "ok", migrations: "ok" });
    expect(["ok", "stale", "unknown"]).toContain(res.body.checks.worker);
    expect(res.body.migration.expected).toMatch(/^\d{14}_/);
  });

  it("every response carries a request id, echoing a sane incoming one", async () => {
    const minted = await (await api()).get("/health");
    expect(minted.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const echoed = await (await api()).get("/health").set("x-request-id", "client-req-0001");
    expect(echoed.headers["x-request-id"]).toBe("client-req-0001");

    const rejected = await (await api()).get("/health").set("x-request-id", "bad id!");
    expect(rejected.headers["x-request-id"]).not.toBe("bad id!");

    const error = await (await api()).get("/api/customers").set("x-request-id", "client-req-0002");
    expect(error.status).toBe(401);
    expect(error.body.requestId).toBe("client-req-0002");
  });
});
