import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";

describe("GET /api/employees/me", () => {
  it("answers for an office user with no linked employee record", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (await api()).get("/api/employees/me").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      fullName: expect.any(String),
      email: "owner@demo.shiftline.local",
      employeeLinked: false,
      empCode: null,
    });
  });
});
