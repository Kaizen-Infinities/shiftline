import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { notify } from "../../src/modules/notifications/notify";

/**
 * Notification centre (P1-00): audiences resolve by user, permission or
 * everyone; each recipient sees only their own rows; producers fire on
 * invitation acceptance and import commits.
 */
describe("notifications", () => {
  const sfx = randomUUID().slice(0, 6);

  it("a permission audience reaches only the roles that hold it", async () => {
    const written = await asDemoTenant(() =>
      notify({
        category: "test",
        title: `Retention notice ${sfx}`,
        body: "Only retention.view holders",
        to: { permission: "retention.view" },
      })
    );
    expect(written).toBeGreaterThanOrEqual(2); // owner and accounts

    const accounts = await authed("demo.accounts");
    const mine = await (await api()).get("/api/notifications").set(accounts.auth);
    expect(mine.status).toBe(200);
    const hit = mine.body.data.items.find(
      (n: { title: string }) => n.title === `Retention notice ${sfx}`
    );
    expect(hit).toBeTruthy();
    expect(hit.readAt).toBeNull();
    expect(mine.body.data.unreadCount).toBeGreaterThanOrEqual(1);

    const sales = await authed("demo.sales");
    const theirs = await (await api()).get("/api/notifications").set(sales.auth);
    expect(
      theirs.body.data.items.some((n: { title: string }) => n.title === `Retention notice ${sfx}`)
    ).toBe(false);

    // Read state is per recipient and per row.
    const read = await (await api()).post(`/api/notifications/${hit.id}/read`).set(accounts.auth);
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).toBeTruthy();
    const salesTry = await (await api()).post(`/api/notifications/${hit.id}/read`).set(sales.auth);
    expect(salesTry.status).toBe(404);

    const unreadOnly = await (await api()).get("/api/notifications?unread=true").set(accounts.auth);
    expect(unreadOnly.body.data.items.some((n: { id: string }) => n.id === hit.id)).toBe(false);

    const all = await (await api()).post("/api/notifications/read-all").set(accounts.auth);
    expect(all.status).toBe(200);
    const after = await (await api()).get("/api/notifications").set(accounts.auth);
    expect(after.body.data.unreadCount).toBe(0);
  });

  it("everyone-except and explicit-user audiences; platform admin ids are skipped", async () => {
    const prisma = await getPrisma();
    const owner = await asDemoTenant(() =>
      prisma.user.findFirstOrThrow({ where: { username: "demo.owner" } })
    );
    const n = await asDemoTenant(() =>
      notify({
        category: "test",
        title: `Everyone but the owner ${sfx}`,
        to: { all: true, exclude: [owner.userId] },
      })
    );
    const activeUsers = await asDemoTenant(() =>
      prisma.user.count({ where: { status: "active" } })
    );
    expect(n).toBe(activeUsers - 1);

    const direct = await asDemoTenant(() =>
      notify({
        category: "test",
        title: `Direct ${sfx}`,
        to: { userIds: [owner.userId, "admin_1", null, undefined] },
      })
    );
    expect(direct).toBe(1);
  });

  it("pagination walks newest first with a cursor", async () => {
    const stores = await authed("demo.stores");
    const prisma = await getPrisma();
    const user = await asDemoTenant(() =>
      prisma.user.findFirstOrThrow({ where: { username: "demo.stores" } })
    );
    for (let i = 0; i < 3; i++) {
      await asDemoTenant(() =>
        notify({ category: "test", title: `Page ${sfx} ${i}`, to: { userIds: [user.userId] } })
      );
    }
    const first = await (await api()).get("/api/notifications?limit=2").set(stores.auth);
    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.nextCursor).toBeTruthy();
    const second = await (
      await api()
    )
      .get(`/api/notifications?limit=2&cursor=${first.body.data.nextCursor}`)
      .set(stores.auth);
    expect(second.status).toBe(200);
    const ids = new Set(first.body.data.items.map((n: { id: string }) => n.id));
    expect(second.body.data.items.every((n: { id: string }) => !ids.has(n.id))).toBe(true);
  });

  it("an accepted invitation notifies the inviter", async () => {
    const owner = await authed("demo.owner");
    const prisma = await getPrisma();
    const demo = await demoCompany();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    const role = await runAsTenant(demo.id, () =>
      prisma.role.findFirstOrThrow({ where: { code: "STORES" } })
    );
    const email = `newhire.${sfx}@demo.shiftline.local`;
    const inv = await (
      await api()
    )
      .post("/api/invitations")
      .set(owner.auth)
      .send({ email, fullName: "New Hire", roleId: role.id });
    expect(inv.status).toBe(201);
    const token = new URL(inv.body.data.acceptUrl).searchParams.get("token")!;
    const accepted = await (
      await api()
    )
      .post(`/api/invitations/token/${token}/accept`)
      .send({ password: "NewHire#2026!!!" });
    expect(accepted.status).toBe(201);

    const list = await (await api()).get("/api/notifications?unread=true").set(owner.auth);
    const joined = list.body.data.items.find(
      (n: { category: string; title: string }) =>
        n.category === "team" && n.title === "New Hire joined"
    );
    expect(joined).toBeTruthy();
    expect(joined.body).toMatch(/as Stores/);
    expect(joined.link).toBe("/users");
  });

  it("a committed import leaves a record for the person who ran it", async () => {
    const owner = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/imports/customers?dryRun=false")
      .set(owner.auth)
      .attach(
        "file",
        Buffer.from(`customerCode,firmName\r\nNC${sfx},Notified Customer ${sfx}\r\n`),
        "c.csv"
      );
    expect(res.status).toBe(201);
    const list = await (await api()).get("/api/notifications?unread=true").set(owner.auth);
    const rec = list.body.data.items.find(
      (n: { category: string; title: string }) =>
        n.category === "imports" && n.title === "Imported 1 customers"
    );
    expect(rec).toBeTruthy();
    expect(rec.level).toBe("SUCCESS");
    expect(rec.link).toBe("/settings/imports");
  });
});
