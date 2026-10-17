import { beforeEach, describe, expect, it, vi } from "vitest";

const assertFeature = vi.fn();
vi.mock("../../src/middleware/feature.middleware", () => ({
  assertFeature: (...args: unknown[]) => assertFeature(...args),
  featureOf: (permission: string) => permission.split(".")[0],
}));

import {
  requireAllPermissions,
  requirePermission,
} from "../../src/middleware/permission.middleware";

const run = (mw: (req: any, res: any, next: any) => void, req: any) =>
  new Promise<unknown>((resolve) => mw(req, {}, (e?: unknown) => resolve(e)));

describe("requireAllPermissions", () => {
  beforeEach(() => {
    assertFeature.mockReset();
    assertFeature.mockResolvedValue(undefined);
  });

  it("passes when every permission is held and its feature is in the plan", async () => {
    const req = {
      user: { userId: "u1", permissions: ["users.view", "users.edit"] },
      method: "GET",
    };
    const err = await run(requireAllPermissions("users.view", "users.edit"), req);
    expect(err).toBeUndefined();
    expect(assertFeature).toHaveBeenCalledTimes(2);
  });

  it("refuses with the plan error when a permission's feature is not in the plan", async () => {
    const planError = Object.assign(new Error("not in plan"), { code: "FEATURE_NOT_IN_PLAN" });
    assertFeature.mockImplementation(async (_req: unknown, feature: string) => {
      if (feature === "payroll") throw planError;
    });
    const req = {
      user: { userId: "u1", permissions: ["users.view", "payroll.edit"] },
      method: "GET",
    };
    const err = await run(requireAllPermissions("users.view", "payroll.edit"), req);
    expect(err).toBe(planError);
  });

  it("still refuses a user missing one of the permissions before checking the plan", async () => {
    const req = { user: { userId: "u1", permissions: ["users.view"] }, method: "GET" };
    const err = (await run(requireAllPermissions("users.view", "users.edit"), req)) as {
      statusCode?: number;
    };
    expect(err).toBeDefined();
    expect(assertFeature).not.toHaveBeenCalled();
  });
});

describe("requirePermission (reference behaviour)", () => {
  it("checks the plan feature for the single permission", async () => {
    assertFeature.mockResolvedValue(undefined);
    const req = { user: { userId: "u1", permissions: ["users.view"] }, method: "GET" };
    const err = await run(requirePermission("users.view"), req);
    expect(err).toBeUndefined();
    expect(assertFeature).toHaveBeenCalledTimes(1);
  });
});
