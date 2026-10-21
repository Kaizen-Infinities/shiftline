import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { createRawMaterial, createSupplier } from "../factories";

/**
 * H09 (INV-B14): POST /api/purchase-orders accepted `status: "APPROVED"` and stored it, so a PO
 * skipped the approval step. Creation now always starts a DRAFT; approval goes through the
 * update path (`PUT /api/purchase-orders/:id`).
 */
const today = () => new Date().toISOString().slice(0, 10);

let OWNER: { auth: Record<string, string> };
let supplier: Awaited<ReturnType<typeof createSupplier>>;
let rawMaterial: Awaited<ReturnType<typeof createRawMaterial>>;

const poPayload = (overrides: Record<string, unknown> = {}) => ({
  poDate: today(),
  expectedDeliveryDate: today(),
  supplierId: supplier.id,
  billingAddressLine1: "Plot 1, Demo Industrial Estate",
  billingCity: "Chennai",
  billingState: "Tamil Nadu",
  billingPincode: "600001",
  shippingAddressLine1: "Plot 1, Demo Industrial Estate",
  shippingCity: "Chennai",
  shippingState: "Tamil Nadu",
  shippingPincode: "600001",
  items: [{ productId: rawMaterial.rawMaterialId, uom: "KG", quantity: 5, unitPrice: 100, tax: 18 }],
  ...overrides,
});

describe("purchase order creation status", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    supplier = await createSupplier({ gstin: "33AAAAA0000A1Z1", gstRegType: "REGULAR" });
    rawMaterial = await createRawMaterial({ baseUom: "KG", onHandQty: 0 });
  });

  it("creates a DRAFT even when the client asks for APPROVED", async () => {
    const client = await api();
    const res = await client
      .post("/api/purchase-orders")
      .set(OWNER.auth)
      .send(poPayload({ status: "APPROVED" }));
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    expect(res.body.data.status).toBe("DRAFT");
  });

  it("creates a DRAFT when no status is sent", async () => {
    const client = await api();
    const res = await client.post("/api/purchase-orders").set(OWNER.auth).send(poPayload());
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    expect(res.body.data.status).toBe("DRAFT");
  });

  it("approves an existing draft through the update path", async () => {
    const client = await api();
    const created = await client.post("/api/purchase-orders").set(OWNER.auth).send(poPayload());
    expect(created.status).toBe(201);
    const res = await client
      .put(`/api/purchase-orders/${created.body.data.id}`)
      .set(OWNER.auth)
      .send({ status: "APPROVED" });
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(200);
    expect(res.body.data.status).toBe("APPROVED");
  });
});
