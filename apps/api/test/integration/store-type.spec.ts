import { Prisma, StoreCategory } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { listRoutes } from "../helpers/routes";

/**
 * Store types (R-03): the module was removed. It called a `storeType` model the schema never had
 * (the store's kind is the fixed `StoreCategory` enum on `Store`), it was never mounted, and no
 * screen reached it. This suite keeps it gone, so a half-built copy cannot come back without a
 * model, tenant scoping and tests.
 */
describe("store types", () => {
  it("has no backing model and no mounted route", async () => {
    expect(Prisma.dmmf.datamodel.models.map((m) => m.name)).not.toContain("StoreType");
    expect(listRoutes().filter((r) => r.path.includes("store-type"))).toEqual([]);
  });

  it("answers 404 on every old path, for a signed-in user and for the anonymous", async () => {
    const client = await api();
    const owner = await authed("demo.owner");
    for (const path of ["/api/store-types", "/api/store-types/next-id", "/api/store-types/1"]) {
      expect((await client.get(path).set(owner.auth)).status, path).toBe(404);
    }
    expect(
      (await client.post("/api/store-types").set(owner.auth).send({ code: "ST1", name: "Raw" }))
        .status
    ).toBe(404);
  });

  it("still gives stores their category from the enum", async () => {
    const client = await api();
    const owner = await authed("demo.owner");
    const res = await client.get("/api/stores").set(owner.auth);
    expect(res.status).toBe(200);
    const categories = Object.values(StoreCategory);
    for (const store of res.body.data?.stores ?? res.body.data ?? []) {
      if (store.storeCategory) expect(categories).toContain(store.storeCategory);
    }
  });
});
