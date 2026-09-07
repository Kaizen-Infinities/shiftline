import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct, createRawMaterial } from "../factories";
import { gstService } from "../../src/modules/gst/gst.service";

/**
 * GST masters (P1-08a): seeded slabs and HSN starter list, GSTIN validation,
 * HSN CRUD with prefix lookup, registration type and state code derived on
 * parties, HSN and rate on items, HSN import, permissions.
 */
describe("gst masters", () => {
  const sfx = randomUUID().slice(0, 5).toUpperCase();

  it("every tenant starts with the statutory slabs, a starter HSN list and the state table", async () => {
    const owner = await authed("demo.owner");
    const rates = await (await api()).get("/api/gst/rates").set(owner.auth);
    expect(rates.status).toBe(200);
    expect(rates.body.data.map((r: { rate: string }) => Number(r.rate))).toEqual([
      0, 0.25, 3, 5, 12, 18, 28,
    ]);

    const hsn = await (await api()).get("/api/gst/hsn?search=3923").set(owner.auth);
    expect(hsn.status).toBe(200);
    expect(hsn.body.data[0]).toMatchObject({ code: "3923", type: "HSN", gstRate: "18" });

    const all = await (await api()).get("/api/gst/hsn?limit=500").set(owner.auth);
    expect(all.body.data.length).toBeGreaterThanOrEqual(50);
    const sac = await (await api()).get("/api/gst/hsn?type=SAC").set(owner.auth);
    expect(sac.body.data.every((h: { type: string }) => h.type === "SAC")).toBe(true);
    expect(sac.body.data.some((h: { code: string }) => h.code === "9988")).toBe(true);

    // An 8-digit code inherits the rate of its 4-digit heading when it is not listed itself.
    const lookup = await (await api()).get("/api/gst/hsn/lookup/39232990").set(owner.auth);
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.code).toBe("3923");
    expect((await (await api()).get("/api/gst/hsn/lookup/1234").set(owner.auth)).status).toBe(404);

    const states = await (await api()).get("/api/gst/states").set(owner.auth);
    expect(states.body.data).toHaveLength(37);
    expect(states.body.data.find((s: { code: string }) => s.code === "33").name).toBe("Tamil Nadu");
  });

  it("validates a GSTIN and reads the state, PAN and entity type off it", async () => {
    const owner = await authed("demo.owner");
    const ok = await (
      await api()
    )
      .post("/api/gst/validate-gstin")
      .set(owner.auth)
      .send({ gstin: "27aapfu0939f1zv" });
    expect(ok.body.data).toMatchObject({
      gstin: "27AAPFU0939F1ZV",
      valid: true,
      stateCode: "27",
      stateName: "Maharashtra",
      pan: "AAPFU0939F",
      entityType: "Firm",
    });
    const bad = await (
      await api()
    )
      .post("/api/gst/validate-gstin")
      .set(owner.auth)
      .send({ gstin: "33AAAAA0000A1Z5" });
    expect(bad.body.data.valid).toBe(false);
    expect(bad.body.data.stateCode).toBeNull();
  });

  it("HSN codes can be added, edited, imported and removed; used codes are only deactivated", async () => {
    const owner = await authed("demo.owner");
    const code = `3926${sfx
      .replace(/[^0-9]/g, "1")
      .padStart(4, "0")
      .slice(0, 4)}`;
    const created = await (
      await api()
    )
      .post("/api/gst/hsn")
      .set(owner.auth)
      .send({ code, description: "Test plastic article", gstRate: 18 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).toMatchObject({ code, type: "HSN", gstRate: "18" });
    const dup = await (
      await api()
    )
      .post("/api/gst/hsn")
      .set(owner.auth)
      .send({ code, description: "again", gstRate: 18 });
    expect(dup.status).toBe(409);
    const badCode = await (
      await api()
    )
      .post("/api/gst/hsn")
      .set(owner.auth)
      .send({ code: "39", description: "too short", gstRate: 18 });
    expect(badCode.status).toBe(400);

    const updated = await (
      await api()
    )
      .put(`/api/gst/hsn/${created.body.data.id}`)
      .set(owner.auth)
      .send({ gstRate: 12, description: "Test plastic article (12%)" });
    expect(updated.body.data.gstRate).toBe("12");

    // Import a couple more through the CSV path.
    const imported = await (
      await api()
    )
      .post("/api/imports/hsn?dryRun=false")
      .set(owner.auth)
      .attach(
        "file",
        Buffer.from(
          `code,description,gstRate\r\n${code},dup in master,18\r\n8480${sfx.slice(0, 2).replace(/[^0-9]/g, "7")}10,Test mould,18\r\n`
        ),
        "hsn.csv"
      );
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    expect(imported.body.data).toMatchObject({ imported: 1, exists: 1 });

    // A code on a product survives delete as inactive; an unused one is removed.
    const product = await createProduct({ hsnCodeId: created.body.data.id, gstRate: 5 });
    const softDelete = await (
      await api()
    )
      .delete(`/api/gst/hsn/${created.body.data.id}`)
      .set(owner.auth);
    expect(softDelete.status).toBe(200);
    expect(softDelete.body.data.isActive).toBe(false);
    const rate = await asDemoTenant(() => gstService.rateForItem(product));
    expect(rate).toBe(5); // the item's own override wins over the HSN default
    const material = await createRawMaterial({ hsnCodeId: created.body.data.id });
    expect(await asDemoTenant(() => gstService.rateForItem(material))).toBe(12);

    const fresh = await (
      await api()
    )
      .post("/api/gst/hsn")
      .set(owner.auth)
      .send({ code: "9999", description: "Temporary", gstRate: 0 });
    const hardDelete = await (
      await api()
    )
      .delete(`/api/gst/hsn/${fresh.body.data.id}`)
      .set(owner.auth);
    expect(hardDelete.status).toBe(200);
    const prisma = await getPrisma();
    expect(await asDemoTenant(() => prisma.hsnCode.count({ where: { code: "9999" } }))).toBe(0);
  });

  it("customers and suppliers get their registration type and state code from the GSTIN", async () => {
    const owner = await authed("demo.owner");
    const prisma = await getPrisma();
    const withGstin = await (
      await api()
    )
      .post("/api/customers")
      .set(owner.auth)
      .send({ customerCode: `GC${sfx}-1`, firmName: "Registered Buyer", gstin: "33aaaaa0000a1z9" });
    expect(withGstin.status, JSON.stringify(withGstin.body)).toBe(201);
    const c1 = await asDemoTenant(() =>
      prisma.customer.findFirstOrThrow({ where: { customerCode: `GC${sfx}-1` } })
    );
    expect(c1).toMatchObject({ gstin: "33AAAAA0000A1Z9", gstRegType: "REGULAR", stateCode: "33" });

    const badGstin = await (
      await api()
    )
      .post("/api/customers")
      .set(owner.auth)
      .send({ customerCode: `GC${sfx}-2`, firmName: "Typo", gstin: "33AAAAA0000A1Z5" });
    expect(badGstin.status).toBe(400);

    const mismatch = await (
      await api()
    )
      .post("/api/customers")
      .set(owner.auth)
      .send({
        customerCode: `GC${sfx}-3`,
        firmName: "Mismatch",
        gstin: "33AAAAA0000A1Z9",
        stateCode: "29",
      });
    expect(mismatch.status).toBe(400);

    const unregistered = await (
      await api()
    )
      .post("/api/customers")
      .set(owner.auth)
      .send({
        customerCode: `GC${sfx}-4`,
        firmName: "Cash Buyer",
        addresses: [
          { addressLine1: "1 Road", city: "Mysuru", state: "Karnataka", pincode: "570001" },
        ],
      });
    expect(unregistered.status, JSON.stringify(unregistered.body)).toBe(201);
    const c4 = await asDemoTenant(() =>
      prisma.customer.findFirstOrThrow({ where: { customerCode: `GC${sfx}-4` } })
    );
    expect(c4).toMatchObject({ gstRegType: "UNREGISTERED", stateCode: "29" });

    const supplier = await (
      await api()
    )
      .post("/api/suppliers")
      .set(owner.auth)
      .send({
        supplierCode: `GS${sfx}-1`,
        legalName: "Registered Vendor",
        gstin: "27AAPFU0939F1ZV",
        gstRegType: "regular",
        billingAddressLine1: "Plot 1",
        billingCity: "Pune",
        billingState: "Maharashtra",
        billingPincode: "411001",
        stateCode: "27",
      });
    expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
    const s1 = await asDemoTenant(() =>
      prisma.supplier.findFirstOrThrow({ where: { supplierCode: `GS${sfx}-1` } })
    );
    expect(s1).toMatchObject({ gstRegType: "REGULAR", stateCode: "27" });
    const wrongState = await (
      await api()
    )
      .post("/api/suppliers")
      .set(owner.auth)
      .send({
        supplierCode: `GS${sfx}-2`,
        legalName: "Wrong State",
        gstin: "27AAPFU0939F1ZV",
        billingAddressLine1: "Plot 1",
        billingCity: "Pune",
        billingState: "Maharashtra",
        billingPincode: "411001",
        stateCode: "33",
      });
    expect(wrongState.status).toBe(400);
  });

  it("the GST master needs the gst_tax permission", async () => {
    const stores = await authed("demo.stores");
    expect((await (await api()).get("/api/gst/hsn").set(stores.auth)).status).toBe(403);
    expect((await (await api()).get("/api/gst/states").set(stores.auth)).status).toBe(200);
  });
});
