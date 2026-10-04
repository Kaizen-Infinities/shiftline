import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { expectCleanError } from "../helpers/clean-error";
import { foreignTenant } from "../helpers/foreign-tenant";
import { asDemoTenant, createSupplier } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";

/**
 * Supplier master (R-04, characterisation). Pins today's behaviour of
 * `apps/api/src/modules/supplier/`:
 *  - the tenant comes from the token: a `companyId` in the body is ignored on create;
 *  - the opening balance is set at creation and immutable afterwards (the update schema omits it);
 *  - suppliers are addressed by their numeric id, not by `supplierCode`;
 *  - a supplier with purchase orders or GRN bills cannot be deleted.
 */
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const GSTIN_TN = "33AAAAA0000A1Z9"; // syntactically valid, state code 33

const payload = (over: Record<string, unknown> = {}) => ({
  supplierCode: `SU-${sfx}-A`,
  legalName: `Supplier Test ${sfx} Pvt Ltd`,
  billingAddressLine1: "12 Industrial Estate",
  billingCity: "Chennai",
  billingState: "Tamil Nadu",
  billingPincode: "600001",
  stateCode: "33",
  ...over,
});

let OWNER: { auth: Record<string, string> };
let FOREIGN: Awaited<ReturnType<typeof foreignTenant>>;
let createdId: number;

describe("supplier master", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    FOREIGN = await foreignTenant("xsup");
  });

  it("creates a supplier and returns the full row with defaults", async () => {
    const res = await (
      await api()
    )
      .post("/api/suppliers")
      .set(OWNER.auth)
      .send(
        payload({
          displayName: "Supplier A",
          contactPerson: "Ravi",
          mobile: ["9876543210"],
          email: "ravi@example.com",
          creditDays: 30,
        })
      );
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const s = res.body.data;
    createdId = s.id;
    expect(s.supplierCode).toBe(`SU-${sfx}-A`);
    expect(s.status).toBe("Active");
    // No GSTIN: registration type falls back to UNREGISTERED.
    expect(s.gstRegType).toBe("UNREGISTERED");
    expect(s.msmeCategory).toBe("NOT_REGISTERED");
    expect(Number(s.openingBalance)).toBe(0);
    expect(s.openingBalanceType).toBe("CREDIT");
    expect(s.creditDays).toBe(30);
    expect(s.mobile).toEqual(["9876543210"]);
    expect(s.addresses).toEqual([]);
  });

  it("ignores a client-supplied companyId on create: the supplier lands in the caller's tenant", async () => {
    const res = await (
      await api()
    )
      .post("/api/suppliers")
      .set(OWNER.auth)
      .send(payload({ supplierCode: `SU-${sfx}-B`, companyId: FOREIGN.companyId }));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.companyId).not.toBe(FOREIGN.companyId);
    const prisma = await getPrisma();
    expect(
      await runAsTenant(FOREIGN.companyId, () =>
        prisma.supplier.count({ where: { supplierCode: `SU-${sfx}-B` } })
      )
    ).toBe(0);
  });

  it("derives gstRegType and stateCode from a GSTIN, and uppercases it", async () => {
    const res = await (
      await api()
    )
      .post("/api/suppliers")
      .set(OWNER.auth)
      .send(
        payload({ supplierCode: `SU-${sfx}-G`, gstin: GSTIN_TN.toLowerCase(), pan: "abcde1234f" })
      );
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.gstin).toBe(GSTIN_TN);
    expect(res.body.data.pan).toBe("ABCDE1234F");
    expect(res.body.data.gstRegType).toBe("REGULAR");
    expect(res.body.data.stateCode).toBe("33");
  });

  it("creates nested addresses and an opening balance (set once)", async () => {
    const res = await (
      await api()
    )
      .post("/api/suppliers")
      .set(OWNER.auth)
      .send(
        payload({
          supplierCode: `SU-${sfx}-O`,
          openingBalance: 2500,
          openingBalanceType: "CREDIT",
          addresses: [
            {
              address: {
                addressLine1: "Warehouse 1",
                city: "Coimbatore",
                state: "Tamil Nadu",
                pincode: "641001",
              },
            },
          ],
        })
      );
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(Number(res.body.data.openingBalance)).toBe(2500);
    expect(res.body.data.addresses).toHaveLength(1);
    expect(res.body.data.addresses[0].is_default).toBe(true);
    expect(res.body.data.addresses[0].label).toBe("Address 1");

    // The update schema omits openingBalance, so the key is stripped: no error, no change.
    const upd = await (
      await api()
    )
      .put(`/api/suppliers/${res.body.data.id}`)
      .set(OWNER.auth)
      .send({ openingBalance: 99999, contactPerson: "Changed" });
    expect(upd.status).toBe(200);
    expect(Number(upd.body.data.openingBalance)).toBe(2500);
    expect(upd.body.data.contactPerson).toBe("Changed");
  });

  it("lists with search, status filter and pagination, with creator names", async () => {
    const client = await api();
    const res = await client
      .get("/api/suppliers")
      .query({ search: `SU-${sfx}-A`, limit: "5", page: "1" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.suppliers).toHaveLength(1);
    expect(res.body.data.suppliers[0].supplierCode).toBe(`SU-${sfx}-A`);
    expect(res.body.data.suppliers[0].createdUserName).toBeTruthy();
    expect(res.body.data.pagination).toMatchObject({ total: 1, page: 1, limit: 5, totalPages: 1 });

    const none = await client
      .get("/api/suppliers")
      .query({ search: `SU-${sfx}-A`, status: "Blacklisted" })
      .set(OWNER.auth);
    expect(none.status).toBe(200);
    expect(none.body.data.suppliers).toHaveLength(0);
  });

  it("fetches one supplier by numeric id", async () => {
    const res = await (await api()).get(`/api/suppliers/${createdId}`).set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdId);
    expect(res.body.data.createdUserName).toBeTruthy();
    expect(res.body.data.updatedUserName).toBeNull();
  });

  it("updates a supplier and stamps updatedBy", async () => {
    const res = await (
      await api()
    )
      .put(`/api/suppliers/${createdId}`)
      .set(OWNER.auth)
      .send({ legalName: `Renamed ${sfx}`, status: "Backup", mobile: ["9111111111"] });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.legalName).toBe(`Renamed ${sfx}`);
    expect(res.body.data.status).toBe("Backup");
    expect(res.body.data.mobile).toEqual(["9111111111"]);
    expect(res.body.data.updatedBy).toBeTruthy();

    const found = await (await api()).get(`/api/suppliers/${createdId}`).set(OWNER.auth);
    expect(found.body.data.updatedUserName).toBeTruthy();
  });

  it("replaces addresses wholesale on update", async () => {
    const client = await api();
    const addr = (line: string) => ({
      address: { addressLine1: line, city: "Madurai", state: "Tamil Nadu", pincode: "625001" },
    });
    const res = await client
      .put(`/api/suppliers/${createdId}`)
      .set(OWNER.auth)
      .send({ addresses: [addr("First"), addr("Second")] });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.data.addresses).toHaveLength(2);
    const cleared = await client
      .put(`/api/suppliers/${createdId}`)
      .set(OWNER.auth)
      .send({ addresses: [] });
    expect(cleared.body.data.addresses).toHaveLength(0);
  });

  it("suggests the next supplier code from the highest existing code", async () => {
    const res = await (await api()).get("/api/suppliers/next-code").set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(typeof res.body.data).toBe("string");
    expect(res.body.data).toMatch(/\d/);
  });

  it("deletes a supplier with no purchase orders or bills outright", async () => {
    const s = await createSupplier();
    const client = await api();
    const del = await client.delete(`/api/suppliers/${s.id}`).set(OWNER.auth);
    expect(del.status).toBe(200);
    expect(del.body.data).toBeUndefined();
    expect((await client.get(`/api/suppliers/${s.id}`).set(OWNER.auth)).status).toBe(404);
  });

  it("refuses to delete a supplier that has a purchase order", async () => {
    const s = await createSupplier();
    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      await prisma.purchaseOrder.create({
        data: {
          poNumber: `PO-${sfx}-${s.id}`,
          supplierId: s.id,
          poDate: new Date(),
          expectedDeliveryDate: new Date(),
          netAmount: 100,
          billingAddressLine1: "x",
          billingCity: "x",
          billingState: "x",
          billingPincode: "600001",
          shippingAddressLine1: "x",
          shippingCity: "x",
          shippingState: "x",
          shippingPincode: "600001",
          createdBy: s.createdBy,
        } as never,
      });
    });
    const res = await (await api()).delete(`/api/suppliers/${s.id}`).set(OWNER.auth);
    expectCleanError(res, 400, /associated Purchase Orders/);
    expect((await (await api()).get(`/api/suppliers/${s.id}`).set(OWNER.auth)).status).toBe(200);
  });

  describe("validation", () => {
    const post = async (body: Record<string, unknown>) =>
      (await api()).post("/api/suppliers").set(OWNER.auth).send(body);
    const paths = (res: { body: { errors: { path: string }[] } }) =>
      res.body.errors.map((e) => e.path);

    it("rejects missing required fields with a field-level 400", async () => {
      const res = await post({});
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.supplierCode",
          "body.legalName",
          "body.billingAddressLine1",
          "body.billingCity",
          "body.billingState",
          "body.billingPincode",
          "body.stateCode",
        ])
      );
    });

    it("rejects a bad GSTIN, PAN, e-mail, state code and udyam number", async () => {
      const res = await post(
        payload({
          supplierCode: `SU-${sfx}-V`,
          gstin: "33AAAAA0000A1Z0",
          pan: "12345",
          email: "not-an-email",
          stateCode: "333",
          udyamNumber: "UDYAM-1",
        })
      );
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.gstin",
          "body.pan",
          "body.email",
          "body.stateCode",
          "body.udyamNumber",
        ])
      );
    });

    it("rejects negative opening balance, bad enums and out-of-range credit days", async () => {
      const res = await post(
        payload({
          supplierCode: `SU-${sfx}-W`,
          openingBalance: -1,
          openingBalanceType: "SIDEWAYS",
          status: "Retired",
          creditDays: 400,
          msmeCategory: "HUGE",
          gstRegType: "MAYBE",
        })
      );
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.openingBalance",
          "body.openingBalanceType",
          "body.status",
          "body.creditDays",
          "body.msmeCategory",
          "body.gstRegType",
        ])
      );
    });

    it("rejects an over-long supplier code and a bad address pincode", async () => {
      const res = await post(
        payload({
          supplierCode: "X".repeat(21),
          addresses: [{ address: { addressLine1: "a", city: "c", state: "s", pincode: "12" } }],
        })
      );
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining(["body.supplierCode", "body.addresses.0.address.pincode"])
      );
    });

    it("rejects a duplicate supplier code with 409 and a stateCode that disagrees with the GSTIN with 400", async () => {
      const dup = await post(payload());
      expectCleanError(dup, 409, /already exists/);

      const mismatch = await post(
        payload({ supplierCode: `SU-${sfx}-M`, gstin: GSTIN_TN, stateCode: "27" })
      );
      expectCleanError(mismatch, 400, "stateCode does not match the GSTIN's state");
    });

    it("rejects bad list query params and bad update bodies", async () => {
      const client = await api();
      expectCleanError(
        await client.get("/api/suppliers").query({ page: "abc" }).set(OWNER.auth),
        400,
        "Validation failed"
      );
      const upd = await client
        .put(`/api/suppliers/${createdId}`)
        .set(OWNER.auth)
        .send({ email: "nope", stateCode: "1" });
      expectCleanError(upd, 400, "Validation failed");
    });

    it("answers 404 for unknown ids and 400 (not 500) for a non-numeric or huge id", async () => {
      const client = await api();
      expectCleanError(await client.get("/api/suppliers/99999999").set(OWNER.auth), 404);
      expectCleanError(
        await client.put("/api/suppliers/99999999").set(OWNER.auth).send({ legalName: "x" }),
        404
      );
      expectCleanError(await client.delete("/api/suppliers/99999999").set(OWNER.auth), 404);
      expectCleanError(
        await client.get("/api/suppliers/abc").set(OWNER.auth),
        400,
        "Validation failed"
      );
      expectCleanError(
        await client.get("/api/suppliers/99999999999999").set(OWNER.auth),
        400,
        "Validation failed"
      );
    });
  });

  describe("permissions", () => {
    it("refuses every route to a role without suppliers.*", async () => {
      const client = await api();
      const sales = await authed("demo.sales"); // SALES_EXEC holds no suppliers.* key
      const h = sales.auth;
      expectCleanError(await client.get("/api/suppliers").set(h), 403);
      expectCleanError(await client.get("/api/suppliers/next-code").set(h), 403);
      expectCleanError(await client.get(`/api/suppliers/${createdId}`).set(h), 403);
      expectCleanError(await client.post("/api/suppliers").set(h).send(payload()), 403);
      expectCleanError(
        await client.put(`/api/suppliers/${createdId}`).set(h).send({ legalName: "x" }),
        403
      );
      expectCleanError(await client.delete(`/api/suppliers/${createdId}`).set(h), 403);
    });

    it("lets the auditor read but not write, and refuses unauthenticated calls", async () => {
      const client = await api();
      const auditor = await authed("demo.auditor");
      expect((await client.get("/api/suppliers").set(auditor.auth)).status).toBe(200);
      expectCleanError(
        await client
          .post("/api/suppliers")
          .set(auditor.auth)
          .send(payload({ supplierCode: "NOPE" })),
        403
      );
      expectCleanError(
        await client.put(`/api/suppliers/${createdId}`).set(auditor.auth).send({ legalName: "x" }),
        403
      );
      expectCleanError(await client.delete(`/api/suppliers/${createdId}`).set(auditor.auth), 403);
      expect((await client.get("/api/suppliers")).status).toBe(401);
    });
  });

  describe("tenancy", () => {
    it("hides a foreign tenant's suppliers from list, get, update and delete", async () => {
      const prisma = await getPrisma();
      const foreignSupplier = await runAsTenant(FOREIGN.companyId, () =>
        prisma.supplier.findFirstOrThrow()
      );
      const client = await api();

      const list = await client
        .get("/api/suppliers")
        .query({ search: foreignSupplier.supplierCode, limit: "50" })
        .set(OWNER.auth);
      expect(list.status).toBe(200);
      expect(
        list.body.data.suppliers.filter((s: { id: number }) => s.id === foreignSupplier.id)
      ).toEqual([]);
      expect(JSON.stringify(list.body)).not.toContain(FOREIGN.companyId);

      expectCleanError(
        await client.get(`/api/suppliers/${foreignSupplier.id}`).set(OWNER.auth),
        404
      );
      expectCleanError(
        await client
          .put(`/api/suppliers/${foreignSupplier.id}`)
          .set(OWNER.auth)
          .send({ legalName: "Hijacked" }),
        404
      );
      expectCleanError(
        await client.delete(`/api/suppliers/${foreignSupplier.id}`).set(OWNER.auth),
        404
      );

      const after = await runAsTenant(FOREIGN.companyId, () =>
        prisma.supplier.findUniqueOrThrow({ where: { id: foreignSupplier.id } })
      );
      expect(after.legalName).toBe(foreignSupplier.legalName);
    });

    it("cannot move an own supplier to another tenant by sending companyId in an update", async () => {
      const res = await (
        await api()
      )
        .put(`/api/suppliers/${createdId}`)
        .set(OWNER.auth)
        .send({ companyId: FOREIGN.companyId, contactPerson: "Mover" });
      // The update schema drops companyId (the tenant comes from the token), so the rest applies.
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.data.companyId).not.toBe(FOREIGN.companyId);
      expect(res.body.data.contactPerson).toBe("Mover");
    });

    it("allows the same supplier code in two tenants: codes are unique per tenant", async () => {
      const prisma = await getPrisma();
      const code = `SU-${sfx}-X`;
      const owner = await runAsTenant(FOREIGN.companyId, () => prisma.user.findFirstOrThrow());
      await runAsTenant(FOREIGN.companyId, () =>
        prisma.supplier.create({
          data: {
            supplierCode: code,
            legalName: "Foreign twin",
            billingAddressLine1: "x",
            billingCity: "x",
            billingState: "x",
            billingPincode: "600001",
            stateCode: "33",
            createdBy: owner.userId,
          },
        })
      );
      const res = await (
        await api()
      )
        .post("/api/suppliers")
        .set(OWNER.auth)
        .send(payload({ supplierCode: code }));
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      expect(res.body.data.companyId).not.toBe(FOREIGN.companyId);
      expect(res.body.data.legalName).not.toBe("Foreign twin");
    });
  });
});
