import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";

/**
 * SET-B03: a role created from Settings is a custom role. It used to be saved with isSystem true
 * because the schema default is true, which also locked it against edits meant for custom roles.
 */
describe("role creation", () => {
  it("saves a new role as a custom (non-system) role", async () => {
    const owner = await authed("demo.owner");
    const code = `CUST${Date.now().toString(36).slice(-6)}`.toUpperCase();
    const res = await (
      await api()
    )
      .post("/api/roles")
      .set(owner.auth)
      .send({ code, name: `Custom ${code}` });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code, isSystem: false });

    const prisma = await getPrisma();
    const row = await asDemoTenant(() => prisma.role.findFirstOrThrow({ where: { code } }));
    expect(row.isSystem).toBe(false);
  });
});
