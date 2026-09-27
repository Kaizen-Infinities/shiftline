import { beforeAll, describe, expect, it } from "vitest";

import { SEED_PASSWORD, api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";
import { hashPassword } from "../../src/utils/hashPassword";

/**
 * Supervisor override on the shift console: the server, not the page, decides. A supervisor
 * vouches with their own credentials and must hold shift-execution.supervise in this tenant.
 */
const URL = "/api/shift-execution/supervisor-override";
const FOREIGN_EMAIL = "supervisor@othertenant-shiftexec.example";

let OWNER: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };
let OWNER_EMAIL: string;
let ACCOUNTS_EMAIL: string;

const post = async (auth: Record<string, string>, body: Record<string, unknown>) =>
  (await api()).post(URL).set(auth).send(body);

const lastAudit = async (action: string) =>
  asDemoTenant(async () =>
    (await getPrisma()).auditLog.findFirst({
      where: { action: action as never },
      orderBy: { changedAt: "desc" },
    })
  );

describe("shift console supervisor override", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    PRODUCTION = await authed("demo.production");
    const prisma = await getPrisma();
    const [owner, accounts] = await asDemoTenant(() =>
      Promise.all([
        prisma.user.findFirstOrThrow({ where: { username: "demo.owner" } }),
        prisma.user.findFirstOrThrow({ where: { username: "demo.accounts" } }),
      ])
    );
    OWNER_EMAIL = owner.email!;
    ACCOUNTS_EMAIL = accounts.email!;
  });

  it("unlocks for an active supervisor who holds shift-execution.supervise, and audits it", async () => {
    const res = await post(OWNER.auth, { email: OWNER_EMAIL, password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.supervisorName).toBeTruthy();
    const audit = await lastAudit("SUPERVISOR_OVERRIDE_GRANTED");
    expect(audit).toBeTruthy();
  });

  it("refuses a wrong password with the same answer as an unknown email, and audits it", async () => {
    const wrong = await post(OWNER.auth, { email: OWNER_EMAIL, password: "not-the-password" });
    expect(wrong.status).toBe(401);
    const unknown = await post(OWNER.auth, {
      email: "nobody@demo.shiftline.local",
      password: SEED_PASSWORD,
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);
    const audit = await lastAudit("SUPERVISOR_OVERRIDE_DENIED");
    expect(audit?.newValues).toMatchObject({ reason: "unknown_or_inactive_user" });
  });

  it("refuses a real user whose role lacks shift-execution.supervise", async () => {
    const res = await post(OWNER.auth, { email: ACCOUNTS_EMAIL, password: SEED_PASSWORD });
    expect(res.status).toBe(403);
  });

  it("never finds a supervisor from another tenant", async () => {
    const prisma = await getPrisma();
    const other = await prisma.company.upsert({
      where: { companyCode: "TEN-SHIFTEXEC" },
      update: {},
      create: { companyCode: "TEN-SHIFTEXEC", companyName: "Other Tenant Co", isOnboarded: true },
    });
    const exists = await runAsTenant(other.id, () =>
      prisma.user.findFirst({ where: { email: FOREIGN_EMAIL } })
    );
    if (!exists) {
      await runAsTenant(other.id, async () =>
        prisma.user.create({
          data: {
            username: "foreign.supervisor.shiftexec",
            fullName: "Foreign Supervisor",
            email: FOREIGN_EMAIL,
            passwordHash: await hashPassword(SEED_PASSWORD),
          },
        })
      );
    }
    // 401 (not found), not 403 (found but unprivileged): the lookup never leaves this tenant.
    const res = await post(OWNER.auth, { email: FOREIGN_EMAIL, password: SEED_PASSWORD });
    expect(res.status).toBe(401);
    expect((await demoCompany()).id).not.toBe(other.id);
  });

  it("rejects a session without shift-execution.edit and an incomplete request", async () => {
    const noEdit = await post(PRODUCTION.auth, { email: OWNER_EMAIL, password: SEED_PASSWORD });
    expect(noEdit.status).toBe(403);
    const missing = await post(OWNER.auth, { email: OWNER_EMAIL });
    expect(missing.status).toBe(400);
    const badEmail = await post(OWNER.auth, { email: "not-an-email", password: "x" });
    expect(badEmail.status).toBe(400);
    const unauthenticated = await (
      await api()
    )
      .post(URL)
      .send({ email: OWNER_EMAIL, password: SEED_PASSWORD });
    expect(unauthenticated.status).toBe(401);
  });
});
