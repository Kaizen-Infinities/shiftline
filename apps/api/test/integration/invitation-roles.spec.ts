import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { limitedUser } from "../helpers/limited-user";
import { foreignTenant } from "../helpers/foreign-tenant";
import { runAsTenant } from "../../src/lib/tenant-context";

/**
 * H43: the Users page invites people after onboarding, so it needs the role list. GET
 * /api/invitations/roles is gated by users.create alone (not roles.view), returns only the
 * caller's company, and never exposes permission rows.
 */
const sfx = Date.now().toString(36).slice(-5);
const foreignRoleName = `Foreign Role ${sfx}`;

let OWNER: { auth: Record<string, string> };
let FOREIGN: Awaited<ReturnType<typeof foreignTenant>>;
let inviter: { auth: Record<string, string> };
let viewerOnly: { auth: Record<string, string> };

describe("invitation role list (H43)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    FOREIGN = await foreignTenant(`ivr${sfx}`);
    const prisma = await getPrisma();
    await runAsTenant(FOREIGN.companyId, () =>
      prisma.role.create({
        data: {
          companyId: FOREIGN.companyId,
          code: `FR-${sfx}`.toUpperCase(),
          name: foreignRoleName,
        },
      })
    );
    inviter = await limitedUser(`ivrc${sfx}`, ["users.create"]);
    viewerOnly = await limitedUser(`ivrv${sfx}`, ["users.view"]);
  });

  it("lists the company's active roles with id, code and name only", async () => {
    const res = await (await api()).get("/api/invitations/roles").set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const role of res.body.data) {
      expect(Object.keys(role).sort()).toEqual(["code", "id", "name"]);
      expect(typeof role.id).toBe("number");
    }
    const codes = res.body.data.map((r: { code: string }) => r.code);
    expect(codes).toContain("OWNER");
  });

  it("is open to a user who can invite but cannot view roles", async () => {
    const res = await (await api()).get("/api/invitations/roles").set(inviter.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("refuses a user without users.create", async () => {
    const res = await (await api()).get("/api/invitations/roles").set(viewerOnly.auth);
    expect(res.status).toBe(403);
  });

  it("never returns a role from a foreign company", async () => {
    const res = await (await api()).get("/api/invitations/roles").set(OWNER.auth);
    expect(JSON.stringify(res.body)).not.toContain(foreignRoleName);
    expect(JSON.stringify(res.body)).not.toContain(FOREIGN.companyId);
  });
});
