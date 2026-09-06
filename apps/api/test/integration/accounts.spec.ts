import { describe, expect, it } from "vitest";
import { api, authed } from "../helpers/app";

describe("accounts", () => {
  it("serves the trial balance to a role with accounts.view", async () => {
    const { auth } = await authed("demo.accounts");
    const res = await (await api()).get("/api/accounts/trial-balance").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("lists system ledgers seeded by ensureSystemLedgersExist", async () => {
    const { auth } = await authed("demo.accounts");
    const res = await (await api()).get("/api/accounts/ledgers").set(auth);
    expect(res.status).toBe(200);
    const codes = (res.body.data?.data ?? res.body.data ?? []).map((l: { code: string }) => l.code);
    expect(codes).toEqual(
      expect.arrayContaining(["CASH-001", "BANK-001", "SALES-001", "PURCH-001"])
    );
  });

  it("never accepts companyId from the client on periods", async () => {
    const { auth } = await authed("demo.accounts");
    const res = await (
      await api()
    )
      .post("/api/accounts/periods")
      .set(auth)
      .send({
        periodName: `Test ${Date.now()}`,
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        companyId: "00000000-0000-0000-0000-000000000000",
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.companyId).not.toBe("00000000-0000-0000-0000-000000000000");
  });
});
