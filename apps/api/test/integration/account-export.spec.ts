import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { readTar } from "../../src/lib/tar";

/**
 * Full account export (P1-03): every tenant table as NDJSON plus a manifest in one tar.gz,
 * secrets stripped, downloadable for 24 hours by the requester or through the signed link.
 */
const parse = (body: Buffer) => readTar(gunzipSync(body));
const ndjson = (buf: Buffer | undefined) =>
  (buf?.toString("utf8") ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("account export", () => {
  it("builds the archive, strips secrets, serves it to the requester and through the signed link", async () => {
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    const prisma = await getPrisma();
    const company = await demoCompany();

    expect((await client.post("/api/account-export").set(supervisor.auth)).status).toBe(403);
    const requested = await client.post("/api/account-export").set(owner.auth);
    expect([201, 202]).toContain(requested.status);
    const id = requested.body.data.id as string;
    if (requested.status === 202) {
      const { runAccountExport } = await import("../../src/jobs/account-export.job");
      await runAccountExport(id, company.id);
    }

    const list = await client.get("/api/account-export").set(owner.auth);
    expect(list.status).toBe(200);
    const row = list.body.data.find((r: { id: string }) => r.id === id);
    expect(row).toMatchObject({ status: "READY" });
    expect(row.sizeBytes).toBeGreaterThan(500);
    expect(row.fileName).toMatch(/^shiftline-export-.*\.tar\.gz$/);
    expect(row.tableCounts.users).toBeGreaterThanOrEqual(6);
    expect(new Date(row.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);

    // Authenticated download.
    const file = await client
      .get(`/api/account-export/${id}/file`)
      .set(owner.auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("application/gzip");
    const entries = parse(file.body as Buffer);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
    expect(manifest.company.id).toBe(company.id);
    expect(manifest.format).toBe(1);
    expect(manifest.excludedColumns).toContain("passwordHash");
    expect(entries.has("README.txt")).toBe(true);
    expect(entries.has("tables/users.ndjson")).toBe(true);
    expect(entries.has("tables/vouchers.ndjson")).toBe(true);
    expect(entries.has("tables/account_exports.ndjson")).toBe(true);
    expect(entries.has("tables/companies.ndjson")).toBe(false);
    const users = ndjson(entries.get("tables/users.ndjson"));
    const me = users.find((u) => u.username === "demo.owner");
    expect(me).toBeTruthy();
    expect(me).not.toHaveProperty("passwordHash");
    expect(users.every((u) => u.companyId === company.id)).toBe(true);
    expect(manifest.tables.find((t: { table: string }) => t.table === "users").rows).toBe(
      users.length
    );

    // The signed link from the requester's notification works without a login; a bad token does not.
    const note = await asDemoTenant(() =>
      prisma.notification.findFirst({
        where: { category: "account-export", link: { contains: id } },
        orderBy: { createdAt: "desc" },
      })
    );
    expect(note?.link).toBeTruthy();
    const token = new URL(note!.link!).searchParams.get("token")!;
    const signed = await client.get(`/api/account-export/${id}/download`).query({ token });
    expect(signed.status).toBe(200);
    expect(
      (await client.get(`/api/account-export/${id}/download`).query({ token: "0".repeat(64) }))
        .status
    ).toBe(404);
    expect((await client.get(`/api/account-export/${id}/download`)).status).toBe(400);
    const again = await client.get(`/api/account-export/${id}`).set(owner.auth);
    expect(again.body.data.downloads).toBe(2);

    // Past its expiry the row flips to EXPIRED on the next list and the file is gone.
    await asDemoTenant(() =>
      prisma.accountExport.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
    );
    const later = await client.get("/api/account-export").set(owner.auth);
    expect(later.body.data.find((r: { id: string }) => r.id === id).status).toBe("EXPIRED");
    expect((await client.get(`/api/account-export/${id}/file`).set(owner.auth)).status).toBe(410);
    expect((await client.get(`/api/account-export/${id}/download`).query({ token })).status).toBe(
      404
    );
  });

  it("refuses a second export while one is in progress", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const prisma = await getPrisma();
    const stuck = await asDemoTenant(() =>
      prisma.accountExport.create({ data: { status: "RUNNING", requestedBy: null } })
    );
    try {
      const res = await client.post("/api/account-export").set(owner.auth);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("EXPORT_IN_PROGRESS");
    } finally {
      await asDemoTenant(() =>
        prisma.accountExport.update({ where: { id: stuck.id }, data: { status: "FAILED" } })
      );
    }
  });
});
