import { describe, expect, it } from "vitest";
import { isValidGstin } from "@shiftline/shared";
import { api, authed } from "../helpers/app";

const GSTIN_BODY = "33AABCU9603R1Z";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const validGstin = ALPHABET.split("")
  .map((c) => GSTIN_BODY + c)
  .find((g) => isValidGstin(g)) as string;
const badGstin = GSTIN_BODY + ALPHABET.split("").find((c) => !isValidGstin(GSTIN_BODY + c));

const customerBody = (code: string, extra: Record<string, unknown> = {}) => ({
  customerCode: code,
  firmName: `Firm ${code} Industries`,
  displayName: `Disp ${code}`,
  ...extra,
});

describe("customer validation and search", () => {
  it("rejects a checksum-invalid GSTIN with a field-level message and no raw error", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/customers")
      .set(auth)
      .send(customerBody(`QA${Date.now()}`, { gstin: badGstin }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
    const err = res.body.errors.find((e: { path: string }) => e.path === "body.gstin");
    expect(err?.message).toMatch(/GSTIN/);
    expect(JSON.stringify(res.body)).not.toMatch(/ZodError|stack|at .*\.ts/);
  });

  it("refuses a customer list limit above 100 and accepts 100", async () => {
    const { auth } = await authed("demo.owner");
    const over = await (await api()).get("/api/customers").query({ limit: "101" }).set(auth);
    expect(over.status).toBe(400);
    const ok = await (await api()).get("/api/customers").query({ limit: "100" }).set(auth);
    expect(ok.status).toBe(200);
  });

  it("accepts a valid GSTIN", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/customers")
      .set(auth)
      .send(customerBody(`QB${Date.now()}`, { gstin: validGstin }));
    expect([200, 201]).toContain(res.status);
  });

  it("finds a party ledger by either the display name or the firm name", async () => {
    const { auth } = await authed("demo.owner");
    const code = `QC${Date.now()}`;
    const created = await (
      await api()
    )
      .post("/api/customers")
      .set(auth)
      .send(customerBody(code, { displayName: "Zebulon Trading" }));
    expect([200, 201]).toContain(created.status);

    for (const search of ["zebulon", `firm ${code}`.toLowerCase(), code.toLowerCase()]) {
      const res = await (
        await api()
      )
        .get("/api/accounts/ledgers")
        .query({ search, limit: "50" })
        .set(auth);
      expect(res.status).toBe(200);
      const rows = (res.body.data?.data ?? res.body.data ?? []) as Array<{
        customer?: { customerCode: string };
      }>;
      expect(rows.some((l) => l.customer?.customerCode === code)).toBe(true);
    }
  });
});
